-- =====================================================================
-- JANELA QUENTE v2 — textos finais e LIGADA (ordem do Davi: "FAZ TUDO!").
--
-- O que muda em relação à v1:
--
--   1. Os 3 e-mails deixam de ser rascunho. O link é a página de vendas
--      real (drapatriciadomingos.com.br/inscricoes-formacao, viva, 200)
--      e cada promessa vem dos e-mails que a própria Patrícia já mandou
--      (AC #31 e #34): método para identificar a origem das queixas,
--      mais de 1.300 alunos, certificado MEC/ABRATH, comunidade,
--      mentorias, 2 anos de acesso. NADA de prazo falso nem bônus de
--      lançamento — a sequência roda o ano inteiro, então só entra o
--      que é verdade o ano inteiro.
--
--   2. `avaliar_condicao` ganha `dias` opcional no tipo `comprou`
--      (sem `dias`, comporta-se exatamente como antes). Com isso a
--      porta ganha a TRAVA DE IDADE: só segue quem tem compra aprovada
--      nos últimos 21 dias. Sem ela, um eventual reprocessamento das
--      compras mudas de 02–05/08 (pendência 5 do docs/09) despejaria
--      compradores de semanas atrás numa sequência que diz "ontem".
--
--   3. ativa = true. Para PAUSAR: Automações → desmarcar Ativa. Quem
--      está no meio da sequência para junto (o executor só anda em
--      automação ativa? — não: execução criada continua; pausar de
--      verdade = desativar E, se preciso, concluir as execuções em
--      aberto pela tela).
-- =====================================================================
begin;

-- ------------------------------------------------------------------
-- 1. avaliar_condicao: `comprou` aceita `dias` (opcional)
-- ------------------------------------------------------------------
create or replace function public.avaliar_condicao(p_lead uuid, p_cond jsonb)
returns boolean
language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_tipo text := p_cond->>'tipo';
  v_dias int := coalesce((p_cond->>'dias')::int, 30);
begin
  if v_tipo = 'tem_tag' then
    return exists (select 1 from public.lead_tags
                   where lead_fk = p_lead and tag_fk = (p_cond->>'tag_id')::int);

  elsif v_tipo = 'na_lista' then
    return exists (select 1 from public.lead_listas
                   where lead_fk = p_lead and lista_fk = (p_cond->>'lista_id')::int
                     and status = coalesce((p_cond->>'status')::int, 1));

  elsif v_tipo = 'abriu_email' then
    return exists (select 1 from public.eventos_email
                   where lead_fk = p_lead and tipo = 'open'
                     and occurred_at > now() - (v_dias || ' days')::interval);

  elsif v_tipo = 'clicou_email' then
    return exists (select 1 from public.eventos_email
                   where lead_fk = p_lead and tipo = 'click'
                     and occurred_at > now() - (v_dias || ' days')::interval);

  elsif v_tipo = 'comprou' then
    -- `dias` é opcional e NÃO usa o padrão de 30: sem `dias`, vale a
    -- compra de qualquer época — exatamente o comportamento antigo.
    return exists (select 1 from public.tabela_4_alunos
                   where lead_fk = p_lead
                     and status = 'aprovada'
                     and (p_cond->>'produto' is null
                          or nome_produto ilike '%' || (p_cond->>'produto') || '%')
                     and (p_cond->>'dias' is null
                          or coalesce(data_compra, created_at)
                             > now() - make_interval(days => (p_cond->>'dias')::int)));

  elsif v_tipo = 'tem_whatsapp' then
    return exists (select 1 from public.tabela_1_leads
                   where lead_id = p_lead and coalesce(whatsapp, '') <> '');

  elsif v_tipo = 'campo_igual' then
    return exists (select 1 from public.lead_atributos
                   where lead_fk = p_lead
                     and dados ->> (p_cond->>'chave') = (p_cond->>'valor'));

  elsif v_tipo = 'nao_suprimido' then
    return not exists (select 1 from public.supressao s
                       join public.tabela_1_leads l on l.email = s.email
                       where l.lead_id = p_lead);
  end if;

  return true;
end $$;

-- ------------------------------------------------------------------
-- 2. textos finais dos três e-mails
-- ------------------------------------------------------------------
update public.mensagens set
  nome = '[Janela quente 1/3] O próximo passo',
  subject = '{{nome}}, o próximo passo depois da sua compra',
  preheader = 'O que você começou tem um caminho inteiro pela frente.',
  html =
    '<p>Oi, {{nome}}!</p>'
    || '<p>Primeiro: parabéns pela decisão. Cuidar da energia da sua casa não é detalhe — é o ambiente onde tudo na sua vida acontece.</p>'
    || '<p>E eu vejo isso acontecer toda semana: boa parte das pessoas que começam por onde você começou percebe, em poucos dias, que quer ir mais fundo. Não só aplicar um protocolo pronto, mas <b>entender a origem das queixas</b> — para cuidar de si, da família e, se fizer sentido, até atender.</p>'
    || '<p>Para essas pessoas existe a <b>Formação em Biorressonância Aplicada</b>: o caminho completo, 100% online, com <b>2 anos de acesso</b> para estudar no seu ritmo.</p>'
    || '<p><a href="https://drapatriciadomingos.com.br/inscricoes-formacao">Conheça a Formação aqui</a></p>'
    || '<p>Qualquer dúvida, é só responder este e-mail — a gente lê tudo.</p>'
    || '<p>Com carinho,<br>Patrícia</p>'
where nome = '[RASCUNHO] Janela quente 1/3 — o próximo passo';

update public.mensagens set
  nome = '[Janela quente 2/3] O caminho de mais de 1.300 alunas',
  subject = 'De aluna a terapeuta: o caminho que já guiou mais de 1.300 pessoas',
  preheader = 'O que muda quando você entende a origem das queixas.',
  html =
    '<p>Oi, {{nome}}!</p>'
    || '<p>Deixa eu te contar o que acontece com quem decide ir além do primeiro passo.</p>'
    || '<p>A metodologia da <b>Formação em Biorressonância Aplicada</b> já foi validada por <b>mais de 1.300 alunos, em diversos países</b>. É o passo a passo completo: do zero à terapeuta que identifica a origem das queixas <b>com assertividade e segurança</b>.</p>'
    || '<p>Dentro dela você tem:</p>'
    || '<ul>'
    || '<li><b>Certificado de conclusão reconhecido pelo MEC e pela ABRATH</b>;</li>'
    || '<li>A <b>maior comunidade de Biorressonância do Brasil</b>, para trocar experiências e tirar dúvidas;</li>'
    || '<li><b>Mentorias em grupo</b> para aprofundar o aprendizado;</li>'
    || '<li>Suporte pelo WhatsApp, inclusive para quem nunca fez curso online;</li>'
    || '<li><b>2 anos de acesso</b>, no seu ritmo.</li>'
    || '</ul>'
    || '<p><a href="https://drapatriciadomingos.com.br/inscricoes-formacao">Veja tudo o que você aprende na Formação</a></p>'
    || '<p>Com carinho,<br>Patrícia</p>'
where nome = '[RASCUNHO] Janela quente 2/3 — prova social';

update public.mensagens set
  nome = '[Janela quente 3/3] Última da sequência',
  subject = 'Antes que a rotina engula essa decisão',
  preheader = 'Este é o último e-mail desta sequência — prometo.',
  html =
    '<p>Oi, {{nome}}!</p>'
    || '<p>Este é o último e-mail que te mando sobre isso — depois daqui, sigo só com os conteúdos de sempre.</p>'
    || '<p>O que eu vejo na prática: quem decide se aprofundar, decide nas primeiras semanas. Depois a rotina engole — não porque a vontade sumiu, mas porque a vida puxa.</p>'
    || '<p>Se nesses dias a <b>Formação em Biorressonância Aplicada</b> fez sentido para você — entender a origem das queixas, cuidar da sua família com segurança, quem sabe atender —, este é um bom momento para dar o passo.</p>'
    || '<p><a href="https://drapatriciadomingos.com.br/inscricoes-formacao">Quero conhecer a Formação</a></p>'
    || '<p>E se agora não for o momento, está tudo bem: as lives de segunda seguem abertas, e o caminho continua aqui. Qualquer dúvida, <a href="https://wa.link/hg734s">fale com a nossa equipe no WhatsApp</a>.</p>'
    || '<p>Com carinho,<br>Patrícia</p>'
where nome = '[RASCUNHO] Janela quente 3/3 — última da sequência';

-- ------------------------------------------------------------------
-- 3. passos: entra a trava de idade; e-mails apontam para os nomes novos
-- ------------------------------------------------------------------
do $$
declare
  v_auto uuid;
  v_e1 uuid; v_e2 uuid; v_e3 uuid;
  v_goal jsonb := jsonb_build_object(
    'condicao', jsonb_build_object('tipo', 'comprou', 'produto', 'Formação em Biorressonância Aplicada'),
    'ir_se_verdadeiro', '0',
    'rotulo', 'Já tem a Formação? → sai da sequência');
begin
  select automacao_id into v_auto from public.automacoes
  where nome like '[RESSOAR] Formação — janela quente%';
  if v_auto is null and coalesce(public.cfg('conteudo_origem'), '') = 'removido' then
    -- cópia da plataforma: o conteúdo de origem foi removido de propósito
    -- (nova_operacao_v1.sql). Não há o que ligar, e não é erro.
    raise notice 'janela quente removida de propósito nesta instalação; nada a fazer';
    return;
  end if;
  if v_auto is null then
    raise exception 'automação da janela quente não encontrada';
  end if;

  select mensagem_id into v_e1 from public.mensagens where nome = '[Janela quente 1/3] O próximo passo';
  select mensagem_id into v_e2 from public.mensagens where nome = '[Janela quente 2/3] O caminho de mais de 1.300 alunas';
  select mensagem_id into v_e3 from public.mensagens where nome = '[Janela quente 3/3] Última da sequência';
  if v_e1 is null or v_e2 is null or v_e3 is null then
    raise exception 'mensagens da janela quente não encontradas após o rename';
  end if;

  delete from public.automacao_passos where automacao_fk = v_auto;

  insert into public.automacao_passos (automacao_fk, ordem, tipo, config) values
    (v_auto, 1,  'condicao', v_goal),
    (v_auto, 2,  'condicao', jsonb_build_object(
        'condicao', jsonb_build_object('tipo', 'comprou', 'dias', 21),
        'ir_se_falso', '0',
        'rotulo', 'Compra aprovada nos últimos 21 dias? senão sai — trava contra evento reprocessado antigo')),
    (v_auto, 3,  'esperar', '{"duracao": "1 day"}'::jsonb),
    (v_auto, 4,  'condicao', v_goal),
    (v_auto, 5,  'enviar_email', jsonb_build_object('mensagem_id', v_e1,
        'assunto', '{{nome}}, o próximo passo depois da sua compra',
        'mensagem', '[Janela quente 1/3] O próximo passo')),
    (v_auto, 6,  'esperar', '{"duracao": "3 days"}'::jsonb),
    (v_auto, 7,  'condicao', v_goal),
    (v_auto, 8,  'enviar_email', jsonb_build_object('mensagem_id', v_e2,
        'assunto', 'De aluna a terapeuta: o caminho que já guiou mais de 1.300 pessoas',
        'mensagem', '[Janela quente 2/3] O caminho de mais de 1.300 alunas')),
    (v_auto, 9,  'esperar', '{"duracao": "4 days"}'::jsonb),
    (v_auto, 10, 'condicao', v_goal),
    (v_auto, 11, 'enviar_email', jsonb_build_object('mensagem_id', v_e3,
        'assunto', 'Antes que a rotina engula essa decisão',
        'mensagem', '[Janela quente 3/3] Última da sequência'));

  update public.automacoes set
    nome = '[RESSOAR] Formação — janela quente',
    ativa = true,
    nota = 'Jogada nº 1 do eixo de venda, LIGADA em 06/08/2026 a pedido do Davi. '
        || 'Toda compra aprovada entra; sai na porta quem já tem a Formação ou '
        || 'cuja última compra passou de 21 dias (trava contra reprocessamento '
        || 'de eventos antigos); a conferência da Formação se repete antes de '
        || 'cada e-mail (D+1, D+4, D+8) — quem compra no meio sai sozinho. '
        || 'Para PAUSAR: desmarcar Ativa aqui. Textos: página Mensagens, '
        || '"[Janela quente 1..3/3]".'
  where automacao_id = v_auto;
end $$;

commit;

-- ------------------------------------------------------------------
-- conferência
-- ------------------------------------------------------------------
select a.nome, a.ativa,
       (select count(*) from public.automacao_passos p where p.automacao_fk = a.automacao_id) as passos
from public.automacoes a where a.nome = '[RESSOAR] Formação — janela quente';

select nome, subject from public.mensagens where nome like '[Janela quente%' order by nome;

-- trava de idade funciona? comprador recente = true, antigo = false
select
  public.avaliar_condicao(
    (select lead_fk from public.tabela_4_alunos where status = 'aprovada'
     order by coalesce(data_compra, created_at) desc limit 1),
    '{"tipo":"comprou","dias":21}'::jsonb) as comprador_recente_passa,
  public.avaliar_condicao(
    (select lead_fk from public.tabela_4_alunos where status = 'aprovada'
       and coalesce(data_compra, created_at) < now() - interval '120 days'
       and lead_fk not in (select lead_fk from public.tabela_4_alunos
                           where status = 'aprovada'
                             and coalesce(data_compra, created_at) > now() - interval '21 days')
     limit 1),
    '{"tipo":"comprou","dias":21}'::jsonb) as comprador_antigo_barrado;
