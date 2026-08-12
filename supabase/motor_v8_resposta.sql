-- =====================================================================
-- MOTOR v8 — endereço de resposta padrão.
--
-- O que aconteceu: o e-mail saiu de contato@mkt.seudominio.com.br,
-- que é um subdomínio criado só para ENVIAR. Ele não tem MX, então não
-- recebe nada. Quem respondeu levou "Endereço não encontrado".
--
-- Isso é grave por três motivos:
--   1. Resposta de cliente se perde — e resposta é a coisa mais valiosa
--      que um e-mail de marketing pode gerar.
--   2. Filtro de spam testa se o domínio remetente aceita mensagem.
--      Remetente que não recebe é padrão de quem dispara e some.
--   3. Responder é o sinal positivo mais forte para o Gmail. Se a resposta
--      volta com erro, o sinal vira negativo.
--
-- A solução usual: FROM no subdomínio (isola a reputação) e Reply-To numa
-- caixa real do domínio principal. Quem responder cai numa caixa que existe.
-- =====================================================================
begin;

insert into public.app_config (chave, valor)
values ('reply_to_padrao', '')
on conflict (chave) do nothing;

create or replace function public.processar_fila_envios() returns int
language plpgsql security definer as $$
declare
  v_envio record;
  v_msg record;
  v_provedor text := coalesce(public.cfg('provedor_email'), 'simulado');
  v_key text := public.cfg('resend_api_key');
  v_seg text := public.cfg('ses_segredo');
  v_base text := public.cfg('base_url_tracking');
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
    -- a mensagem manda; sem ela, o padrão das Configurações
    v_responder := coalesce(nullif(v_msg.reply_to,''), nullif(public.cfg('reply_to_padrao'),''));
    v_assunto  := public.personalizar(v_msg.subject, v_envio.lead_fk);
    v_html     := public.montar_html_envio(v_msg.html, v_envio.envio_id, v_envio.lead_fk);

    if v_provedor = 'ses' and coalesce(v_seg,'') <> '' then
      v_req := net.http_post(
        url := v_base || '/enviar-ses',
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
            -- exigência do Gmail/Yahoo para remetente em massa (fev/2024)
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

select coalesce(nullif(public.cfg('reply_to_padrao'), ''),
                '(PRECISA PREENCHER — sem isto a resposta volta com erro)') as reply_to,
       coalesce(nullif(public.cfg('endereco_fisico'), ''),
                '(PRECISA PREENCHER)') as endereco;
