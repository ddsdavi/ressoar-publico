-- =====================================================================
-- JANELA QUENTE v1 — a jogada nº 1 em forma de automação, DESLIGADA.
--
-- O que ela faz quando (e só quando) o Davi revisar os textos e ligar:
-- toda compra aprovada entra; quem já tem a Formação é dispensado na
-- porta; quem não tem recebe 3 e-mails em D+1, D+4 e D+8 — a mediana
-- real de conversão entrada→Formação é 6 a 11 dias, então a sequência
-- cobre exatamente a janela. ANTES de cada e-mail a automação confere
-- de novo se a pessoa comprou a Formação no meio do caminho: comprou,
-- saiu — ninguém recebe oferta do que acabou de comprar.
--
-- Tudo com primitivas que o motor já tem (gatilho compra_realizada +
-- passo condicao com desvio "0 = encerrar"): nenhuma mudança de motor.
-- Os e-mails nascem com [RASCUNHO] no nome e um marcador de link
-- COLE-AQUI-O-LINK-DA-FORMACAO — é proposital: sem revisar, não tem
-- como achar que está pronto.
-- =====================================================================
begin;

-- Remetente: sai de app_config (from_name_padrao / from_email_padrao /
-- reply_to_padrao), nao escrito a mao. Duas razoes: a migracao serve a
-- qualquer instalacao, e nome de pessoa nao mora em arquivo versionado --
-- este repositorio tem espelho publico.

do $$
declare
  v_e1 uuid; v_e2 uuid; v_e3 uuid;
  v_auto uuid;
  v_goal jsonb;
begin
  -- `like`, e nao `=`: a v2 (janela_quente_v2_ligada) RENOMEIA esta automação
  -- para '[RESSOA] Formação — janela quente' ao ligá-la. Com igualdade exata, a
  -- trava parava de reconhecer o que ela mesma criou e o instalador passava a
  -- criar uma segunda automação a cada execução. Medido em 12/08/2026.
  if exists (select 1 from public.automacoes
             where nome like '[RESSOA] Formação — janela quente%') then
    raise notice 'automação da janela quente já existe; nada a fazer';
    return;
  end if;

  insert into public.mensagens (nome, from_name, from_email, reply_to, subject, preheader, html, text_body)
  values (
    '[RASCUNHO] Janela quente 1/3 — o próximo passo',
    public.cfg('from_name_padrao'), public.cfg('from_email_padrao'), public.cfg('reply_to_padrao'),
    '{{nome}}, o próximo passo depois da sua compra',
    'O que você começou ontem tem um caminho inteiro pela frente.',
    '<p>Oi, {{nome}}!</p>'
    || '<p>Primeiro: parabéns pela decisão de ontem. Cuidar da energia da sua casa não é detalhe — é o ambiente onde tudo na sua vida acontece.</p>'
    || '<p>E eu queria te contar uma coisa que vejo acontecer toda semana: boa parte das pessoas que começam por onde você começou percebe, em poucos dias, que quer ir mais fundo — não só aplicar um protocolo pronto, mas <b>entender e dominar a biorressonância</b> para usar na própria casa, na família e até profissionalmente.</p>'
    || '<p>Para essas pessoas existe a <b>Formação em Biorressonância Aplicada</b>: o caminho completo, do zero à prática, no seu ritmo.</p>'
    || '<p><a href="COLE-AQUI-O-LINK-DA-FORMACAO">Conheça a Formação aqui</a></p>'
    || '<p>Qualquer dúvida, é só responder este e-mail — a gente lê tudo.</p>'
    || '<p>Um abraço,<br>Patrícia</p>',
    null)
  returning mensagem_id into v_e1;

  insert into public.mensagens (nome, from_name, from_email, reply_to, subject, preheader, html, text_body)
  values (
    '[RASCUNHO] Janela quente 2/3 — prova social',
    public.cfg('from_name_padrao'), public.cfg('from_email_padrao'), public.cfg('reply_to_padrao'),
    'De aluna a terapeuta: o caminho que começa aí',
    'Quem entrou como você está colhendo o quê?',
    '<p>Oi, {{nome}}!</p>'
    || '<p>Deixa eu te contar o que acontece com quem decide ir além do primeiro passo.</p>'
    || '<p>[DEPOIMENTO — cole aqui a história de uma aluna real: como chegou, o que travava, o que mudou depois da Formação. 3 a 5 linhas, com autorização dela.]</p>'
    || '<p>A Formação em Biorressonância Aplicada foi desenhada para isso: transformar quem sente que “tem algo a mais” nessa prática em alguém que <b>aplica com segurança</b> — em casa e, se quiser, atendendo.</p>'
    || '<p><a href="COLE-AQUI-O-LINK-DA-FORMACAO">Veja o que você aprende na Formação</a></p>'
    || '<p>Um abraço,<br>Patrícia</p>',
    null)
  returning mensagem_id into v_e2;

  insert into public.mensagens (nome, from_name, from_email, reply_to, subject, preheader, html, text_body)
  values (
    '[RASCUNHO] Janela quente 3/3 — última da sequência',
    public.cfg('from_name_padrao'), public.cfg('from_email_padrao'), public.cfg('reply_to_padrao'),
    'Antes que a rotina engula essa decisão',
    'Este é o último e-mail desta sequência — prometo.',
    '<p>Oi, {{nome}}!</p>'
    || '<p>Este é o último e-mail que te mando sobre isso — depois daqui, sigo só com os conteúdos de sempre.</p>'
    || '<p>O que eu vejo na prática: quem decide se aprofundar decide nas primeiras semanas. Depois, a rotina engole — não porque a vontade sumiu, mas porque a vida puxa.</p>'
    || '<p>Se a Formação em Biorressonância Aplicada fez sentido para você nesses dias, este é o momento de garantir a sua vaga.</p>'
    || '<p>[CONDIÇÃO — se houver bônus ou condição especial para compradores recentes, descreva aqui.]</p>'
    || '<p><a href="COLE-AQUI-O-LINK-DA-FORMACAO">Quero entrar na Formação</a></p>'
    || '<p>E se agora não for o momento, está tudo bem: continue nas lives de segunda, que o caminho segue aberto.</p>'
    || '<p>Um abraço,<br>Patrícia</p>',
    null)
  returning mensagem_id into v_e3;

  insert into public.automacoes (nome, ativa, gatilho, nota)
  values (
    '[RESSOA] Formação — janela quente (revisar e ligar)',
    false,
    '{"tipo": "compra_realizada"}'::jsonb,
    'Jogada nº 1 do eixo de venda. Toda compra aprovada entra; quem já tem a '
    || 'Formação é dispensado na porta, e a conferência se repete antes de cada '
    || 'e-mail — quem compra a Formação no meio da sequência sai sozinho. '
    || 'ANTES DE LIGAR: revisar os 3 e-mails [RASCUNHO] (link da página da '
    || 'Formação + depoimento + condição) na página Mensagens.')
  returning automacao_id into v_auto;

  -- a mesma pergunta na porta e antes de cada e-mail: já comprou a Formação?
  v_goal := jsonb_build_object(
    'condicao', jsonb_build_object('tipo', 'comprou', 'produto', 'Formação em Biorressonância Aplicada'),
    'ir_se_verdadeiro', '0',
    'rotulo', 'Já tem a Formação? → sai da sequência');

  insert into public.automacao_passos (automacao_fk, ordem, tipo, config) values
    (v_auto, 1,  'condicao', v_goal),
    (v_auto, 2,  'esperar', '{"duracao": "1 day"}'::jsonb),
    (v_auto, 3,  'condicao', v_goal),
    (v_auto, 4,  'enviar_email', jsonb_build_object('mensagem_id', v_e1,
        'assunto', '{{nome}}, o próximo passo depois da sua compra',
        'mensagem', '[RASCUNHO] Janela quente 1/3 — o próximo passo')),
    (v_auto, 5,  'esperar', '{"duracao": "3 days"}'::jsonb),
    (v_auto, 6,  'condicao', v_goal),
    (v_auto, 7,  'enviar_email', jsonb_build_object('mensagem_id', v_e2,
        'assunto', 'De aluna a terapeuta: o caminho que começa aí',
        'mensagem', '[RASCUNHO] Janela quente 2/3 — prova social')),
    (v_auto, 8,  'esperar', '{"duracao": "4 days"}'::jsonb),
    (v_auto, 9,  'condicao', v_goal),
    (v_auto, 10, 'enviar_email', jsonb_build_object('mensagem_id', v_e3,
        'assunto', 'Antes que a rotina engula essa decisão',
        'mensagem', '[RASCUNHO] Janela quente 3/3 — última da sequência'));
end $$;

commit;

-- conferência: desligada, 10 passos, 3 rascunhos
select a.nome, a.ativa, a.gatilho,
       (select count(*) from public.automacao_passos p where p.automacao_fk = a.automacao_id) as passos
from public.automacoes a
where a.nome = '[RESSOA] Formação — janela quente (revisar e ligar)';

select nome, subject from public.mensagens where nome like '[RASCUNHO] Janela quente%' order by nome;
