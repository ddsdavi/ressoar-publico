-- =====================================================================
-- LINKS COM A CARA DA MARCA — separa duas coisas que moravam na mesma
-- chave e quase se estrangularam em 29/08/2026.
--
-- `base_url_tracking` sempre serviu para DOIS papéis ao mesmo tempo:
--   a) os links que o LEAD vê (descadastro, rastreio, pixel);
--   b) o endereço que o MOTOR chama para enviar (função enviar-ses).
--
-- Aí o Davi exigiu, com razão, que o lead nunca veja supabase.co — os
-- links passaram para https://em.drapatriciadomingos.com.br (um Worker
-- da marca que também conserta um defeito real do gateway do Supabase,
-- que serve text/plain quando o navegador aceita compressão). Só que
-- mudar a chave mudaria TAMBÉM o endereço da API: o motor tentaria
-- enviar por em.drapatriciadomingos.com.br/enviar-ses, que devolve 404
-- de propósito (o Worker só abre descadastro e rastreio — proxy aberto
-- para a função de envio seria um túnel público com o nosso domínio).
--
-- Daqui em diante:
--   `base_url_tracking`  = o que o lead vê  -> domínio da marca
--   `url_api_interna`    = o que o motor chama -> functions do projeto
-- =====================================================================

begin;

insert into public.app_config (chave, valor)
values ('url_api_interna', 'https://hkkuhquzpapnitzwpkig.supabase.co/functions/v1')
on conflict (chave) do update set valor = excluded.valor;

-- ---- o motor, idêntico ao v8 exceto o endereço da chamada de envio ----
create or replace function public.processar_fila_envios() returns int
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
    -- a mensagem manda; sem ela, o padrão das Configurações
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

-- ---- o envio de teste, com a mesma separação ----
create or replace function public.enviar_email_teste(
  p_assunto text,
  p_html text,
  p_para text
) returns text
language plpgsql security definer as $$
declare
  v_provedor text := coalesce(public.cfg('provedor_email'), 'simulado');
  v_seg      text := public.cfg('ses_segredo');
  v_base     text := public.cfg('base_url_tracking');
  v_api      text := coalesce(nullif(public.cfg('url_api_interna'), ''),
                              'https://hkkuhquzpapnitzwpkig.supabase.co/functions/v1');
  v_de_nome  text := public.cfg('from_name_padrao');
  v_de_email text := public.cfg('from_email_padrao');
  v_resp     text := nullif(public.cfg('reply_to_padrao'), '');
  v_id       uuid := gen_random_uuid();
  v_html     text;
  v_assunto  text;
begin
  if p_para is null or p_para !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    return 'Endereço inválido: ' || coalesce(p_para, '(vazio)');
  end if;
  if coalesce(p_html, '') = '' then
    return 'O e-mail está vazio — escreva algo no editor antes de testar.';
  end if;
  if v_provedor <> 'ses' then
    return 'O provedor configurado é "' || v_provedor || '" — o teste só envia pelo SES.';
  end if;
  if coalesce(v_seg, '') = '' or coalesce(v_base, '') = '' then
    return 'Faltou configuração (segredo do SES ou URL base) em Configurações.';
  end if;

  v_html := replace(replace(replace(replace(coalesce(p_html, ''),
              '{{nome}}', 'Maria'),
              '{{nome_completo}}', 'Maria Exemplo'),
              '%FIRSTNAME%', 'Maria'),
              '%FULLNAME%', 'Maria Exemplo');
  v_assunto := '[TESTE] ' || replace(replace(coalesce(p_assunto, '(sem assunto)'),
                 '{{nome}}', 'Maria'), '%FIRSTNAME%', 'Maria');

  v_html := public.montar_html_envio(v_html, v_id, null);

  perform net.http_post(
    url := v_api || '/enviar-ses',
    body := jsonb_build_object(
      'para', p_para, 'de_nome', v_de_nome, 'de_email', v_de_email,
      'assunto', v_assunto, 'html', v_html, 'reply_to', v_resp,
      'envio_id', v_id,
      'url_descadastro', v_base || '/descadastro?e=' || v_id),
    headers := jsonb_build_object('x-ressoar-segredo', v_seg,
                                  'Content-Type', 'application/json'));

  return 'Teste enviado para ' || p_para || '. Confira também a caixa de spam.';
end $$;

revoke all on function public.enviar_email_teste(text, text, text) from public, anon;
grant execute on function public.enviar_email_teste(text, text, text) to authenticated, service_role;

commit;

-- prova: as duas pontas apontam para onde devem
select public.cfg('base_url_tracking') as links_do_lead,
       public.cfg('url_api_interna')  as api_do_motor;
