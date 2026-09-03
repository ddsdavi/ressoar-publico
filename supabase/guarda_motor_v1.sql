-- =====================================================================
-- GUARDA DO MOTOR — religa o freio que uma migração minha cortou.
--
-- A cadeia correta, construída depois do acidente dos 4 leads
-- (trava_envio_v1) e do aquecimento (aquecimento_v1), era:
--
--   cron → processar_fila_envios()          [WRAPPER: pausa, teto, ensaio]
--            └── processar_fila_envios_interno()   [o motor de verdade]
--
-- Em 29/08/2026, `links_marca_v1.sql` precisou trocar o endereço da API
-- interna no motor — e recriou `processar_fila_envios` com o corpo
-- COMPLETO do motor, sem perceber que aquele nome, desde a trava, era o
-- do WRAPPER. Resultado: o botão de pânico (`envio_pausado`), o modo
-- ensaio (`envio_so_para`), o teto do aquecimento e o freio de
-- entregabilidade ficaram todos escrevendo numa chave que ninguém mais
-- lia. Descoberto em 30/08 pela mesa de avaliação, com a fila a zero —
-- nada vazou, mas só por sorte de agenda.
--
-- Conserto em duas peças, na ordem que não deixa janela aberta:
--   1. `processar_fila_envios_interno` passa a ser o motor NOVO
--      (o corpo de links_marca_v1, com `url_api_interna`) — até aqui o
--      nome público ainda é o motor sem freio, como estava;
--   2. `processar_fila_envios` volta a ser o WRAPPER (o evoluído do
--      aquecimento_v1: pausa + teto diário + ensaio), chamando o interno.
--
-- Regra de processo daqui em diante, escrita onde vai ser lida:
-- **o corpo do motor só evolui em `processar_fila_envios_interno`** —
-- o nome público pertence ao wrapper, para sempre.
-- =====================================================================

begin;

-- ---- 1. o motor de verdade, no nome interno --------------------------
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

-- ---- 2. o wrapper de volta ao nome público (o evoluído do aquecimento) ----
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

commit;

-- provas: o nome público voltou a ter freio; o interno é o motor novo;
-- e, com a pausa ligada (está), o cron recebe 0
select position('envio_pausado' in pg_get_functiondef('public.processar_fila_envios'::regproc)) > 0
         as wrapper_tem_freio,
       position('url_api_interna' in pg_get_functiondef('public.processar_fila_envios_interno'::regproc)) > 0
         as interno_e_o_novo,
       public.processar_fila_envios() as retorno_com_pausa;
