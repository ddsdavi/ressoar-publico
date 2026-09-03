-- =====================================================================
-- FREIO v3 — o freio para de desfazer a decisão do operador em silêncio.
--
-- O que aconteceu em 30/08/2026: o Davi tirou a trava de envio às 04:52
-- e salvou. Às 05:07 o freio de entregabilidade religou a trava sozinho,
-- e continuou religando a cada hora (cron no minuto :07). Ele voltou às
-- 13:42 e achou tudo travado de novo, sem nenhuma explicação na tela.
--
-- O freio estava CERTO no mérito: a taxa de devolução dos últimos 7 dias
-- era 13,45% (23 devoluções em 171 envios) — muito acima do limite de 2%.
-- Só que esses 171 envios foram o vazamento de 29/08 (o wrapper de pausa
-- sobrescrito por engano) contra uma lista antiga cheia de endereços com
-- erro de digitação: hotiimail.com, gmail.comgmail, gm.com. Ou seja: o
-- freio julgava um lote velho e já encerrado, e a punição caía sobre 62
-- inscritos DE HOJE na Black, que estão sem receber a confirmação.
--
-- Três defeitos, três consertos:
--
-- 1. INVENTAVA TETO ONDE NÃO HÁ. Com `envio_limite_diario` = 0 (decisão
--    de 06/08: a operação não trabalha com teto), `greatest(50, 0/2)`
--    dava 50 — e o freio ressuscitava um teto de 50 e-mails por dia a
--    cada religada. Agora só desce degrau quem tem degrau.
--
-- 2. DESFAZIA A DECISÃO HUMANA COM DADO VELHO. Quem destrava na mão está
--    dizendo "eu vi o problema e assumo". O freio passa a julgar só o que
--    sair DEPOIS desse religamento (`envio_religado_em`, carimbado por
--    gatilho). Ele não fica manso: se os envios novos repetirem bounce
--    acima de 2%, ele trava de novo — e trava na hora, sem esperar
--    amostra, se aparecerem 10 devoluções.
--
-- 3. TRAVAVA CALADO. O alerta tem antirrepetição de 24h, então a segunda,
--    a terceira e a décima religada do dia não geravam aviso nenhum. O
--    motivo agora mora em `app_config` (`envio_pausa_motivo`,
--    `envio_pausa_em`, `envio_pausa_automatica`), que a tela de
--    Configurações lê e mostra ao lado da própria trava, sempre atual.
--
-- O freio nunca destrava sozinho. Religar é sempre decisão de gente.
-- =====================================================================

begin;

-- ---- saúde a partir de um instante, não só "últimos N dias" ---------
-- O freio precisa perguntar "e depois que eu religuei, como está?" — a
-- versão por dias não sabe responder isso.
create or replace function public.saude_envio_desde(p_desde timestamptz)
returns jsonb
language sql stable security definer set search_path to 'public' as $$
  with e as (
    select envio_id, status from public.envios
    where sent_at > p_desde
      and status in ('sent', 'delivered', 'bounced', 'complained', 'failed', 'erro')
  ),
  bounce as (
    select distinct e.envio_id from e
    left join public.eventos_email ee
      on ee.envio_fk = e.envio_id and ee.tipo in ('bounce_hard', 'bounce_soft')
    where e.status = 'bounced' or ee.envio_fk is not null
  ),
  reclam as (
    select distinct e.envio_id from e
    left join public.eventos_email ee
      on ee.envio_fk = e.envio_id and ee.tipo = 'complaint'
    where e.status = 'complained' or ee.envio_fk is not null
  )
  select jsonb_build_object(
    'desde', p_desde,
    'enviados', (select count(*) from e),
    'bounces', (select count(*) from bounce),
    'reclamacoes', (select count(*) from reclam),
    'taxa_bounce', round(100.0 * (select count(*) from bounce)
                         / nullif((select count(*) from e), 0), 2),
    'taxa_reclamacao', round(100.0 * (select count(*) from reclam)
                             / nullif((select count(*) from e), 0), 3),
    'enviados_24h', (select count(*) from public.envios
                     where sent_at > now() - interval '24 hours'
                       and status in ('sent', 'delivered', 'bounced', 'complained')),
    'limite_diario', coalesce(nullif(public.cfg('envio_limite_diario'), ''), '0')::int,
    'pausado', coalesce(public.cfg('envio_pausado'), 'false') = 'true')
$$;

revoke all on function public.saude_envio_desde(timestamptz) from public, anon;
grant execute on function public.saude_envio_desde(timestamptz) to authenticated, service_role;

-- a versão por dias continua existindo (o painel a usa) e passa a ser
-- só um atalho para a de cima — uma conta só, um lugar só para consertar
create or replace function public.saude_envio(p_dias int default 7)
returns jsonb
language sql stable security definer set search_path to 'public' as $$
  select public.saude_envio_desde(now() - make_interval(days => greatest(1, p_dias)))
$$;

revoke all on function public.saude_envio(int) from public, anon;
grant execute on function public.saude_envio(int) to authenticated, service_role;

-- ---- as chaves que contam a história da trava ----------------------
insert into public.app_config (chave, valor) values
  ('envio_pausa_motivo', ''),
  ('envio_pausa_em', ''),
  ('envio_pausa_automatica', 'false'),
  ('envio_religado_em', '')
on conflict (chave) do nothing;

-- ---- o teto que o freio inventou, desfeito -------------------------
-- 06/08/2026: a operação não trabalha com teto diário. O 50 que está aí
-- agora não foi decisão de ninguém — foi o `greatest(50, 0/2)`.
update public.app_config set valor = '0', updated_at = now()
 where chave = 'envio_limite_diario' and valor = '50';

-- ---- o freio ------------------------------------------------------
create or replace function public.freio_entregabilidade()
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_religado timestamptz := nullif(public.cfg('envio_religado_em'), '')::timestamptz;
  v_desde    timestamptz := greatest(now() - interval '7 days',
                                     coalesce(v_religado, '-infinity'::timestamptz));
  v_s        jsonb := public.saude_envio_desde(v_desde);
  v_limite   int := coalesce(nullif(public.cfg('envio_limite_diario'), ''), '0')::int;
  v_enviados int := coalesce((v_s->>'enviados')::int, 0);
  v_bounces  int := coalesce((v_s->>'bounces')::int, 0);
  v_motivo   text := null;
begin
  -- já travado: não tem o que travar de novo. Antes ele reescrevia
  -- 'true' de hora em hora, e era isso que apagava o rastro de quando a
  -- trava caiu de verdade.
  if coalesce(public.cfg('envio_pausado'), 'false') = 'true' then
    return jsonb_build_object('acao', 'nada', 'motivo', 'já pausado', 'saude', v_s);
  end if;

  -- volume mínimo: com pouca amostra, uma linha vira "taxa" e pausa a
  -- operação por estatística de nada. A exceção é o estrago evidente —
  -- 10 devoluções não precisam de amostra para serem 10 devoluções.
  if v_enviados < 50 and v_bounces < 10 then
    return jsonb_build_object('acao', 'nada', 'motivo', 'amostra pequena', 'saude', v_s);
  end if;

  if coalesce((v_s->>'taxa_bounce')::numeric, 0) > 2.0 then
    v_motivo := 'devolução em ' || (v_s->>'taxa_bounce') || '% (limite 2%)';
  elsif coalesce((v_s->>'taxa_reclamacao')::numeric, 0) > 0.1 then
    v_motivo := 'reclamação de spam em ' || (v_s->>'taxa_reclamacao') || '% (limite 0,1%)';
  elsif v_bounces >= 10 and v_enviados < 50 then
    v_motivo := v_bounces || ' devoluções em ' || v_enviados || ' envios';
  end if;

  if v_motivo is null then
    return jsonb_build_object('acao', 'nada', 'saude', v_s);
  end if;

  update public.app_config set valor = 'true', updated_at = now() where chave = 'envio_pausado';

  -- desce um degrau só quem tem degrau: com teto 0 (sem teto, decisão de
  -- 06/08) o `greatest(50, ...)` criava um teto de 50 que ninguém pediu
  if v_limite > 0 then
    update public.app_config
       set valor = greatest(50, (v_limite / 2))::text, updated_at = now()
     where chave = 'envio_limite_diario';
  end if;

  -- o motivo mora aqui porque o alerta tem antirrepetição de 24h: a
  -- segunda travada do dia não gera aviso, e a tela ficava muda
  update public.app_config set valor = v_motivo, updated_at = now()
   where chave = 'envio_pausa_motivo';
  update public.app_config set valor = now()::text, updated_at = now()
   where chave = 'envio_pausa_em';
  update public.app_config set valor = 'true', updated_at = now()
   where chave = 'envio_pausa_automatica';

  perform public.registrar_alerta(
    'entregabilidade',
    'Envio pausado automaticamente',
    'O freio de entregabilidade parou a fila: ' || v_motivo ||
    '. Nada se perdeu — os e-mails continuam na fila. Antes de religar em '
    || 'Configurações → E-mail, olhe Envios e exclusões: devolução alta costuma ser '
    || 'lista antiga; reclamação alta costuma ser mensagem que não combinou com o público.',
    'critico', v_s, 24);

  return jsonb_build_object('acao', 'pausou', 'motivo', v_motivo, 'saude', v_s);
end $$;

revoke all on function public.freio_entregabilidade() from public, anon;
grant execute on function public.freio_entregabilidade() to service_role;

-- ---- o carimbo do religamento humano -------------------------------
-- Sem isto, o freio julga para sempre o lote velho que causou a travada,
-- e destravar na mão dura no máximo até o próximo minuto :07.
create or replace function public.marcar_religamento_envio()
returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  -- gente tem auth.uid(); o freio roda pelo cron, sem sessão nenhuma
  if auth.uid() is null then return new; end if;
  if coalesce(new.valor, '') = coalesce(old.valor, '') then return new; end if;

  if new.valor = 'false' then
    update public.app_config set valor = now()::text, updated_at = now()
     where chave = 'envio_religado_em';
    update public.app_config set valor = '', updated_at = now()
     where chave in ('envio_pausa_motivo', 'envio_pausa_em');
    update public.app_config set valor = 'false', updated_at = now()
     where chave = 'envio_pausa_automatica';
  else
    update public.app_config set valor = 'pausa manual', updated_at = now()
     where chave = 'envio_pausa_motivo';
    update public.app_config set valor = now()::text, updated_at = now()
     where chave = 'envio_pausa_em';
    update public.app_config set valor = 'false', updated_at = now()
     where chave = 'envio_pausa_automatica';
  end if;
  return new;
end $$;

drop trigger if exists trg_marcar_religamento on public.app_config;
create trigger trg_marcar_religamento
after update on public.app_config
for each row when (new.chave = 'envio_pausado')
execute function public.marcar_religamento_envio();

commit;

-- ---- provas --------------------------------------------------------
select jsonb_pretty(jsonb_build_object(
  'cfg', (select jsonb_object_agg(chave, valor) from public.app_config
           where chave like 'envio_%'),
  'saude_7d', public.saude_envio(7),
  'freio_agora', public.freio_entregabilidade(),
  'gatilho_existe', (select count(*) from pg_trigger
                      where tgname = 'trg_marcar_religamento' and not tgisinternal)
)) as prova;
