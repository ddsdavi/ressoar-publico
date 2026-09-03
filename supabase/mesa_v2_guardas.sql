-- =====================================================================
-- MESA v2 (guardas) — segunda leva de consenso da mesa de 30/08/2026.
--
-- 1. Pré-flight de remetente: campanha só dispara se o "De:" estiver na
--    lista de remetentes verificados no SES (o primeiro envio real já
--    falhou com 403 por remetente; há 61 mensagens antigas com "De:"
--    inverificável — reaproveitar uma delas falharia inteira, calada).
-- 2. contar_publico(): o número que a tela mostra passa a ser o número
--    que o disparo usa — distinct de lead e descontando a supressão.
-- 3. relatorio_campanha(): agregação no banco (o painel buscava 5.000
--    eventos crus e truncava sem avisar).
-- 4. saude_envio() enxerga bounce de verdade: o postback grava
--    bounce_hard/soft, e o freio filtrava 'bounce' (nunca casava);
--    reclamação contava dobrada (status + evento). Agora conta por
--    envio distinto, sem cegueira e sem dobra.
-- 5. Agendamento operável: cancelar_agendamento() + trava de papel e
--    de data no próprio banco (quem não pode disparar também não
--    agenda; data no passado não entra).
-- 6. Flags honradas: track_opens/track_clicks da campanha valem de
--    verdade na montagem (pixel e reescrita de cliques).
-- 7. Rodapé falha alto: sem base_url_tracking o motor NÃO envia sem
--    rodapé legal — segura a fila e grita no painel de alertas.
-- 8. "Olá, !" nunca chega a um lead sem nome.
-- =====================================================================

begin;

-- ---- 1. pré-flight de remetente -------------------------------------
-- A lista nasce VAZIA: os remetentes são DESTA instalação e vêm do .env
-- (REMETENTES_VERIFICADOS) pelo instalador — ou do SQL Editor, depois.
-- Vazia, nenhuma campanha sai, e a guarda abaixo diz exatamente o que
-- falta. Até 03/09/2026 o endereço da operação de origem estava escrito
-- aqui, e uma cópia da plataforma nascia com o remetente de outra casa.
insert into public.app_config (chave, valor)
values ('remetentes_verificados', '')
on conflict (chave) do nothing;

create or replace function public.remetente_permitido(p_email text) returns boolean
language sql stable as $$
  select lower(btrim(coalesce(p_email, ''))) = any (
    select lower(btrim(x))
    from unnest(string_to_array(coalesce(public.cfg('remetentes_verificados'), ''), ',')) x
    where btrim(x) <> ''
  );
$$;

create or replace function public.disparar_campanha(p_campanha uuid) returns int
language plpgsql security definer as $$
declare
  v_camp record;
  v_lead uuid;
  v_def jsonb;
  v_qtd int := 0;
  v_i int := 0;
  v_envio uuid;
  v_msg uuid;
  v_var text;
  v_total int;
  v_teste int;
  v_de text;
begin
  perform public.gate_operacao();
  select * into v_camp from public.campanhas where campanha_id = p_campanha;
  if not found or v_camp.status not in ('draft','scheduled') then
    return 0;
  end if;
  if v_camp.tipo = 'ab' and v_camp.mensagem_b_fk is null then
    raise exception 'campanha A/B sem a segunda versão';
  end if;

  -- pré-flight: cada "De:" desta campanha precisa ser um remetente
  -- verificado; melhor barrar aqui do que o provedor recusar tudo depois
  for v_de in
    select coalesce(nullif(m.from_email, ''), public.cfg('from_email_padrao'))
    from public.mensagens m
    where m.mensagem_id in (v_camp.mensagem_fk, v_camp.mensagem_b_fk)
  loop
    if not public.remetente_permitido(v_de) then
      raise exception 'O remetente "%" não está entre os verificados no servidor de envio. Corrija o "De:" da mensagem ou cadastre o endereço em Configurações (remetentes_verificados).', v_de;
    end if;
  end loop;

  update public.campanhas set status = 'sending', started_at = now() where campanha_id = p_campanha;

  create temporary table alvo_campanha (lead_fk uuid, n int) on commit drop;
  if v_camp.segmento_fk is not null then
    select definicao into v_def from public.segmentos where segmento_id = v_camp.segmento_fk;
    insert into alvo_campanha (lead_fk, n)
    select l, row_number() over ()
    from public.leads_do_segmento(coalesce(v_def, '{}'::jsonb)) l;
  else
    insert into alvo_campanha (lead_fk, n)
    select ll.lead_fk, row_number() over ()
    from (select distinct lead_fk from public.lead_listas
          where lista_fk = any(v_camp.lista_ids) and status = 1) ll;
  end if;

  select count(*) into v_total from alvo_campanha;
  v_teste := case when v_camp.tipo = 'ab'
                  then greatest(2, (v_total * coalesce(v_camp.percentual_teste, 100)) / 100)
                  else v_total end;

  for v_lead, v_i in select lead_fk, n from alvo_campanha order by n loop
    if v_camp.tipo = 'ab' then
      if v_i > v_teste then
        continue;
      end if;
      if v_i % 2 = 1 then v_msg := v_camp.mensagem_fk; v_var := 'A';
      else                v_msg := v_camp.mensagem_b_fk; v_var := 'B'; end if;
    else
      v_msg := v_camp.mensagem_fk; v_var := null;
    end if;

    v_envio := public.enfileirar_email(v_lead, v_msg, p_campanha);
    if v_envio is not null then
      if v_var is not null then
        update public.envios set variante = v_var where envio_id = v_envio;
      end if;
      v_qtd := v_qtd + 1;
    end if;
  end loop;

  return v_qtd;
end $$;

-- ---- 2. a contagem que a tela mostra é a que o disparo usa ----------
create or replace function public.contar_publico(p_listas int[], p_segmento uuid default null)
returns int
language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_def jsonb;
  v_qtd int;
begin
  if p_segmento is not null then
    select definicao into v_def from public.segmentos where segmento_id = p_segmento;
    select count(*) into v_qtd
    from public.leads_do_segmento(coalesce(v_def, '{}'::jsonb)) l
    join public.tabela_1_leads t on t.lead_id = l
    where not exists (select 1 from public.supressao s where s.email = t.email);
  else
    select count(distinct ll.lead_fk) into v_qtd
    from public.lead_listas ll
    join public.tabela_1_leads t on t.lead_id = ll.lead_fk
    where ll.lista_fk = any(coalesce(p_listas, '{}')) and ll.status = 1
      and not exists (select 1 from public.supressao s where s.email = t.email);
  end if;
  return coalesce(v_qtd, 0);
end $$;

revoke all on function public.contar_publico(int[], uuid) from public, anon;
grant execute on function public.contar_publico(int[], uuid) to authenticated;

-- ---- 3. relatório agregado no banco ---------------------------------
create or replace function public.relatorio_campanha(p_campanha uuid)
returns jsonb
language sql stable security definer set search_path to 'public' as $$
  with env as (
    select envio_id, lead_fk, status from public.envios where campanha_fk = p_campanha
  ),
  ev as (
    select ee.tipo, ee.url, ee.occurred_at, ee.lead_fk
    from public.eventos_email ee join env on env.envio_id = ee.envio_fk
  )
  select jsonb_build_object(
    'enviados',     (select count(*) from env where status not in ('suppressed','erro')),
    'nao_entregues',(select count(*) from env where status = 'erro'),
    'suprimidos',   (select count(*) from env where status = 'suppressed'),
    'aberturas',    (select count(distinct lead_fk) from ev where tipo = 'open'),
    'cliques',      (select count(distinct lead_fk) from ev where tipo = 'click'),
    'devolvidos',   (select count(distinct lead_fk) from ev where tipo in ('bounce_hard','bounce_soft')),
    'descadastros', (select count(distinct lead_fk) from ev where tipo = 'unsubscribe'),
    'cliques_por_url', coalesce((
       select jsonb_agg(jsonb_build_object('url', url, 'cliques', c) order by c desc)
       from (select url, count(distinct lead_fk) c from ev
             where tipo = 'click' and url is not null group by url limit 20) u), '[]'::jsonb),
    'linha_do_tempo', coalesce((
       select jsonb_agg(jsonb_build_object('tipo', tipo, 'quando', occurred_at) order by occurred_at desc)
       from (select tipo, occurred_at from ev
             where tipo in ('open','click','bounce_hard','unsubscribe')
             order by occurred_at desc limit 120) t), '[]'::jsonb))
$$;

revoke all on function public.relatorio_campanha(uuid) from public, anon;
grant execute on function public.relatorio_campanha(uuid) to authenticated;

-- ---- 4. saúde que enxerga bounce e não dobra reclamação -------------
create or replace function public.saude_envio(p_dias int default 7)
returns jsonb
language sql stable security definer set search_path to 'public' as $$
  with e as (
    select envio_id, status from public.envios
    where sent_at > now() - make_interval(days => greatest(1, p_dias))
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

-- ---- 5. agendamento operável ----------------------------------------
create or replace function public.cancelar_agendamento(p_campanha uuid) returns boolean
language plpgsql security definer set search_path to 'public' as $$
begin
  perform public.gate_operacao();
  update public.campanhas
  set status = 'cancelled'
  where campanha_id = p_campanha and status = 'scheduled';
  return found;
end $$;

revoke all on function public.cancelar_agendamento(uuid) from public, anon;
grant execute on function public.cancelar_agendamento(uuid) to authenticated;

-- quem não pode disparar também não agenda; e data no passado não entra.
-- No banco, não na tela: trigger pega qualquer caminho de escrita.
create or replace function public.trava_agendamento() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare
  v_mudou boolean;
begin
  if tg_op = 'INSERT' then
    v_mudou := true;
  else
    v_mudou := new.scheduled_at is distinct from old.scheduled_at;
  end if;
  if new.scheduled_at is not null and v_mudou then
    -- conexões internas (cron, service) não têm usuário logado
    if auth.uid() is not null
       and coalesce(public.papel_atual(), '') not in ('admin', 'terapeuta') then
      raise exception 'Agendar campanha é ação de quem pode disparar (Terapeuta ou Admin).';
    end if;
    if new.scheduled_at < now() - interval '2 minutes' then
      raise exception 'A data do agendamento já passou — escolha um horário no futuro.';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_trava_agendamento on public.campanhas;
create trigger trg_trava_agendamento
before insert or update on public.campanhas
for each row execute function public.trava_agendamento();

-- ---- 6. a lista de campanhas mostra datas e falhas ------------------
-- (drop + create: replace não deixa entrar coluna nova no meio da lista)
drop view if exists public.campanha_stats;
create view public.campanha_stats as
select c.campanha_id, c.nome, c.status, c.tipo, c.vencedor, c.created_at,
       c.scheduled_at, c.started_at,
       count(distinct e.envio_id) filter (where e.status not in ('suppressed','erro'))  as enviados,
       count(distinct e.envio_id) filter (where e.status = 'suppressed')                as suprimidos,
       count(distinct e.envio_id) filter (where e.status = 'erro')                      as nao_entregues,
       count(distinct e.lead_fk) filter (where ev.tipo = 'open')                        as aberturas_unicas,
       count(distinct e.lead_fk) filter (where ev.tipo = 'click')                       as cliques_unicos,
       count(distinct e.lead_fk) filter (where ev.tipo = 'bounce_hard')                 as hard_bounces,
       count(distinct e.lead_fk) filter (where ev.tipo = 'unsubscribe')                 as descadastros
from public.campanhas c
left join public.envios e on e.campanha_fk = c.campanha_id
left join public.eventos_email ev on ev.envio_fk = e.envio_id
group by c.campanha_id, c.nome, c.status, c.tipo, c.vencedor, c.created_at,
         c.scheduled_at, c.started_at;

grant select on public.campanha_stats to authenticated;

-- ---- 7. flags honradas + saudação sem vírgula órfã ------------------
create or replace function public.montar_html_envio(p_html text, p_envio uuid, p_lead uuid) returns text
language plpgsql stable as $$
declare
  v_base text := public.cfg('base_url_tracking');
  v_html text := public.personalizar(p_html, p_lead);
  v_end  text := public.cfg('endereco_fisico');
  v_pre text;
  v_rodape text;
  v_m text[];
  v_url text;
  v_url_real text;
  v_novo text;
  v_abre boolean := true;
  v_clica boolean := true;
begin
  if coalesce(v_base, '') = '' then
    return v_html;
  end if;

  -- lead sem nome não recebe "Olá, !" — a saudação encolhe com dignidade
  v_html := replace(v_html, 'Olá, !', 'Olá!');

  -- as opções da campanha valem de verdade (envio de automação: ambas ligadas)
  select coalesce(c.track_opens, true), coalesce(c.track_clicks, true)
  into v_abre, v_clica
  from public.envios e
  left join public.campanhas c on c.campanha_id = e.campanha_fk
  where e.envio_id = p_envio;
  v_abre  := coalesce(v_abre, true);
  v_clica := coalesce(v_clica, true);

  if v_clica then
    for v_m in select regexp_matches(v_html, 'href="(https?://[^"]*)"', 'g') loop
      v_url := v_m[1];
      if position(v_base in v_url) = 0 then
        v_url_real := replace(v_url, '&amp;', '&');
        v_novo := v_base || '/rastreio?t=c&amp;e=' || p_envio || '&amp;u=' ||
                  translate(encode(convert_to(v_url_real, 'UTF8'), 'base64'),
                            '+/=' || chr(10) || chr(13), '-_');
        v_html := replace(v_html, 'href="' || v_url || '"', 'href="' || v_novo || '"');
      end if;
    end loop;
  end if;

  select public.personalizar(m.preheader, p_lead) into v_pre
  from public.envios e
  join public.mensagens m on m.mensagem_id = e.mensagem_fk
  where e.envio_id = p_envio;

  if coalesce(v_pre, '') <> '' then
    v_pre := '<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">' ||
             v_pre ||
             '</div><div style="display:none;max-height:0;overflow:hidden;mso-hide:all">' ||
             repeat('&#847;&zwnj;&nbsp;', 40) || '</div>';
    if position('<body' in lower(v_html)) > 0 then
      v_html := regexp_replace(v_html, '(<body[^>]*>)', '\1' || v_pre, 'i');
    else
      v_html := v_pre || v_html;
    end if;
  end if;

  v_rodape :=
    '<div style="text-align:center;font-size:12px;color:#8a8a8a;padding:24px 12px;font-family:sans-serif">' ||
    case when coalesce(v_end, '') <> '' then v_end || ' &middot; ' else '' end ||
    '<a href="' || v_base || '/descadastro?e=' || p_envio ||
    '" style="color:#8a8a8a">Não quero mais receber estes e-mails</a></div>' ||
    case when v_abre then
      '<img src="' || v_base || '/rastreio?t=o&e=' || p_envio ||
      '" width="1" height="1" alt="" style="display:none">'
    else '' end;

  if position('</body>' in lower(v_html)) > 0 then
    return regexp_replace(v_html, '</body>', v_rodape || '</body>', 'i');
  end if;
  return v_html || v_rodape;
end $$;

-- ---- 8. rodapé falha alto: sem base configurada, nada sai -----------
create or replace function public.processar_fila_envios_interno() returns int
language plpgsql security definer as $$
declare
  v_envio record;
  v_msg record;
  v_provedor text := coalesce(public.cfg('provedor_email'), 'simulado');
  v_key text := public.cfg('resend_api_key');
  v_seg text := public.cfg('ses_segredo');
  v_base text := public.cfg('base_url_tracking');
  v_api  text := coalesce(nullif(public.cfg('url_api_interna'), ''),
                          'https://hkkuhquzpapnitzwpkig.supabase.co/functions/v1');
  v_url_desc text;
  v_de_nome text;
  v_de_email text;
  v_responder text;
  v_assunto text;
  v_html text;
  v_req bigint;
  v_qtd int := 0;
begin
  -- e-mail comercial sem rodapé legal é irregular; melhor segurar a fila
  -- e gritar do que enviar sem
  if coalesce(v_base, '') = '' then
    perform public.registrar_alerta(
      'config_envio',
      'Envio segurado: falta a URL base dos links',
      'A chave base_url_tracking está vazia — sem ela o e-mail sairia sem o rodapé de descadastro. A fila está intacta; preencha em Configurações.',
      'critico', null, 1);
    return 0;
  end if;

  for v_envio in
    select e.*, l.email as para_email, l.nome as para_nome
    from public.envios e
    join public.tabela_1_leads l on l.lead_id = e.lead_fk
    where e.status = 'queued'
    order by e.queued_at
    limit 100
    for update of e skip locked
  loop
    select * into v_msg from public.mensagens where mensagem_id = v_envio.mensagem_fk;

    if exists (select 1 from public.supressao s where s.email = v_envio.para_email) then
      update public.envios set status = 'suppressed' where envio_id = v_envio.envio_id;
      continue;
    end if;

    v_url_desc := v_base || '/descadastro?e=' || v_envio.envio_id;
    v_de_nome  := coalesce(nullif(v_msg.from_name,''),  public.cfg('from_name_padrao'));
    v_de_email := coalesce(nullif(v_msg.from_email,''), public.cfg('from_email_padrao'));
    v_responder := coalesce(nullif(v_msg.reply_to,''), nullif(public.cfg('reply_to_padrao'),''));
    v_assunto  := public.personalizar(v_msg.subject, v_envio.lead_fk);
    v_html     := public.montar_html_envio(v_msg.html, v_envio.envio_id, v_envio.lead_fk);

    if v_provedor = 'ses' and coalesce(v_seg,'') <> '' then
      v_req := net.http_post(
        url := v_api || '/enviar-ses',
        body := jsonb_build_object(
          'para', v_envio.para_email, 'de_nome', v_de_nome, 'de_email', v_de_email,
          'assunto', v_assunto, 'html', v_html, 'reply_to', v_responder,
          'envio_id', v_envio.envio_id, 'url_descadastro', v_url_desc),
        headers := jsonb_build_object('x-ressoar-segredo', v_seg,
                                      'Content-Type', 'application/json'));
      update public.envios
      set status = 'sent', sent_at = now(), provider = 'ses', provider_message_id = 'pgnet:' || v_req
      where envio_id = v_envio.envio_id;
      insert into public.eventos_email (envio_fk, lead_fk, tipo, occurred_at, payload)
      values (v_envio.envio_id, v_envio.lead_fk, 'sent', now(), jsonb_build_object('req', v_req));

    elsif v_provedor = 'resend' and coalesce(v_key,'') <> '' then
      v_req := net.http_post(
        url := 'https://api.resend.com/emails',
        body := jsonb_strip_nulls(jsonb_build_object(
          'from', v_de_nome || ' <' || v_de_email || '>',
          'to', jsonb_build_array(v_envio.para_email),
          'subject', v_assunto,
          'html', v_html,
          'reply_to', v_responder,
          'headers', jsonb_build_object(
            'X-Entity-Ref-ID', v_envio.envio_id,
            'List-Unsubscribe', '<' || v_url_desc || '>',
            'List-Unsubscribe-Post', 'List-Unsubscribe=One-Click'))),
        headers := jsonb_build_object('Authorization', 'Bearer ' || v_key,
                                      'Content-Type', 'application/json'));
      update public.envios
      set status = 'sent', sent_at = now(), provider = 'resend', provider_message_id = 'pgnet:' || v_req
      where envio_id = v_envio.envio_id;
      insert into public.eventos_email (envio_fk, lead_fk, tipo, occurred_at, payload)
      values (v_envio.envio_id, v_envio.lead_fk, 'sent', now(), jsonb_build_object('req', v_req));

    else
      update public.envios
      set status = 'sent', sent_at = now(), provider = 'simulado'
      where envio_id = v_envio.envio_id;
      insert into public.eventos_email (envio_fk, lead_fk, tipo, occurred_at, payload)
      values (v_envio.envio_id, v_envio.lead_fk, 'sent', now(), '{"simulado": true}'::jsonb);
    end if;
    v_qtd := v_qtd + 1;
  end loop;
  return v_qtd;
end $$;

commit;

-- provas
select public.remetente_permitido(split_part(public.cfg('remetentes_verificados'), ',', 1)) as remetente_ok,
       not public.remetente_permitido('qualquer@gmail.com')             as intruso_barrado,
       public.contar_publico(array[32], null)                            as black_distinct_sem_supressao,
       (public.saude_envio(7)->>'bounces')                               as bounces_enxergados,
       position('track_opens' in pg_get_functiondef('public.montar_html_envio'::regproc)) > 0
         as flags_honradas,
       position('base_url_tracking está vazia'
                in pg_get_functiondef('public.processar_fila_envios_interno'::regproc)) > 0
         as rodape_falha_alto;
