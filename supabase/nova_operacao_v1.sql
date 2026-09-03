-- =====================================================================
-- NOVA OPERAÇÃO — tira de uma instalação recém-criada o conteúdo que as
-- migrações trazem da operação onde a plataforma nasceu.
--
-- NÃO está em ordem.txt. Roda UMA vez, à mão, logo depois do instalador:
--
--     python scripts/run_sql_file.py supabase/nova_operacao_v1.sql
--
-- e só numa base VAZIA (sem leads e sem envios). A primeira coisa que ele
-- faz é conferir isso; se a base já tem gente, recusa e não altera nada.
--
-- Por que existe: as migrações são as mesmas para toda instalação, e
-- algumas criam, junto com a estrutura, o CONTEÚDO da operação de origem
-- — automações de recuperação com os textos e os links daquela casa, as
-- mensagens de sequência, a tag do ManyChat de lá. Numa instalação nova
-- isso é ruído no melhor caso; no pior, uma automação que nasce ATIVA
-- (recuperação de carrinho, pagamento que não caiu) mandando o e-mail de
-- outra operação para os leads desta. Este roteiro apaga exatamente esse
-- conteúdo, e nada mais: nenhuma tabela, função, permissão, relógio ou
-- configuração gravada pelo instalador.
--
-- O que apaga:
--   · as automações [RESSOAR] … de recuperacao_e_jogadas_v1,
--     janela_quente_v1/v2 e desafio_planilha_v1 (passos e execuções caem
--     junto, por cascata);
--   · as mensagens que essas automações usavam;
--   · a tag do ManyChat da operação de origem (manychat_tag_esc);
--   · os endereços "da casa" (emails_da_operacao) — versões anteriores da
--     migração traziam um.
--
-- O que NÃO mexe, de propósito: regras de pontuação, campos, listas de
-- produto (nascem vazias e servem para qualquer operação), e os valores
-- que o instalador gravou a partir do .env (url_api_interna, url_painel,
-- remetentes_verificados).
--
-- E deixa a marca `conteudo_origem = removido` em app_config: as quatro
-- migrações que semeiam esse conteúdo (recuperacao_e_jogadas_v1,
-- janela_quente_v1, janela_quente_v2_ligada, desafio_planilha_v1) a veem
-- e pulam. Sem a marca, a próxima atualização (./instalar.sh) recriava
-- tudo isto — com a base já cheia, e sem este roteiro poder rodar de novo.
-- Para trazer o conteúdo de volta (não há motivo numa cópia): apagar a
-- marca e rodar o instalador.
-- =====================================================================

do $$
declare
  v_leads  bigint;
  v_envios bigint;
  v_autos  int;
  v_msgs   int;
begin
  select count(*) into v_leads  from public.tabela_1_leads;
  select count(*) into v_envios from public.envios;
  if v_leads > 0 or v_envios > 0 then
    raise exception 'nova_operacao_v1: esta base tem % leads e % envios. Este roteiro é só para uma instalação nova e vazia. Nada foi alterado.',
      v_leads, v_envios;
  end if;

  delete from public.automacoes where nome in (
    '[RESSOAR] Pagamento não caiu',
    '[RESSOAR] Carrinho abandonado',
    '[RESSOAR] Aluno → Black / Acompanhamento',
    '[RESSOAR] Lives → Desafio',
    '[RESSOAR] Reativar esteira',
    '[RESSOAR] Formação — janela quente',
    '[RESSOAR] Formação — janela quente (revisar e ligar)',
    '[RESSOAR] Desafio — planilha de compradores');
  get diagnostics v_autos = row_count;

  delete from public.mensagens where nome in (
    '[Pagamento 1/2] Seu pagamento ainda não caiu',
    '[Pagamento 2/2] Seu código deve expirar',
    '[Carrinho] Você parou no meio',
    '[Aluno 1/2] Você já está dentro — e tem um degrau a mais',
    '[Aluno 2/2] Quando a dúvida trava a prática',
    '[Lives 1/2] Da live para a prática',
    '[Lives 2/2] A casa que adoece e a casa que sustenta',
    '[Janela quente 1/3] O próximo passo',
    '[Janela quente 2/3] O caminho de mais de 1.300 alunas',
    '[Janela quente 3/3] Última da sequência',
    '[Janela quente 4/4] Um mês depois',
    '[Reativação] Faz um tempo',
    '[RASCUNHO] Janela quente 1/3 — o próximo passo',
    '[RASCUNHO] Janela quente 2/3 — prova social',
    '[RASCUNHO] Janela quente 3/3 — última da sequência');
  get diagnostics v_msgs = row_count;

  update public.app_config set valor = '' where chave = 'manychat_tag_esc';
  delete from public.emails_da_operacao;

  -- a marca que faz as migrações de conteúdo pularem daqui em diante
  insert into public.app_config (chave, valor) values ('conteudo_origem', 'removido')
  on conflict (chave) do update set valor = excluded.valor;

  raise notice 'nova_operacao_v1: % automações e % mensagens da operação de origem removidas.',
    v_autos, v_msgs;
end $$;

-- prova: nada da operação de origem sobrou
select (select count(*) from public.automacoes where nome like '[RESSOAR]%')      as automacoes_de_origem,
       (select count(*) from public.mensagens
         where nome like '[Pagamento %' or nome like '[Carrinho]%' or nome like '[Aluno %'
            or nome like '[Lives %' or nome like '[Janela quente %' or nome like '[Reativação]%'
            or nome like '[RASCUNHO] Janela quente%')                            as mensagens_de_origem,
       (select valor from public.app_config where chave = 'manychat_tag_esc')    as tag_manychat,
       (select count(*) from public.emails_da_operacao)                          as enderecos_da_casa,
       (select valor from public.app_config where chave = 'conteudo_origem')     as marca;
