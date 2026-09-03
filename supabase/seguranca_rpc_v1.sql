-- ============================================================
-- SEGURANCA RPC v1 — fecha a superficie de RPC anonima
-- ============================================================
-- Problema corrigido (auditoria 25/08/2026): funcoes SECURITY DEFINER do
-- schema public nasceram com EXECUTE para PUBLIC (default do Postgres). O
-- PostgREST expoe toda funcao public como /rest/v1/rpc/<nome>, e a chave
-- "anon" e publica (vai no bundle). Resultado: qualquer pessoa na internet
-- chamava funcoes que FURAM o RLS (SECURITY DEFINER roda como dono) — lendo
-- PII (supressao_detalhada, lead_por_whatsapp, linha_do_tempo) e escrevendo
-- (importar_leads, importar_vendas, enfileirar_email, guardar_segredo...).
--
-- Correcao: revogar EXECUTE de PUBLIC/anon em TODA funcao SECURITY DEFINER e
-- reconceder explicitamente:
--   * as 36 funcoes que o PAINEL chama por .rpc()  -> authenticated + service_role
--   * as demais (internas: edge functions via service_role, cron via superuser)
--                                                   -> service_role apenas
--   * papel_atual()  -> intocada (o RLS a usa dentro das policies; e inofensiva,
--                       so devolve o papel do proprio auth.uid()).
--
-- Idempotente: revoke/grant podem rodar de novo sem efeito colateral.
-- Reversao: para reabrir uma funcao ao painel, adicione o nome ao array
-- "painel" e rode de novo (ou GRANT EXECUTE ... TO authenticated manualmente).

do $$
declare
  -- conjunto exato chamado pelo painel (grep .rpc(" em app/painel/src)
  painel text[] := array[
    'adicionar_a_automacao','campos_em_uso','contagem_listas','contagem_supressao',
    'contagem_tags','contar_segmento','contar_supressao_filtrada','disparar_campanha',
    'disparar_vencedor','duplicar_lista','excluir_lead_ressoar','excluir_leads_ressoar',
    'guardar_segredo','hotmart_produtos_vistos','hotmart_resumo','importar_leads',
    'lead_por_whatsapp','leads_do_segmento','linha_do_tempo','mesclar_tags','placar_ab',
    'rel_anuncios','rel_atribuicao','rel_campo','rel_crescimento','rel_dinheiro_resumo',
    'rel_engajamento','rel_melhores_leads','rel_resultado_envios','rel_resumo','rel_tags',
    'rel_vendas_jogadas','saude_envio','segredos_configurados','supressao_detalhada',
    'testar_regra_produto'
  ];
  r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.prosecdef                    -- so as que FURAM o RLS
      and p.proname <> 'papel_atual'      -- usada dentro das policies
  loop
    if r.proname = any(painel) then
      execute format('revoke execute on function %s from public, anon', r.sig);
      execute format('grant execute on function %s to authenticated, service_role', r.sig);
    else
      execute format('revoke execute on function %s from public, anon, authenticated', r.sig);
      execute format('grant execute on function %s to service_role', r.sig);
    end if;
  end loop;
end $$;

-- ------------------------------------------------------------
-- Gates fail-closed: antes, so barravam se auth.uid() nao fosse nulo — ou
-- seja, um chamador ANONIMO (sem JWT de usuario) passava direto. Agora:
--   * service_role (edge functions) e chamadas internas (cron/postgres, sem
--     role no request) passam;
--   * qualquer chamador com identidade precisa ser staff aprovado.
-- ------------------------------------------------------------
create or replace function public.gate_operacao() returns void language plpgsql stable as $fn$
begin
  if coalesce(auth.role(), 'internal') in ('service_role','internal') then
    return;
  end if;
  if coalesce(public.papel_atual(), '') not in ('admin','terapeuta') then
    raise exception 'Acesso negado: seu papel nao permite esta operacao.' using errcode = '42501';
  end if;
end $fn$;

create or replace function public.gate_preparacao() returns void language plpgsql stable as $fn$
begin
  if coalesce(auth.role(), 'internal') in ('service_role','internal') then
    return;
  end if;
  if coalesce(public.papel_atual(), '') not in ('admin','terapeuta','assistente') then
    raise exception 'Acesso negado: seu papel nao permite esta operacao.' using errcode = '42501';
  end if;
end $fn$;

-- ------------------------------------------------------------
-- Trava contra recaída. O default do Postgres é dar EXECUTE de toda função
-- nova a PUBLIC (= anon). Aqui viramos o default: função criada por postgres
-- já nasce fechada ao anônimo (grants explícitos continuam funcionando).
-- (Não dá para mudar o default do papel supabase_admin sem ser superusuário —
--  por isso existe também o vigia abaixo, que cobre qualquer caminho.)
-- ------------------------------------------------------------
alter default privileges in schema public revoke execute on functions from public, anon;

-- ------------------------------------------------------------
-- Vigia auto-corretivo. De hora em hora: fecha qualquer função SECURITY
-- DEFINER que tenha voltado a ficar executável por anon (furam o RLS) e
-- dispara alerta crítico. Também alerta se alguma tabela public perder o RLS.
-- É a rede de segurança definitiva contra a recaída da falha de RPC anônima,
-- independente de quem/como a função nova foi criada.
-- ------------------------------------------------------------
create or replace function public.auditar_seguranca_rpc() returns jsonb
language plpgsql security definer set search_path to 'public' as $fn$
declare r record; n int := 0; nomes text[] := '{}'; sem_rls text[] := '{}';
begin
  for r in
    select p.oid::regprocedure as sig, p.proname
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.prosecdef
      and p.proname not in ('papel_atual','auditar_seguranca_rpc')
      and has_function_privilege('anon', p.oid, 'EXECUTE')
  loop
    execute format('revoke execute on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated, service_role', r.sig);
    n := n + 1; nomes := nomes || r.proname;
  end loop;
  select coalesce(array_agg(tablename), '{}') into sem_rls
  from pg_tables where schemaname='public' and not rowsecurity;
  if n > 0 or array_length(sem_rls,1) > 0 then
    perform public.registrar_alerta('seguranca_rpc',
      'Vigia de seguranca: correcao automatica aplicada',
      case when n>0 then n||' funcao(oes) RPC estavam abertas ao anonimo e foram fechadas: '||array_to_string(nomes,', ')||'. ' else '' end ||
      case when array_length(sem_rls,1)>0 then 'Tabelas sem RLS: '||array_to_string(sem_rls,', ')||'.' else '' end,
      'critico');
  end if;
  return jsonb_build_object('rpc_fechadas', n, 'nomes', to_jsonb(nomes), 'tabelas_sem_rls', to_jsonb(sem_rls));
end $fn$;
revoke execute on function public.auditar_seguranca_rpc() from public, anon, authenticated;
grant execute on function public.auditar_seguranca_rpc() to service_role;

select cron.schedule('ressoar-auditoria-rpc', '31 * * * *', $$select public.auditar_seguranca_rpc()$$);

-- ============================================================
-- FASE 2.1 — Portão pré-request: usuário logado NÃO-APROVADO não chama RPC
-- ============================================================
-- As ~30 funções SECURITY DEFINER de leitura/relatório furam o RLS. Com o anon
-- já revogado, o unico risco restante era um usuario logado porem AINDA NAO
-- aprovado por um admin (papel_atual() = null) chamando essas funcoes e
-- burlando o RLS. Em vez de editar 30 corpos (25 em SQL, onde nao cabe um
-- 'perform'), colocamos UM portao no PostgREST, que roda antes de cada
-- requisicao: bloqueia chamadas de FUNCAO (/rpc/...) feitas por 'authenticated'
-- sem papel aprovado. Leitura de tabela nao e tocada (o RLS ja filtra, e o
-- usuario pendente ainda le o proprio perfil para ver a tela de 'aguardando').
-- Fail-open so em erro inesperado — este portao roda em TODA requisicao.
create or replace function public.pre_request() returns void language plpgsql stable
security definer set search_path to 'public' as $fn$
declare v_path text := current_setting('request.path', true);
begin
  if v_path is not null and v_path like '%/rpc/%'
     and coalesce(auth.role(), '') = 'authenticated'
     and public.papel_atual() is null then
    raise insufficient_privilege using message = 'Conta aguardando aprovacao de um administrador.';
  end if;
exception
  when insufficient_privilege then raise;  -- o bloqueio intencional propaga
  when others then return;                 -- erro inesperado nunca derruba a API inteira
end $fn$;
grant execute on function public.pre_request() to anon, authenticated, service_role;

-- liga o portao no PostgREST
alter role authenticator set pgrst.db_pre_request = 'public.pre_request';
notify pgrst, 'reload config';

-- ============================================================
-- Controle detectivo: alerta quando alguem VIRA admin
-- ============================================================
-- Todas as camadas acima sao preventivas. Esta e detectiva: se, apesar de
-- tudo, uma conta ganhar admin (criacao ou promocao), dispara alerta critico
-- na hora — para um acesso indevido nao passar despercebido. Edicao normal de
-- um admin (mudar nome/foto) nao gera ruido.
create or replace function public.fn_alerta_privilegio() returns trigger
language plpgsql security definer set search_path to 'public' as $fn$
begin
  if (new.papel = 'admin' and new.status = 'aprovado')
     and (tg_op = 'INSERT'
          or old.papel is distinct from new.papel
          or old.status is distinct from new.status) then
    perform public.registrar_alerta('seguranca_privilegio',
      'Novo administrador na plataforma',
      'A conta '||coalesce(new.email,'(sem email)')||' passou a ser admin aprovado. Se nao foi uma acao sua, investigue imediatamente.',
      'critico', jsonb_build_object('user_id', new.user_id, 'email', new.email), 0);
  end if;
  return new;
end $fn$;
drop trigger if exists trg_alerta_privilegio on public.usuarios_ressoar;
create trigger trg_alerta_privilegio after insert or update on public.usuarios_ressoar
  for each row execute function public.fn_alerta_privilegio();
