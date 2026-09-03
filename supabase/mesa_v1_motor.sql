-- =====================================================================
-- MESA v1 (motor) — as correções de banco que a mesa de avaliação de
-- 30/08/2026 apontou em consenso. As de interface vêm em outro pacote.
--
-- 1. Link rastreado não corrompe mais URL com vários parâmetros.
--    O HTML serializado escreve o & do atributo como &amp;. O motor
--    codificava esse &amp; literal dentro do b64 — e o lead aterrissava
--    em ?utm_source=email&amp;utm_campaign=... com o parâmetro quebrado
--    (o site abre, a atribuição morre). O teste nunca revelava, porque
--    o teste manda links diretos de propósito.
--
-- 2. O vencedor do A/B agora alcança público de segmento.
--    disparar_vencedor só varria lead_listas; campanha A/B criada por
--    segmento tinha lista_ids nulo → "0 enfileirados", vencedor gravado,
--    e sem nova tentativa. Passa a resolver o público EXATAMENTE como o
--    disparo inicial (segmento ou listas), mantendo o not exists.
--
-- 3. A lista de campanhas para de multiplicar "enviados" por evento.
--    A view somava count(envio) com join em eventos_email — cada
--    abertura/clique duplicava o envio no total e derrubava a % exibida.
--
-- 4. Envio marcado "sent" ganha confirmação de verdade.
--    O pg_net é assíncrono: o motor marcava sent sem saber se a função
--    de envio aceitou. Um relógio agora casa a resposta com o envio:
--    recusa (status >= 400) ou erro de rede viram status 'erro', com
--    evento e alerta — a falha aparece em minutos, não semanas depois
--    numa taxa de abertura zerada.
-- =====================================================================

begin;

-- ---- 1. montar_html_envio v7.1: & limpo dentro do rastreio ----------
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
begin
  if coalesce(v_base, '') = '' then
    return v_html;
  end if;

  -- rastreio de clique: o href chega com &amp; (escape de atributo);
  -- o destino codificado precisa do & de verdade
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

  -- texto de prévia
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

  -- rodapé obrigatório + pixel
  v_rodape :=
    '<div style="text-align:center;font-size:12px;color:#8a8a8a;padding:24px 12px;font-family:sans-serif">' ||
    case when coalesce(v_end, '') <> '' then v_end || ' &middot; ' else '' end ||
    '<a href="' || v_base || '/descadastro?e=' || p_envio ||
    '" style="color:#8a8a8a">Não quero mais receber estes e-mails</a></div>' ||
    '<img src="' || v_base || '/rastreio?t=o&e=' || p_envio ||
    '" width="1" height="1" alt="" style="display:none">';

  if position('</body>' in lower(v_html)) > 0 then
    return regexp_replace(v_html, '</body>', v_rodape || '</body>', 'i');
  end if;
  return v_html || v_rodape;
end $$;

-- ---- 2. disparar_vencedor alcança segmento --------------------------
create or replace function public.disparar_vencedor(p_campanha uuid, p_vencedor text)
returns int
language plpgsql security definer as $$
declare
  v_camp record;
  v_msg uuid;
  v_def jsonb;
  v_lead uuid;
  v_qtd int := 0;
begin
  perform public.gate_operacao();
  if p_vencedor not in ('A','B') then raise exception 'vencedor deve ser A ou B'; end if;
  select * into v_camp from public.campanhas where campanha_id = p_campanha;
  if not found or v_camp.tipo <> 'ab' then return 0; end if;
  if v_camp.vencedor is not null then return 0; end if;   -- já foi

  v_msg := case p_vencedor when 'A' then v_camp.mensagem_fk else v_camp.mensagem_b_fk end;

  -- o mesmo público do disparo inicial, resolvido do mesmo jeito
  create temporary table alvo_vencedor (lead_fk uuid) on commit drop;
  if v_camp.segmento_fk is not null then
    select definicao into v_def from public.segmentos where segmento_id = v_camp.segmento_fk;
    insert into alvo_vencedor (lead_fk)
    select l from public.leads_do_segmento(coalesce(v_def, '{}'::jsonb)) l;
  else
    insert into alvo_vencedor (lead_fk)
    select distinct lead_fk from public.lead_listas
    where lista_fk = any(v_camp.lista_ids) and status = 1;
  end if;

  for v_lead in
    select a.lead_fk from alvo_vencedor a
    where not exists (select 1 from public.envios e
                      where e.campanha_fk = p_campanha and e.lead_fk = a.lead_fk)
  loop
    if public.enfileirar_email(v_lead, v_msg, p_campanha) is not null then
      v_qtd := v_qtd + 1;
    end if;
  end loop;

  update public.campanhas set vencedor = p_vencedor where campanha_id = p_campanha;
  return v_qtd;
end $$;

-- ---- 3. contagem honesta na lista de campanhas ----------------------
create or replace view public.campanha_stats as
select c.campanha_id, c.nome, c.status, c.tipo, c.vencedor, c.created_at,
       count(distinct e.envio_id) filter (where e.status not in ('suppressed','erro'))  as enviados,
       count(distinct e.envio_id) filter (where e.status = 'suppressed')                as suprimidos,
       count(distinct e.lead_fk) filter (where ev.tipo = 'open')                        as aberturas_unicas,
       count(distinct e.lead_fk) filter (where ev.tipo = 'click')                       as cliques_unicos,
       count(distinct e.lead_fk) filter (where ev.tipo = 'bounce_hard')                 as hard_bounces,
       count(distinct e.lead_fk) filter (where ev.tipo = 'unsubscribe')                 as descadastros
from public.campanhas c
left join public.envios e on e.campanha_fk = c.campanha_id
left join public.eventos_email ev on ev.envio_fk = e.envio_id
group by c.campanha_id, c.nome, c.status, c.tipo, c.vencedor, c.created_at;

-- ---- 4. confirmação de envio: a resposta encontra o envio -----------
create or replace function public.confirmar_envios() returns int
language plpgsql security definer set search_path to 'public' as $$
declare
  v_qtd int := 0;
begin
  -- envios recentes marcados sent cuja resposta do pg_net acusou falha
  with falhas as (
    select e.envio_id, e.lead_fk, r.status_code, r.error_msg,
           left(coalesce(r.content, r.error_msg, ''), 200) as corpo
    from public.envios e
    join net._http_response r
      on e.provider_message_id = 'pgnet:' || r.id
    where e.status = 'sent'
      and e.sent_at > now() - interval '2 hours'
      and (coalesce(r.status_code, 599) >= 400 or r.error_msg is not null or r.timed_out)
  ), marca as (
    update public.envios e
    set status = 'erro'
    from falhas f
    where e.envio_id = f.envio_id
    returning f.envio_id, f.lead_fk, f.status_code, f.corpo
  )
  insert into public.eventos_email (envio_fk, lead_fk, tipo, occurred_at, payload)
  select envio_id, lead_fk, 'send_error', now(),
         jsonb_build_object('status', status_code, 'resposta', corpo)
  from marca;
  get diagnostics v_qtd = row_count;

  if v_qtd > 0 then
    perform public.registrar_alerta(
      'envio_falhou',
      v_qtd || ' e-mail(s) recusados pelo servidor de envio',
      'O provedor respondeu erro. Veja os envios com status "erro" e o motivo em eventos_email (send_error). Causas comuns: remetente não verificado, segredo trocado, limite do provedor.',
      'critico',
      jsonb_build_object('quantidade', v_qtd),
      1);
  end if;
  return v_qtd;
end $$;

select cron.schedule('ressoar-confirmar-envios', '*/2 * * * *',
                     'select public.confirmar_envios()')
where not exists (select 1 from cron.job where jobname = 'ressoar-confirmar-envios');

commit;

-- provas estruturais (a prova funcional do & vai por fora, decodificando o u)
select position('alvo_vencedor' in pg_get_functiondef('public.disparar_vencedor'::regproc)) > 0
         as vencedor_resolve_segmento,
       position('count(DISTINCT e.envio_id)' in pg_get_viewdef('public.campanha_stats'::regclass)) > 0
         as stats_sem_multiplicar,
       (select count(*) from cron.job where jobname = 'ressoar-confirmar-envios') = 1
         as confirmacao_agendada;
