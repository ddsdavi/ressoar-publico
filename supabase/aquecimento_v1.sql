-- =====================================================================
-- AQUECIMENTO v1 — a rampa e o freio.
--
-- O problema real, medido em 06/08/2026: 11.434 pessoas podem receber
-- e-mail e o domínio mandou DEZ e-mails em 30 dias. Um domínio novo que
-- dispara para milhares de uma vez é tratado como spam — e não é só a
-- campanha que se perde: o domínio inteiro passa a entregar mal, para
-- sempre. Provedor não perdoa, e reputação queimada leva meses.
--
-- Três peças:
--
--   1. TETO DIÁRIO (`envio_limite_diario`). A fila para ao bater o teto
--      e volta a escoar no dia seguinte. Nada se perde: a linha continua
--      `queued`. Vazio ou 0 = sem teto (o comportamento de antes).
--
--   2. RAMPA. Uma vez por dia a escada sobe um degrau — mas SÓ se a
--      saúde estiver boa e SÓ se o teto de ontem tiver sido realmente
--      usado. Subir o teto sem ter usado o anterior não aquece nada:
--      quem aquece é volume entregue, não número em tabela.
--
--   3. FREIO. De hora em hora, olha os últimos 7 dias: se o bounce
--      passar de 2% ou a reclamação de spam passar de 0,1% (os limites
--      que o Gmail publica), PAUSA o envio, registra alerta e derruba a
--      rampa para o degrau anterior. Melhor uma campanha atrasada do
--      que um domínio queimado.
--
-- O freio só age com volume mínimo (50 e-mails): com 3 envios, um bounce
-- vira "33% de bounce" e pausaria a operação por estatística de nada.
-- =====================================================================
begin;

-- ------------------------------------------------------------------
-- 1. central de alertas — o que a operação precisa saber sem abrir tela
-- ------------------------------------------------------------------
create table if not exists public.alertas (
  alerta_id  uuid primary key default gen_random_uuid(),
  tipo       text not null,
  gravidade  text not null default 'aviso' check (gravidade in ('info', 'aviso', 'critico')),
  titulo     text not null,
  detalhe    text,
  dados      jsonb,
  criado_em  timestamptz not null default now(),
  visto_em   timestamptz
);
create index if not exists ix_alertas_novos on public.alertas (criado_em desc) where visto_em is null;

alter table public.alertas enable row level security;
drop policy if exists alertas_le on public.alertas;
create policy alertas_le on public.alertas
  for select to authenticated using (public.papel_atual() is not null);
drop policy if exists alertas_marca on public.alertas;
create policy alertas_marca on public.alertas
  for update to authenticated
  using (public.papel_atual() in ('admin', 'terapeuta'))
  with check (public.papel_atual() in ('admin', 'terapeuta'));
grant select, update on public.alertas to authenticated;
grant all on public.alertas to service_role;

create or replace function public.registrar_alerta(
  p_tipo text, p_titulo text, p_detalhe text default null,
  p_gravidade text default 'aviso', p_dados jsonb default null,
  p_silenciar_horas int default 6)
returns uuid
language plpgsql security definer set search_path to 'public' as $$
declare v_id uuid;
begin
  -- alerta repetido de hora em hora vira ruído, e ruído treina a pessoa a
  -- ignorar alerta. O mesmo tipo só volta a aparecer depois da janela.
  if exists (select 1 from public.alertas
             where tipo = p_tipo
               and criado_em > now() - make_interval(hours => greatest(0, p_silenciar_horas))) then
    return null;
  end if;
  insert into public.alertas (tipo, gravidade, titulo, detalhe, dados)
  values (p_tipo, p_gravidade, p_titulo, p_detalhe, p_dados)
  returning alerta_id into v_id;
  return v_id;
end $$;

grant execute on function public.registrar_alerta(text, text, text, text, jsonb, int) to service_role;

-- ------------------------------------------------------------------
-- 2. a escada da rampa
-- ------------------------------------------------------------------
insert into public.app_config (chave, valor) values
  ('envio_limite_diario', '200'),
  ('aquecimento_ligado', 'true')
on conflict (chave) do nothing;

create or replace function public.saude_envio(p_dias int default 7)
returns jsonb
language sql stable security definer set search_path to 'public' as $$
  with e as (
    select envio_id, status from public.envios
    where sent_at > now() - make_interval(days => greatest(1, p_dias))
      and status in ('sent', 'delivered', 'bounced', 'complained', 'failed')
  ),
  ev as (
    select ee.tipo from public.eventos_email ee
    join e on e.envio_id = ee.envio_fk
    where ee.tipo in ('bounce', 'complaint')
  )
  select jsonb_build_object(
    'enviados', (select count(*) from e),
    'bounces', (select count(*) from e where status = 'bounced')
               + (select count(*) from ev where tipo = 'bounce'),
    'reclamacoes', (select count(*) from e where status = 'complained')
                   + (select count(*) from ev where tipo = 'complaint'),
    'taxa_bounce', round(100.0 * ((select count(*) from e where status = 'bounced')
                                  + (select count(*) from ev where tipo = 'bounce'))
                         / nullif((select count(*) from e), 0), 2),
    'taxa_reclamacao', round(100.0 * ((select count(*) from e where status = 'complained')
                                      + (select count(*) from ev where tipo = 'complaint'))
                             / nullif((select count(*) from e), 0), 3),
    'enviados_24h', (select count(*) from public.envios
                     where sent_at > now() - interval '24 hours'
                       and status in ('sent', 'delivered', 'bounced', 'complained')),
    'limite_diario', coalesce(nullif(public.cfg('envio_limite_diario'), ''), '0')::int,
    'pausado', coalesce(public.cfg('envio_pausado'), 'false') = 'true')
$$;

revoke execute on function public.saude_envio(int) from public, anon;
grant execute on function public.saude_envio(int) to authenticated, service_role;

-- freio: roda de hora em hora
create or replace function public.freio_entregabilidade()
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_s jsonb := public.saude_envio(7);
  v_limite int := coalesce(nullif(public.cfg('envio_limite_diario'), ''), '0')::int;
  v_motivo text := null;
begin
  -- volume mínimo: com pouca amostra, uma linha vira "taxa" e pausa a
  -- operação por estatística de nada
  if (v_s->>'enviados')::int < 50 then
    return jsonb_build_object('acao', 'nada', 'motivo', 'amostra pequena', 'saude', v_s);
  end if;

  if coalesce((v_s->>'taxa_bounce')::numeric, 0) > 2.0 then
    v_motivo := 'bounce em ' || (v_s->>'taxa_bounce') || '% (limite 2%)';
  elsif coalesce((v_s->>'taxa_reclamacao')::numeric, 0) > 0.1 then
    v_motivo := 'reclamação de spam em ' || (v_s->>'taxa_reclamacao') || '% (limite 0,1%)';
  end if;

  if v_motivo is null then
    return jsonb_build_object('acao', 'nada', 'saude', v_s);
  end if;

  update public.app_config set valor = 'true', updated_at = now() where chave = 'envio_pausado';
  -- desce um degrau: quando voltar, volta com menos volume
  update public.app_config
  set valor = greatest(50, (v_limite / 2))::text, updated_at = now()
  where chave = 'envio_limite_diario';

  perform public.registrar_alerta(
    'entregabilidade',
    'Envio pausado automaticamente',
    'O freio de entregabilidade parou a fila: ' || v_motivo ||
    '. Nada se perdeu — os e-mails continuam na fila. Antes de religar em '
    || 'Configurações → E-mail, olhe Envios e exclusões: bounce alto costuma ser '
    || 'lista antiga; reclamação alta costuma ser mensagem que não combinou com o público.',
    'critico', v_s, 24);

  return jsonb_build_object('acao', 'pausou', 'motivo', v_motivo, 'saude', v_s);
end $$;

grant execute on function public.freio_entregabilidade() to service_role;

-- rampa: sobe um degrau por dia, se merecer
create or replace function public.subir_rampa()
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_s jsonb := public.saude_envio(7);
  v_limite int := coalesce(nullif(public.cfg('envio_limite_diario'), ''), '0')::int;
  v_usados int;
  v_novo int;
begin
  if coalesce(public.cfg('aquecimento_ligado'), 'true') <> 'true' then
    return jsonb_build_object('acao', 'desligado');
  end if;
  if coalesce(public.cfg('envio_pausado'), 'false') = 'true' then
    return jsonb_build_object('acao', 'nada', 'motivo', 'envio pausado');
  end if;
  if v_limite <= 0 then
    return jsonb_build_object('acao', 'nada', 'motivo', 'sem teto — rampa concluída');
  end if;

  select count(*) into v_usados from public.envios
  where sent_at > now() - interval '24 hours'
    and status in ('sent', 'delivered', 'bounced', 'complained');

  -- só sobe quem usou pelo menos 70% do teto de ontem: quem aquece é
  -- volume entregue, não número guardado numa tabela
  if v_usados < (v_limite * 0.7) then
    return jsonb_build_object('acao', 'nada', 'motivo', 'teto de ontem não foi usado',
                              'usados', v_usados, 'limite', v_limite);
  end if;

  if (v_s->>'enviados')::int >= 50
     and (coalesce((v_s->>'taxa_bounce')::numeric, 0) > 2.0
          or coalesce((v_s->>'taxa_reclamacao')::numeric, 0) > 0.1) then
    return jsonb_build_object('acao', 'nada', 'motivo', 'saúde ruim', 'saude', v_s);
  end if;

  v_novo := case
    when v_limite < 200  then 200
    when v_limite < 500  then 500
    when v_limite < 1000 then 1000
    when v_limite < 2000 then 2000
    when v_limite < 4000 then 4000
    when v_limite < 8000 then 8000
    else 0 end;   -- 0 = rampa concluída, sem teto

  update public.app_config set valor = v_novo::text, updated_at = now()
  where chave = 'envio_limite_diario';

  perform public.registrar_alerta(
    'rampa',
    case when v_novo = 0 then 'Aquecimento concluído: teto diário removido'
         else 'Aquecimento subiu para ' || v_novo || ' e-mails por dia' end,
    'A rampa sobe sozinha enquanto bounce e reclamação ficam nos limites. '
    || 'Ontem saíram ' || v_usados || ' e-mails.',
    'info', jsonb_build_object('de', v_limite, 'para', v_novo, 'saude', v_s), 20);

  return jsonb_build_object('acao', 'subiu', 'de', v_limite, 'para', v_novo);
end $$;

grant execute on function public.subir_rampa() to service_role;

-- ------------------------------------------------------------------
-- 3. a fila respeita o teto. O resto do comportamento fica idêntico.
-- ------------------------------------------------------------------
create or replace function public.processar_fila_envios()
returns integer
language plpgsql security definer set search_path to 'public' as $$
declare
  v_pausado boolean := coalesce(public.cfg('envio_pausado'), 'false') = 'true';
  v_filtro  text    := coalesce(public.cfg('envio_so_para'), '');
  v_limite  int     := coalesce(nullif(public.cfg('envio_limite_diario'), ''), '0')::int;
  v_lista   text[];
  v_retidos int := 0;
  v_hoje    int;
begin
  if v_pausado then
    return 0;
  end if;

  -- teto diário do aquecimento: a fila espera, não se perde
  if v_limite > 0 then
    select count(*) into v_hoje from public.envios
    where sent_at > now() - interval '24 hours'
      and status in ('sent', 'delivered', 'bounced', 'complained');
    if v_hoje >= v_limite then
      return 0;
    end if;
  end if;

  if btrim(v_filtro) <> '' then
    select array_agg(lower(btrim(x))) into v_lista
    from unnest(string_to_array(v_filtro, ',')) x
    where btrim(x) <> '';

    update public.envios e
    set status = 'retido'
    from public.tabela_1_leads l
    where e.lead_fk = l.lead_id
      and e.status = 'queued'
      and not (lower(l.email::text) = any(v_lista));
    get diagnostics v_retidos = row_count;
  end if;

  return public.processar_fila_envios_interno();
end $$;

-- ------------------------------------------------------------------
-- 4. relógios
-- ------------------------------------------------------------------
select cron.schedule('ressoar-freio-entregabilidade', '7 * * * *',
                     'select public.freio_entregabilidade()')
where not exists (select 1 from cron.job where jobname = 'ressoar-freio-entregabilidade');

select cron.schedule('ressoar-rampa-aquecimento', '51 6 * * *',
                     'select public.subir_rampa()')
where not exists (select 1 from cron.job where jobname = 'ressoar-rampa-aquecimento');

commit;

select public.saude_envio(7) as saude_agora;
select public.freio_entregabilidade() as freio;
select coalesce(public.cfg('envio_limite_diario'), '(sem)') as teto_diario,
       coalesce(public.cfg('envio_pausado'), 'false') as pausado;
