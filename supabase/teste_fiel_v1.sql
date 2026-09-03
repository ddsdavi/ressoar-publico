-- =====================================================================
-- TESTE FIEL — o e-mail de teste passa a se comportar como o de verdade.
--
-- O de 29/08/2026: o teste montava o e-mail com um envio_id inventado
-- (gen_random_uuid sem linha na tabela). Resultado no Gmail do Davi:
-- o botão dava "link inválido" (o rastreio não achava o envio) e o
-- descadastro caía em "Este link não está mais ativo". "Nada a ver!!!"
-- — e é verdade: quem testa quer ensaiar o caminho do lead inteiro.
--
-- Criar um envio de verdade só para o teste também não serve: ele
-- entraria nas métricas (abertura e clique de teste contando como
-- engajamento) e exigiria um lead de mentira na base.
--
-- A saída: uma moldura própria para teste, igual à real no visual,
-- diferente no encanamento —
--   * links do corpo ficam DIRETOS (clique leva ao destino na hora;
--     teste não grava evento nenhum);
--   * o descadastro aponta ?e=teste, e a página trata esse marcador
--     como demonstração completa (confirma, "descadastra", e avisa
--     que era um teste — nada é alterado);
--   * sem pixel de abertura (não existe envio para marcar aberto).
-- =====================================================================

begin;

create or replace function public.montar_html_teste(p_html text) returns text
language plpgsql stable as $$
declare
  v_base text := public.cfg('base_url_tracking');
  v_html text := coalesce(p_html, '');
  v_end  text := public.cfg('endereco_fisico');
  v_rodape text;
begin
  if coalesce(v_base, '') = '' then
    return v_html;
  end if;

  -- mesmo rodapé do envio real (motor_v7), com o marcador de teste no lugar
  -- do envio_id — e sem o pixel
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

  v_html := public.montar_html_teste(v_html);

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

commit;

-- prova: o teste sai com link direto e descadastro de demonstração
select position('/rastreio?t=c' in public.montar_html_teste(
         '<p><a href="https://www.google.com/">x</a></p>')) = 0 as links_diretos,
       position('/descadastro?e=teste' in public.montar_html_teste('<p>x</p>')) > 0 as descadastro_demo;
