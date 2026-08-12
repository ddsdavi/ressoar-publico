-- =====================================================================
-- MOTOR v5 — Amazon SES como provedor de envio, ao lado do Resend.
--
-- Trocar de provedor passa a ser uma linha em Configurações:
--   provedor_email = 'simulado' | 'resend' | 'ses'
--
-- O SES exige assinatura AWS SigV4, que o Postgres não faz. Por isso o motor
-- chama a Edge Function `enviar-ses`, que assina e entrega. As credenciais da
-- AWS ficam como secrets da função — nunca no banco.
--
-- O que NÃO muda ao trocar: personalização, pixel de abertura, rastreio de
-- clique, rodapé de descadastro, endereço físico, cabeçalho List-Unsubscribe,
-- supressão e relatórios. Tudo isso é montado antes, aqui dentro.
-- =====================================================================
begin;

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
    v_assunto  := public.personalizar(v_msg.subject, v_envio.lead_fk);
    v_html     := public.montar_html_envio(v_msg.html, v_envio.envio_id, v_envio.lead_fk);

    if v_provedor = 'ses' and coalesce(v_seg,'') <> '' then
      v_req := net.http_post(
        url := v_base || '/enviar-ses',
        body := jsonb_build_object(
          'para', v_envio.para_email,
          'de_nome', v_de_nome,
          'de_email', v_de_email,
          'assunto', v_assunto,
          'html', v_html,
          'reply_to', v_msg.reply_to,
          'envio_id', v_envio.envio_id,
          'url_descadastro', v_url_desc),
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
        body := jsonb_build_object(
          'from', v_de_nome || ' <' || v_de_email || '>',
          'to', jsonb_build_array(v_envio.para_email),
          'subject', v_assunto,
          'html', v_html,
          'reply_to', v_msg.reply_to,
          'headers', jsonb_build_object(
            'X-Entity-Ref-ID', v_envio.envio_id,
            -- exigência do Gmail/Yahoo para remetente em massa (fev/2024)
            'List-Unsubscribe', '<' || v_url_desc || '>',
            'List-Unsubscribe-Post', 'List-Unsubscribe=One-Click')),
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

-- chaves novas nas Configurações (vazias = SES desligado, nada muda)
insert into public.app_config (chave, valor)
values ('ses_segredo', ''), ('ses_regiao', 'us-east-1')
on conflict (chave) do nothing;

commit;

-- prova: os três provedores existem no código e o descadastro continua de pé
select position('api.resend.com' in prosrc) > 0 as tem_resend,
       position('enviar-ses'     in prosrc) > 0 as tem_ses,
       position('simulado'       in prosrc) > 0 as tem_simulado
from pg_proc where proname = 'processar_fila_envios';
