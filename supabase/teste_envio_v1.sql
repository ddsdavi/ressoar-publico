-- =====================================================================
-- ENVIO DE TESTE — manda o e-mail que está no editor para um endereço
-- digitado, sem tocar na lista e sem passar pela fila.
--
-- Pedido do Davi em 28/08/2026: "na Ressoar não tem como eu enviar um
-- email de teste escolhendo um endereço livre". Antes disto, o único
-- jeito de ver um e-mail de verdade na caixa era disparar campanha.
--
-- Três decisões de desenho, e os porquês:
--
--   1. IGNORA o `envio_pausado`, de propósito. A pausa protege a BASE
--      (nada de campanha sair sem querer); um teste para um endereço
--      digitado à mão é exatamente o oposto de um disparo acidental.
--
--   2. NÃO grava em `envios`. Teste não é histórico de lead — gravar
--      criaria lixo nos relatórios. O envio_id é um uuid descartável,
--      só para o pixel e o link de descadastro terem o formato real.
--
--   3. Passa pelo MESMO `montar_html_envio` do motor: rodapé com o
--      endereço da empresa, descadastro, pixel e rastreio de clique.
--      O que chega na caixa de teste é o que o lead receberia —
--      testar outra coisa seria enganar quem testa.
--
-- O portão `pre_request` (seguranca_rpc_v1) já barra anônimo e usuário
-- não aprovado antes de qualquer RPC rodar; os grants abaixo são a
-- segunda tranca da mesma porta.
-- =====================================================================

begin;

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

  -- quem recebe teste não é lead: os campos de personalização ganham um
  -- nome de exemplo em vez de sumirem, para o e-mail parecer o real
  v_html := replace(replace(replace(replace(coalesce(p_html, ''),
              '{{nome}}', 'Maria'),
              '{{nome_completo}}', 'Maria Exemplo'),
              '%FIRSTNAME%', 'Maria'),
              '%FULLNAME%', 'Maria Exemplo');
  v_assunto := '[TESTE] ' || replace(replace(coalesce(p_assunto, '(sem assunto)'),
                 '{{nome}}', 'Maria'), '%FIRSTNAME%', 'Maria');

  -- o caminho REAL do motor: rodapé, descadastro, pixel, rastreio de clique
  v_html := public.montar_html_envio(v_html, v_id, null);

  perform net.http_post(
    url := v_base || '/enviar-ses',
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

-- prova: a função existe e nega o que deve negar sem tocar na rede
select public.enviar_email_teste('x', 'y', 'endereco-torto') as deve_reclamar_endereco;
