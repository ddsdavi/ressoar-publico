-- =====================================================================
-- TESTE CONFIRMADO — "não aparece enviado. Fico sem saber se foi ou não"
-- (Davi, 30/08/2026, minutos depois da mesa encerrar com essa exata
-- pendência anotada como P2).
--
-- O envio de teste era fire-and-forget: o pg_net enfileira a chamada e a
-- função respondia "Teste enviado" sem saber se o servidor aceitou. Agora:
--   1. `enviar_email_teste` devolve também o protocolo da requisição;
--   2. `resultado_envio_teste(protocolo)` conta o que aconteceu de
--      verdade (aceito / recusado / ainda a caminho), lendo a resposta
--      que o pg_net guardou;
--   3. o painel consulta esse resultado e mostra verde ou vermelho.
--
-- A versão antiga (retorno text) cai para não deixar sobrecarga ambígua
-- no PostgREST.
-- =====================================================================

begin;

drop function if exists public.enviar_email_teste(text, text, text, text);

create or replace function public.enviar_email_teste(
  p_assunto text,
  p_html text,
  p_para text,
  p_preheader text default null
) returns jsonb
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
  v_pre      text;
  v_req      bigint;
begin
  if p_para is null or p_para !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    return jsonb_build_object('ok', false,
      'mensagem', 'Endereço inválido: ' || coalesce(p_para, '(vazio)'));
  end if;
  if coalesce(p_html, '') = '' then
    return jsonb_build_object('ok', false,
      'mensagem', 'O e-mail está vazio — escreva algo no editor antes de testar.');
  end if;
  if v_provedor <> 'ses' then
    return jsonb_build_object('ok', false,
      'mensagem', 'O provedor configurado é "' || v_provedor || '" — o teste só envia pelo servidor real (SES).');
  end if;
  if coalesce(v_seg, '') = '' or coalesce(v_base, '') = '' then
    return jsonb_build_object('ok', false,
      'mensagem', 'Faltou configuração (segredo do servidor ou URL base) em Configurações.');
  end if;

  v_html := replace(replace(replace(replace(coalesce(p_html, ''),
              '{{nome}}', 'Maria'),
              '{{nome_completo}}', 'Maria Exemplo'),
              '%FIRSTNAME%', 'Maria'),
              '%FULLNAME%', 'Maria Exemplo');
  v_assunto := '[TESTE] ' || replace(replace(coalesce(p_assunto, '(sem assunto)'),
                 '{{nome}}', 'Maria'), '%FIRSTNAME%', 'Maria');
  v_pre := replace(replace(coalesce(p_preheader, ''),
             '{{nome}}', 'Maria'), '%FIRSTNAME%', 'Maria');

  v_html := public.montar_html_teste(v_html, nullif(v_pre, ''));

  select net.http_post(
    url := v_api || '/enviar-ses',
    body := jsonb_build_object(
      'para', p_para, 'de_nome', v_de_nome, 'de_email', v_de_email,
      'assunto', v_assunto, 'html', v_html, 'reply_to', v_resp,
      'envio_id', v_id,
      'url_descadastro', v_base || '/descadastro?e=teste'),
    headers := jsonb_build_object('x-ressoar-segredo', v_seg,
                                  'Content-Type', 'application/json'))
  into v_req;

  return jsonb_build_object('ok', true, 'req', v_req,
    'mensagem', 'Teste a caminho de ' || p_para || '…');
end $$;

revoke all on function public.enviar_email_teste(text, text, text, text) from public, anon;
grant execute on function public.enviar_email_teste(text, text, text, text) to authenticated, service_role;

-- o que aconteceu de verdade com aquele envio de teste
create or replace function public.resultado_envio_teste(p_req bigint) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  r record;
begin
  select status_code, error_msg, timed_out, left(coalesce(content, ''), 200) as corpo
  into r
  from net._http_response
  where id = p_req;

  if not found then
    return jsonb_build_object('estado', 'pendente');
  end if;
  if r.timed_out or r.error_msg is not null or coalesce(r.status_code, 599) >= 400 then
    return jsonb_build_object('estado', 'erro',
      'status', r.status_code,
      'detalhe', coalesce(r.error_msg, r.corpo));
  end if;
  return jsonb_build_object('estado', 'ok', 'status', r.status_code);
end $$;

revoke all on function public.resultado_envio_teste(bigint) from public, anon;
grant execute on function public.resultado_envio_teste(bigint) to authenticated, service_role;

commit;

-- prova: envio inválido responde na hora; o formato novo tem ok/req
select (public.enviar_email_teste('x', '<p>x</p>', 'sem-arroba'))->>'ok' = 'false' as valida_email,
       (public.resultado_envio_teste(999999999))->>'estado' = 'pendente'          as pendente_quando_nao_ha;
