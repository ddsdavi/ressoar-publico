-- =====================================================================
-- RECUPERAÇÃO E JOGADAS v1 — o dinheiro que já estava na mesa.
--
-- A Hotmart vinha avisando e ninguém escutava: 135 boletos/PIX gerados,
-- 27 carrinhos abandonados e 13 pagamentos atrasados estão gravados em
-- `eventos_sistema` sem nenhuma automação pendurada. Cada um desses é
-- alguém que JÁ decidiu comprar e não terminou.
--
-- E as jogadas do lead scoring que ainda dependiam de campanha manual
-- viram automação de verdade, cada uma com o gatilho que já existe:
--
--   Aluno → Black/Acompanhamento   gatilho: compra da Formação
--   Lives → Desafio                gatilho: entrada na lista das Lives
--   Segunda chamada                fase 2 da própria janela quente
--   Reativar esteira               enfileiramento semanal com teto
--
-- Regras que valem para todas:
--   * Toda sequência confere ANTES de cada e-mail se a pessoa já fez o
--     que a sequência queria. Fez, sai — ninguém recebe oferta do que
--     acabou de comprar.
--   * Nenhum link inventado. Só endereços conferidos no ar hoje:
--     a página do Desafio, a da Formação e o WhatsApp do suporte.
--   * Evento antigo não dispara nada: o motor só processa evento novo
--     (`processado_em is null`), então ligar isto não despeja o passado.
-- =====================================================================
begin;

-- Remetente: sai de app_config (from_name_padrao / from_email_padrao /
-- reply_to_padrao), nao escrito a mao. Duas razoes: a migracao serve a
-- qualquer instalacao, e nome de pessoa nao mora em arquivo versionado --
-- este repositorio tem espelho publico.

do $$
declare
  v_pag1 uuid; v_pag2 uuid; v_car uuid;
  v_alu1 uuid; v_alu2 uuid; v_liv1 uuid; v_liv2 uuid;
  v_seg uuid; v_rea uuid;
  v_auto uuid; v_jq uuid;
  v_comprou_qualquer jsonb;
  v_tem_formacao jsonb;
begin

-- Trava de reexecução. Sem ela, rodar o instalador uma segunda vez criava 9
-- mensagens e 5 automações duplicadas — e uma delas ('[RESSOA] Pagamento não
-- caiu') nasce ATIVA, com passo de e-mail. O README promete que rodar de novo
-- é seguro; até 12/08/2026 essa promessa era falsa justamente aqui.
if exists (select 1 from public.automacoes
           where nome = '[RESSOA] Pagamento não caiu') then
  raise notice 'automações de recuperação já existem; nada a fazer';
  return;
end if;

-- ===================================================================
-- MENSAGENS
-- ===================================================================
insert into public.mensagens (nome, from_name, from_email, reply_to, subject, preheader, html)
values (
  '[Pagamento 1/2] Seu pagamento ainda não caiu',
  public.cfg('from_name_padrao'), public.cfg('from_email_padrao'), public.cfg('reply_to_padrao'),
  '{{nome}}, seu pagamento ainda não foi confirmado',
  'Se já pagou, pode ignorar — às vezes leva algumas horas.',
  '<p>Oi, {{nome}}!</p>'
  || '<p>Você começou a compra {{evento.produto}} e o pagamento ainda não foi confirmado por aqui.</p>'
  || '<p>Se você já pagou, ignore este e-mail: boleto pode levar até 3 dias úteis para compensar, e PIX às vezes demora alguns minutos para aparecer.</p>'
  || '<p>Se ainda não pagou, o código costuma ter validade curta. Depois que ele expira, é só refazer o pedido — leva um minuto:</p>'
  || '<p><a href="https://biopatriciadomingos.com.br">Refazer meu pedido</a></p>'
  || '<p>E se algo deu errado no caminho — cartão recusado, código que não abriu, dúvida na hora de pagar — fale com a nossa equipe pelo <a href="https://wa.link/hg734s">WhatsApp do suporte</a>. A gente resolve com você.</p>'
  || '<p>Com carinho,<br>Patrícia</p>')
returning mensagem_id into v_pag1;

insert into public.mensagens (nome, from_name, from_email, reply_to, subject, preheader, html)
values (
  '[Pagamento 2/2] Seu código deve expirar',
  public.cfg('from_name_padrao'), public.cfg('from_email_padrao'), public.cfg('reply_to_padrao'),
  'Seu código de pagamento está prestes a expirar',
  'Último aviso sobre este pedido.',
  '<p>Oi, {{nome}}!</p>'
  || '<p>Este é o último aviso sobre o seu pedido {{evento.produto}}: o código de pagamento tem validade curta e o seu está no fim.</p>'
  || '<p>Quando ele expira, o pedido é cancelado sozinho — mas nada se perde: dá para refazer na hora.</p>'
  || '<p><a href="https://biopatriciadomingos.com.br">Refazer meu pedido</a></p>'
  || '<p>Se você desistiu, tudo bem também — não vou insistir mais. E se a dúvida for sobre o conteúdo ou a forma de pagar, a nossa equipe responde rápido no <a href="https://wa.link/hg734s">WhatsApp</a>.</p>'
  || '<p>Com carinho,<br>Patrícia</p>')
returning mensagem_id into v_pag2;

insert into public.mensagens (nome, from_name, from_email, reply_to, subject, preheader, html)
values (
  '[Carrinho] Você parou no meio',
  public.cfg('from_name_padrao'), public.cfg('from_email_padrao'), public.cfg('reply_to_padrao'),
  '{{nome}}, você parou no meio do caminho',
  'Ficou faltando um passo para concluir.',
  '<p>Oi, {{nome}}!</p>'
  || '<p>Vi que você chegou até a página de pagamento {{evento.produto}} e não concluiu.</p>'
  || '<p>Acontece — a vida puxa. Se ainda fizer sentido para você, o caminho continua aberto:</p>'
  || '<p><a href="https://biopatriciadomingos.com.br">Concluir meu pedido</a></p>'
  || '<p>E se travou alguma coisa na hora de pagar, me conta respondendo este e-mail ou fale com a equipe pelo <a href="https://wa.link/hg734s">WhatsApp</a>. Já vi de tudo, e quase sempre é rápido de resolver.</p>'
  || '<p>Com carinho,<br>Patrícia</p>')
returning mensagem_id into v_car;

insert into public.mensagens (nome, from_name, from_email, reply_to, subject, preheader, html)
values (
  '[Aluno 1/2] Você já está dentro — e tem um degrau a mais',
  public.cfg('from_name_padrao'), public.cfg('from_email_padrao'), public.cfg('reply_to_padrao'),
  '{{nome}}, como está indo a sua Formação?',
  'Uma pergunta e um convite para quem já está dentro.',
  '<p>Oi, {{nome}}!</p>'
  || '<p>Faz uma semana que você entrou na Formação em Biorressonância Aplicada. Queria saber, de verdade: como está indo? Pode responder este e-mail — eu leio.</p>'
  || '<p>E queria te contar uma coisa que costuma acontecer por volta desta altura. Conforme a prática avança, aparecem as perguntas que nenhum módulo responde sozinho: o caso específico, o paciente que não melhora, a dúvida que só some com alguém olhando junto.</p>'
  || '<p>É exatamente para isso que existe o <b>Acompanhamento Ressonante</b> — e, para quem quer o pacote completo da minha metodologia, a <b>Black Ressonante Infinita</b>.</p>'
  || '<p>Não é para todo mundo, e não tem pressa. Se quiser entender se faz sentido para o seu momento, fale comigo e com a equipe pelo <a href="https://wa.link/hg734s">WhatsApp</a> — a gente te explica sem compromisso.</p>'
  || '<p>Com carinho,<br>Patrícia</p>')
returning mensagem_id into v_alu1;

insert into public.mensagens (nome, from_name, from_email, reply_to, subject, preheader, html)
values (
  '[Aluno 2/2] Quando a dúvida trava a prática',
  public.cfg('from_name_padrao'), public.cfg('from_email_padrao'), public.cfg('reply_to_padrao'),
  'O que trava a maioria dos terapeutas no começo',
  'E o que costuma destravar.',
  '<p>Oi, {{nome}}!</p>'
  || '<p>O que mais trava terapeuta no começo não é falta de técnica. É a insegurança na hora de decidir: “é isso mesmo que estou vendo?”.</p>'
  || '<p>Estudar de novo o mesmo módulo não resolve isso. O que resolve é ter alguém experiente olhando o seu caso com você — foi por isso que criei o <b>Acompanhamento Ressonante</b>.</p>'
  || '<p>Se você sente que chegou nesse ponto, fale com a gente pelo <a href="https://wa.link/hg734s">WhatsApp</a> e eu te explico como funciona.</p>'
  || '<p>Se ainda não é o momento, siga firme no seu ritmo — a Formação é sua por 2 anos, e as lives de segunda continuam abertas.</p>'
  || '<p>Com carinho,<br>Patrícia</p>')
returning mensagem_id into v_alu2;

insert into public.mensagens (nome, from_name, from_email, reply_to, subject, preheader, html)
values (
  '[Lives 1/2] Da live para a prática',
  public.cfg('from_name_padrao'), public.cfg('from_email_padrao'), public.cfg('reply_to_padrao'),
  '{{nome}}, o primeiro passo prático depois das lives',
  'Assistir ajuda. Aplicar muda a casa.',
  '<p>Oi, {{nome}}!</p>'
  || '<p>Que bom ter você nas lives de segunda! Elas são de graça e vão continuar sendo — é onde eu mostro o que a biorressonância faz pela energia de uma casa.</p>'
  || '<p>Mas tem uma diferença grande entre assistir e aplicar. Quem aplica sente a mudança no ambiente em poucos dias; quem só assiste guarda a informação para depois — e o depois quase nunca chega.</p>'
  || '<p>O <b>Desafio Casa Harmonizada</b> existe para essa passagem: é o passo a passo prático para harmonizar a sua casa, com acompanhamento, por um valor simbólico.</p>'
  || '<p><a href="https://biopatriciadomingos.com.br">Quero fazer o Desafio</a></p>'
  || '<p>Com carinho,<br>Patrícia</p>')
returning mensagem_id into v_liv1;

insert into public.mensagens (nome, from_name, from_email, reply_to, subject, preheader, html)
values (
  '[Lives 2/2] A casa que adoece e a casa que sustenta',
  public.cfg('from_name_padrao'), public.cfg('from_email_padrao'), public.cfg('reply_to_padrao'),
  'A sua casa está te sustentando ou te drenando?',
  'Dá para sentir a diferença em poucos dias.',
  '<p>Oi, {{nome}}!</p>'
  || '<p>Tem casa que descansa e tem casa que cansa. Quem já sentiu isso na pele sabe do que estou falando: você chega, e em vez de aliviar, pesa.</p>'
  || '<p>Quase sempre não é a pessoa que está errada — é o ambiente. E ambiente se ajusta.</p>'
  || '<p>No <b>Desafio Casa Harmonizada</b> eu te levo pelo passo a passo dessa mudança, no seu ritmo, dentro da sua casa.</p>'
  || '<p><a href="https://biopatriciadomingos.com.br">Começar o Desafio</a></p>'
  || '<p>E se preferir continuar só nas lives, também está ótimo — nos vemos na segunda.</p>'
  || '<p>Com carinho,<br>Patrícia</p>')
returning mensagem_id into v_liv2;

insert into public.mensagens (nome, from_name, from_email, reply_to, subject, preheader, html)
values (
  '[Janela quente 4/4] Um mês depois',
  public.cfg('from_name_padrao'), public.cfg('from_email_padrao'), public.cfg('reply_to_padrao'),
  'Um mês depois: continua fazendo sentido?',
  'Sem pressa e sem insistência — só uma pergunta.',
  '<p>Oi, {{nome}}!</p>'
  || '<p>Faz cerca de um mês que você deu o primeiro passo com a biorressonância. Sem pressa nenhuma, queria fazer uma única pergunta: o que você aprendeu já virou prática aí na sua casa?</p>'
  || '<p>Se virou, você provavelmente já sentiu o gostinho de entender a origem das coisas — e é exatamente esse fio que a <b>Formação em Biorressonância Aplicada</b> puxa até o fim: do zero à prática segura, com certificado reconhecido pelo MEC e pela ABRATH e 2 anos de acesso.</p>'
  || '<p><a href="https://drapatriciadomingos.com.br/inscricoes-formacao">Ver a Formação</a></p>'
  || '<p>Se ainda não virou, comece pequeno: escolha um cômodo só. O resto vem.</p>'
  || '<p>Com carinho,<br>Patrícia</p>')
returning mensagem_id into v_seg;

insert into public.mensagens (nome, from_name, from_email, reply_to, subject, preheader, html)
values (
  '[Reativação] Faz um tempo',
  public.cfg('from_name_padrao'), public.cfg('from_email_padrao'), public.cfg('reply_to_padrao'),
  '{{nome}}, faz um tempo que a gente não se fala',
  'Uma passada rápida para saber de você.',
  '<p>Oi, {{nome}}!</p>'
  || '<p>Faz um tempo que você passou por aqui, e eu queria saber como está a sua casa — e você dentro dela.</p>'
  || '<p>Se a rotina engoliu o que você tinha começado, não tem culpa nenhuma nisso: acontece com quase todo mundo. O bom da biorressonância é que ela espera. Dá para recomeçar de onde parou, hoje.</p>'
  || '<p>Toda segunda eu faço uma live aberta, de graça, mostrando na prática o que muda um ambiente. Se quiser voltar por ali, é o caminho mais leve.</p>'
  || '<p><a href="https://biopatriciadomingos.com.br">Ver o que está aberto agora</a></p>'
  || '<p>E se quiser só me contar como você está, responda este e-mail — eu leio.</p>'
  || '<p>Com carinho,<br>Patrícia</p>')
returning mensagem_id into v_rea;

-- ===================================================================
-- as duas perguntas que as sequências repetem
-- ===================================================================
v_comprou_qualquer := jsonb_build_object(
  'condicao', jsonb_build_object('tipo', 'comprou', 'dias', 2),
  'ir_se_verdadeiro', '0',
  'rotulo', 'Pagou? → sai da sequência');

v_tem_formacao := jsonb_build_object(
  'condicao', jsonb_build_object('tipo', 'comprou', 'produto', 'Formação em Biorressonância Aplicada'),
  'ir_se_verdadeiro', '0',
  'rotulo', 'Já tem a Formação? → sai da sequência');

-- ===================================================================
-- A. Pagamento que não caiu (boleto/PIX gerado e pagamento atrasado)
-- ===================================================================
insert into public.automacoes (nome, ativa, gatilho, nota)
values ('[RESSOA] Pagamento não caiu', true,
  '[{"tipo":"boleto_gerado"},{"tipo":"pagamento_atrasado"}]'::jsonb,
  'Recuperação de boleto/PIX. Entra quem gerou pagamento e não concluiu; sai na hora '
  || 'em que a compra é aprovada (conferido antes de cada e-mail). 4h e 24h depois do pedido.')
returning automacao_id into v_auto;

insert into public.automacao_passos (automacao_fk, ordem, tipo, config) values
  (v_auto, 1, 'esperar', '{"duracao": "4 hours"}'::jsonb),
  (v_auto, 2, 'condicao', v_comprou_qualquer),
  (v_auto, 3, 'enviar_email', jsonb_build_object('mensagem_id', v_pag1,
      'assunto', '{{nome}}, seu pagamento ainda não foi confirmado',
      'mensagem', '[Pagamento 1/2] Seu pagamento ainda não caiu')),
  (v_auto, 4, 'esperar', '{"duracao": "20 hours"}'::jsonb),
  (v_auto, 5, 'condicao', v_comprou_qualquer),
  (v_auto, 6, 'enviar_email', jsonb_build_object('mensagem_id', v_pag2,
      'assunto', 'Seu código de pagamento está prestes a expirar',
      'mensagem', '[Pagamento 2/2] Seu código deve expirar'));

-- ===================================================================
-- B. Carrinho abandonado
-- ===================================================================
insert into public.automacoes (nome, ativa, gatilho, nota)
values ('[RESSOA] Carrinho abandonado', true,
  '{"tipo":"carrinho_abandonado"}'::jsonb,
  'Chegou no checkout e não concluiu. Um e-mail 2h depois, e só se não tiver comprado.')
returning automacao_id into v_auto;

insert into public.automacao_passos (automacao_fk, ordem, tipo, config) values
  (v_auto, 1, 'esperar', '{"duracao": "2 hours"}'::jsonb),
  (v_auto, 2, 'condicao', v_comprou_qualquer),
  (v_auto, 3, 'enviar_email', jsonb_build_object('mensagem_id', v_car,
      'assunto', '{{nome}}, você parou no meio do caminho',
      'mensagem', '[Carrinho] Você parou no meio'));

-- ===================================================================
-- C. Aluno da Formação → Black / Acompanhamento
-- ===================================================================
insert into public.automacoes (nome, ativa, gatilho, nota)
values ('[RESSOA] Aluno → Black / Acompanhamento', true,
  '{"tipo":"compra_realizada","produto":"Formação em Biorressonância Aplicada"}'::jsonb,
  'Jogada do lead scoring: só 21 dos 163 compradores da Black eram alunos. Entra quem '
  || 'compra a Formação; sai quem já tem Black ou Acompanhamento (conferido antes de cada e-mail).')
returning automacao_id into v_auto;

insert into public.automacao_passos (automacao_fk, ordem, tipo, config) values
  (v_auto, 1, 'esperar', '{"duracao": "7 days"}'::jsonb),
  (v_auto, 2, 'condicao', jsonb_build_object(
      'condicao', jsonb_build_object('tipo', 'comprou', 'produto', 'Black Ressonante'),
      'ir_se_verdadeiro', '0', 'rotulo', 'Já tem a Black? → sai')),
  (v_auto, 3, 'condicao', jsonb_build_object(
      'condicao', jsonb_build_object('tipo', 'comprou', 'produto', 'Acompanhamento Ressonante'),
      'ir_se_verdadeiro', '0', 'rotulo', 'Já tem o Acompanhamento? → sai')),
  (v_auto, 4, 'enviar_email', jsonb_build_object('mensagem_id', v_alu1,
      'assunto', '{{nome}}, como está indo a sua Formação?',
      'mensagem', '[Aluno 1/2] Você já está dentro — e tem um degrau a mais')),
  (v_auto, 5, 'esperar', '{"duracao": "10 days"}'::jsonb),
  (v_auto, 6, 'condicao', jsonb_build_object(
      'condicao', jsonb_build_object('tipo', 'comprou', 'produto', 'Black Ressonante'),
      'ir_se_verdadeiro', '0', 'rotulo', 'Já tem a Black? → sai')),
  (v_auto, 7, 'condicao', jsonb_build_object(
      'condicao', jsonb_build_object('tipo', 'comprou', 'produto', 'Acompanhamento Ressonante'),
      'ir_se_verdadeiro', '0', 'rotulo', 'Já tem o Acompanhamento? → sai')),
  (v_auto, 8, 'enviar_email', jsonb_build_object('mensagem_id', v_alu2,
      'assunto', 'O que trava a maioria dos terapeutas no começo',
      'mensagem', '[Aluno 2/2] Quando a dúvida trava a prática'));

-- ===================================================================
-- D. Lives Semanais → Desafio
-- ===================================================================
insert into public.automacoes (nome, ativa, gatilho, nota)
values ('[RESSOA] Lives → Desafio', true,
  '{"tipo":"lista_inscrita","lista_id":6}'::jsonb,
  'Jogada do lead scoring: 3.550 inscritos nas lives nunca compraram nada. Entra quem se '
  || 'inscreve nas Lives Semanais; sai quem comprar no caminho.')
returning automacao_id into v_auto;

insert into public.automacao_passos (automacao_fk, ordem, tipo, config) values
  (v_auto, 1, 'esperar', '{"duracao": "2 days"}'::jsonb),
  (v_auto, 2, 'condicao', jsonb_build_object(
      'condicao', jsonb_build_object('tipo', 'comprou'),
      'ir_se_verdadeiro', '0', 'rotulo', 'Já comprou alguma coisa? → sai')),
  (v_auto, 3, 'enviar_email', jsonb_build_object('mensagem_id', v_liv1,
      'assunto', '{{nome}}, o primeiro passo prático depois das lives',
      'mensagem', '[Lives 1/2] Da live para a prática')),
  (v_auto, 4, 'esperar', '{"duracao": "5 days"}'::jsonb),
  (v_auto, 5, 'condicao', jsonb_build_object(
      'condicao', jsonb_build_object('tipo', 'comprou'),
      'ir_se_verdadeiro', '0', 'rotulo', 'Já comprou alguma coisa? → sai')),
  (v_auto, 6, 'enviar_email', jsonb_build_object('mensagem_id', v_liv2,
      'assunto', 'A sua casa está te sustentando ou te drenando?',
      'mensagem', '[Lives 2/2] A casa que adoece e a casa que sustenta'));

-- ===================================================================
-- E. Segunda chamada: fase 2 da própria janela quente (D+30)
-- ===================================================================
select automacao_id into v_jq from public.automacoes
where nome like '[RESSOA] Formação — janela quente%';

if v_jq is not null
   and not exists (select 1 from public.automacao_passos where automacao_fk = v_jq and ordem >= 12) then
  insert into public.automacao_passos (automacao_fk, ordem, tipo, config) values
    (v_jq, 12, 'esperar', '{"duracao": "22 days"}'::jsonb),
    (v_jq, 13, 'condicao', v_tem_formacao),
    (v_jq, 14, 'enviar_email', jsonb_build_object('mensagem_id', v_seg,
        'assunto', 'Um mês depois: continua fazendo sentido?',
        'mensagem', '[Janela quente 4/4] Um mês depois'));
end if;

-- ===================================================================
-- F. Reativar esteira — enfileirada semanalmente, com teto
-- ===================================================================
insert into public.automacoes (nome, ativa, gatilho, nota)
values ('[RESSOA] Reativar esteira', true,
  '{"tipo":"manual"}'::jsonb,
  'Jogada do lead scoring: comprador parado há mais de 90 dias. Não tem gatilho de evento — '
  || 'quem enfileira é a rotina semanal `enfileirar_reativacao()`, com teto por rodada.')
returning automacao_id into v_auto;

insert into public.automacao_passos (automacao_fk, ordem, tipo, config) values
  (v_auto, 1, 'condicao', jsonb_build_object(
      'condicao', jsonb_build_object('tipo', 'comprou', 'dias', 90),
      'ir_se_verdadeiro', '0', 'rotulo', 'Comprou nos últimos 90 dias? → não é reativação')),
  (v_auto, 2, 'enviar_email', jsonb_build_object('mensagem_id', v_rea,
      'assunto', '{{nome}}, faz um tempo que a gente não se fala',
      'mensagem', '[Reativação] Faz um tempo'));

end $$;

-- ------------------------------------------------------------------
-- a rotina que enfileira a reativação. Teto por rodada de propósito:
-- 2.556 pessoas de uma vez é exatamente o disparo que queima domínio.
-- ------------------------------------------------------------------
create or replace function public.enfileirar_reativacao(p_teto int default 150)
returns int
language plpgsql security definer set search_path to 'public' as $$
declare
  v_auto uuid;
  v_qtd int;
begin
  select automacao_id into v_auto from public.automacoes
  where nome = '[RESSOA] Reativar esteira' and ativa;
  if v_auto is null then
    return 0;
  end if;

  with alvo as (
    select v.lead_fk
    from public.lead_venda v
    where v.alcancavel
      and v.proxima_oferta = 'reativar_esteira'
      and not exists (
        select 1 from public.automacao_execucoes e
        where e.automacao_fk = v_auto
          and e.lead_fk = v.lead_fk
          and e.created_at > now() - interval '120 days')
    order by v.pontos_venda desc
    limit greatest(1, least(coalesce(p_teto, 150), 1000))
  )
  insert into public.automacao_execucoes
    (automacao_fk, lead_fk, passo_atual, agendado_para, contexto)
  select v_auto, alvo.lead_fk, 1, now(), '{"origem":"reativacao-semanal"}'::jsonb
  from alvo;

  get diagnostics v_qtd = row_count;
  return v_qtd;
end $$;

grant execute on function public.enfileirar_reativacao(int) to service_role;

select cron.schedule('ressoa-reativacao-semanal', '23 10 * * 2',
                     'select public.enfileirar_reativacao(150)')
where not exists (select 1 from cron.job where jobname = 'ressoa-reativacao-semanal');

commit;

select nome, ativa, gatilho,
       (select count(*) from public.automacao_passos p where p.automacao_fk = a.automacao_id) as passos
from public.automacoes a
where nome like '[RESSOA]%' order by nome;
