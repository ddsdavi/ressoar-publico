-- =====================================================================
-- TESTE FIEL v2 — o pré-cabeçalho entra no e-mail de teste.
--
-- No envio real o pré-cabeçalho sai da mensagem gravada e o motor injeta
-- o trecho invisível no topo (motor_v7). O TESTE nunca fez isso: o RPC
-- nem recebia o campo — quem digitava um pré-cabeçalho e mandava um
-- teste via o Gmail mostrar o começo do texto no lugar ("não aparece
-- como um pre header", 30/08/2026). Agora o painel manda o campo junto
-- e a moldura de teste injeta idêntico ao motor.
--
-- As versões antigas (sem o parâmetro) são dropadas para não deixar
-- sobrecarga ambígua no PostgREST — duas assinaturas com os mesmos
-- três primeiros nomes fariam o RPC falhar com "could not choose".
-- =====================================================================

begin;

drop function if exists public.montar_html_teste(text);
drop function if exists public.enviar_email_teste(text, text, text);

create or replace function public.montar_html_teste(
  p_html text,
  p_preheader text default null
) returns text
language plpgsql stable as $$
declare
  v_base text := public.cfg('base_url_tracking');
  v_html text := coalesce(p_html, '');
  v_end  text := public.cfg('endereco_fisico');
  v_pre  text;
  v_rodape text;
begin
  if coalesce(v_base, '') = '' then
    return v_html;
  end if;

  -- pré-cabeçalho invisível no topo, idêntico ao do motor (motor_v7):
  -- o texto e depois o enchimento que impede o Gmail de completar a linha
  -- com o começo do e-mail
  if coalesce(p_preheader, '') <> '' then
    v_pre := '<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">' ||
             p_preheader ||
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
    '<a href="' || v_base || '/descadastro?e=teste' ||
    '" style="color:#8a8a8a">Não quero mais receber estes e-mails</a></div>';

  if position('</body>' in lower(v_html)) > 0 then
    return regexp_replace(v_html, '</body>', v_rodape || '</body>', 'i');
  end if;
  return v_html || v_rodape;
end $$;

create or replace function public.enviar_email_teste(
  p_assunto text,
  p_html text,
  p_para text,
  p_preheader text default null
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
  v_pre      text;
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
  v_pre := replace(replace(coalesce(p_preheader, ''),
             '{{nome}}', 'Maria'), '%FIRSTNAME%', 'Maria');

  v_html := public.montar_html_teste(v_html, nullif(v_pre, ''));

  perform net.http_post(
    url := v_api || '/enviar-ses',
    body := jsonb_build_object(
      'para', p_para, 'de_nome', v_de_nome, 'de_email', v_de_email,
      'assunto', v_assunto, 'html', v_html, 'reply_to', v_resp,
      'envio_id', v_id,
      'url_descadastro', v_base || '/descadastro?e=teste'),
    headers := jsonb_build_object('x-ressoar-segredo', v_seg,
                                  'Content-Type', 'application/json'));

  return 'Teste enviado para ' || p_para || '. Confira também a caixa de spam.';
end $$;

revoke all on function public.enviar_email_teste(text, text, text, text) from public, anon;
grant execute on function public.enviar_email_teste(text, text, text, text) to authenticated, service_role;

commit;

-- prova: o pré-cabeçalho digitado abre o e-mail de teste, invisível
select position('display:none' in public.montar_html_teste('<p>x</p>', 'Vem aí…')) = 1 as preheader_no_topo,
       position('Vem aí…' in public.montar_html_teste('<p>x</p>', 'Vem aí…')) > 0 as texto_presente;
