-- =====================================================================
-- O GATE ENTRA NAS FUNÇÕES QUE AGEM (Fase 2.1, parte 1)
--
-- As oito funções abaixo são `security definer`, o painel as chama, e
-- todas ESCREVEM ou disparam alguma coisa: colocam gente em automação,
-- duplicam lista, fundem tags, mandam e-mail de teste, resolvem quem
-- recebe um envio avulso. Eram as de maior consequência entre as que não
-- perguntavam quem estava chamando (`gate_leitura_v1.sql` explica por
-- que isso importa).
--
-- Cada uma ganhou UMA linha, `perform public.gate_leitura();`, logo no
-- começo. O resto do corpo é byte a byte o que estava em produção em
-- 04/09/2026 — as definições aqui foram geradas de `pg_get_functiondef`,
-- não redigitadas.
--
-- Este arquivo mora DEPOIS, no ordem.txt, das migrações que criam essas
-- funções. É o que garante que uma reinstalação não devolva a versão sem
-- o gate: quem quiser mexer numa delas, mexa aqui.
--
-- Falta a parte 2: 31 funções de LEITURA em `language sql` (relatórios,
-- contagens, linha do tempo). Não entram aqui porque SQL puro não aceita
-- `perform` — cada uma precisa virar plpgsql, e converter 31 funções de
-- relatório de uma vez, com um lançamento a seis dias, é risco sem
-- pressa: elas só leem, e o `anon` já não pode chamá-las
-- (`seguranca_rpc_v1.sql`). Está anotado no docs/10-PLANO-SEGURANCA.md.
--
-- Reversível: reaplicar as migrações de origem de cada função.
-- =====================================================================

begin;

CREATE OR REPLACE FUNCTION public.adicionar_a_automacao(p_automacao uuid, p_leads uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_novos int := 0;
  v_ja int := 0;
begin
  perform public.gate_leitura();
  if not exists (select 1 from public.automacoes where automacao_id = p_automacao) then
    return jsonb_build_object('erro', 'automação não encontrada');
  end if;

  select count(*) into v_ja
  from public.automacao_execucoes
  where automacao_fk = p_automacao and lead_fk = any(p_leads) and status = 'ativa';

  insert into public.automacao_execucoes (automacao_fk, lead_fk, passo_atual, status, iniciado_em, agendado_para)
  select p_automacao, l, 1, 'ativa', now(), now()
  from unnest(p_leads) l
  where not exists (
    select 1 from public.automacao_execucoes ax
    where ax.automacao_fk = p_automacao and ax.lead_fk = l and ax.status = 'ativa');
  get diagnostics v_novos = row_count;

  return jsonb_build_object('adicionados', v_novos, 'ja_estavam', v_ja);
end $function$;


CREATE OR REPLACE FUNCTION public.contar_publico(p_listas integer[], p_segmento uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_def jsonb;
  v_qtd int;
begin
  perform public.gate_leitura();
  if p_segmento is not null then
    select definicao into v_def from public.segmentos where segmento_id = p_segmento;
    select count(*) into v_qtd
    from public.leads_do_segmento(coalesce(v_def, '{}'::jsonb)) l
    join public.tabela_1_leads t on t.lead_id = l
    where not exists (select 1 from public.supressao s where s.email = t.email);
  else
    select count(distinct ll.lead_fk) into v_qtd
    from public.lead_listas ll
    join public.tabela_1_leads t on t.lead_id = ll.lead_fk
    where ll.lista_fk = any(coalesce(p_listas, '{}')) and ll.status = 1
      and not exists (select 1 from public.supressao s where s.email = t.email);
  end if;
  return coalesce(v_qtd, 0);
end $function$;


CREATE OR REPLACE FUNCTION public.duplicar_lista(p_lista integer, p_nome text, p_com_contatos boolean DEFAULT false)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_nova int;
begin
  perform public.gate_leitura();
  insert into public.listas (nome, descricao)
  select coalesce(nullif(p_nome, ''), l.nome || ' (cópia)'), l.descricao
  from public.listas l where l.lista_id = p_lista
  returning lista_id into v_nova;

  if v_nova is null then
    raise exception 'lista de origem não encontrada';
  end if;

  if p_com_contatos then
    -- só quem está ativo: copiar descadastrado é reinscrever quem pediu
    -- para sair, o que não pode acontecer nunca
    insert into public.lead_listas (lead_fk, lista_fk, status, source, subscribed_at)
    select ll.lead_fk, v_nova, 1, 'copia_lista', now()
    from public.lead_listas ll
    where ll.lista_fk = p_lista and ll.status = 1
    on conflict (lead_fk, lista_fk) do nothing;
  end if;

  return v_nova;
end $function$;


CREATE OR REPLACE FUNCTION public.enviar_email_teste(p_assunto text, p_html text, p_para text, p_preheader text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
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
  perform public.gate_leitura();
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
end $function$;


CREATE OR REPLACE FUNCTION public.mesclar_tags(p_origens integer[], p_destino integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_movidos int := 0;
  v_autos int := 0;
  v_passos int := 0;
  v_origens int[] := array(select unnest(p_origens) except select p_destino);
begin
  perform public.gate_leitura();
  if p_destino is null or v_origens = '{}' then
    return jsonb_build_object('erro', 'escolha ao menos uma tag de origem e uma de destino');
  end if;
  if not exists (select 1 from public.tags where tag_id = p_destino) then
    return jsonb_build_object('erro', 'a tag de destino não existe');
  end if;

  -- contatos das origens passam para o destino, sem duplicar quem já tem
  insert into public.lead_tags (lead_fk, tag_fk, created_at)
  select lt.lead_fk, p_destino, min(lt.created_at)
  from public.lead_tags lt
  where lt.tag_fk = any(v_origens)
  group by lt.lead_fk
  on conflict (lead_fk, tag_fk) do nothing;
  get diagnostics v_movidos = row_count;

  -- automações que usavam as origens passam a usar o destino, trocando só
  -- o gatilho que aponta para a tag mesclada e deixando os outros intactos
  update public.automacoes a
  set gatilho = case
    when jsonb_typeof(a.gatilho) = 'array' then (
      select jsonb_agg(
        case when g->>'tipo' = 'tag_adicionada'
              and (g->>'tag_id')::int = any(v_origens)
             then jsonb_set(g, '{tag_id}', to_jsonb(p_destino))
             else g end)
      from jsonb_array_elements(a.gatilho) as g)
    else jsonb_set(a.gatilho, '{tag_id}', to_jsonb(p_destino))
  end
  where exists (
    select 1 from public.gatilhos_de(a.gatilho) as g
    where g->>'tipo' = 'tag_adicionada'
      and (g->>'tag_id')::int = any(v_origens));
  get diagnostics v_autos = row_count;

  update public.automacao_passos
  set config = jsonb_set(config, '{tag_id}', to_jsonb(p_destino))
  where tipo in ('aplicar_tag', 'remover_tag')
    and (config->>'tag_id')::int = any(v_origens);
  get diagnostics v_passos = row_count;

  delete from public.lead_tags where tag_fk = any(v_origens);
  delete from public.tags where tag_id = any(v_origens);

  return jsonb_build_object(
    'contatos_movidos', v_movidos,
    'automacoes_reapontadas', v_autos,
    'passos_reapontados', v_passos,
    'tags_removidas', array_length(v_origens, 1));
end $function$;


CREATE OR REPLACE FUNCTION public.publico_avulso(p_leads uuid[] DEFAULT NULL::uuid[], p_lista integer DEFAULT NULL::integer, p_segmento uuid DEFAULT NULL::uuid)
 RETURNS SETOF uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_def jsonb;
begin
  perform public.gate_leitura();
  if p_leads is not null and array_length(p_leads, 1) > 0 then
    return query select distinct x from unnest(p_leads) x where x is not null;
  elsif p_lista is not null then
    -- status 1 = inscrito. Quem saiu da lista não volta a receber por
    -- ela; é o mesmo público que a campanha monta
    return query select distinct ll.lead_fk from public.lead_listas ll
                 where ll.lista_fk = p_lista and ll.status = 1;
  elsif p_segmento is not null then
    select definicao into v_def from public.segmentos where segmento_id = p_segmento;
    return query select * from public.leads_do_segmento(coalesce(v_def, '{}'::jsonb));
  end if;
  return;
end $function$;


CREATE OR REPLACE FUNCTION public.rel_atribuicao(p_campo text DEFAULT 'origem_trafego'::text, p_dias integer DEFAULT NULL::integer)
 RETURNS TABLE(valor text, compradores bigint, compras bigint, receita numeric, ticket numeric, leads bigint, conversao numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public.gate_leitura();
  return query execute format($f$
    with base as (
      select la.lead_fk,
             coalesce(nullif(la.dados ->> %L, ''), '(sem origem)') as valor
      from public.lead_atributos la
    ),
    vendas as (
      select b.valor,
             count(distinct c.lead_fk) as compradores,
             count(*) as compras,
             coalesce(sum(c.valor) filter (where c.moeda = 'BRL'), 0) as receita,
             count(*) filter (where c.moeda = 'BRL') as compras_brl
      from base b
      join public.tabela_4_alunos c on c.lead_fk = b.lead_fk and c.status = 'aprovada'
      where $1::int is null
         or coalesce(c.data_compra, c.created_at) > now() - make_interval(days => $1)
      group by b.valor
    ),
    todos as (select base.valor, count(*) as leads from base group by base.valor)
    select t.valor,
           coalesce(v.compradores, 0),
           coalesce(v.compras, 0),
           coalesce(v.receita, 0)::numeric(12,2),
           (coalesce(v.receita, 0) / nullif(v.compras_brl, 0))::numeric(12,2),
           t.leads,
           (100.0 * coalesce(v.compradores, 0) / nullif(t.leads, 0))::numeric(6,2)
    from todos t
    join vendas v on v.valor = t.valor
    order by 4 desc, 6 desc
  $f$, p_campo) using p_dias;
end $function$;


CREATE OR REPLACE FUNCTION public.resultado_envio_teste(p_req bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r record;
begin
  perform public.gate_leitura();
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
end $function$;

commit;

-- prova: as oito perguntam quem chama
select p.proname,
       position('gate_leitura' in pg_get_functiondef(p.oid)) > 0 as tem_gate
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('adicionar_a_automacao','contar_publico','duplicar_lista',
                     'enviar_email_teste','mesclar_tags','publico_avulso',
                     'rel_atribuicao','resultado_envio_teste')
 order by 1;
