-- =====================================================================
-- RENOME PROFUNDO — os identificadores internos passam a dizer "ressoar".
--
-- A leva de 12/08/2026 trocou o que a pessoa vê. Esta troca o resto, por
-- ordem do dono ("levar tudo pro ressoar"): tabela, políticas de RLS,
-- gatilho, função de exclusão, nomes das automações e os relógios do
-- pg_cron.
--
-- Por que TUDO numa transação só: `papel_atual()` é lida por todas as
-- políticas de RLS, e o corpo dela cita a tabela pelo nome. Renomear a
-- tabela NÃO reescreve o corpo das funções — elas passariam a apontar
-- para um nome que não existe mais. Entre o `alter table` e o
-- `create or replace` das funções o banco fica inconsistente; dentro da
-- transação, ninguém enxerga esse intervalo.
--
-- A view `usuarios_ressoa` no fim é ponte, não permanência: o painel
-- publicado ainda pede o nome antigo, e ele só troca quando o build novo
-- subir. Ela é derrubada logo depois (ver o final do arquivo).
--
-- Reexecutável: cada passo confere antes de agir.
-- =====================================================================
begin;

-- ------------------------------------------------------------------
-- 1. a tabela
-- ------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
             where n.nspname = 'public' and c.relname = 'usuarios_ressoa'
               and c.relkind = 'r') then
    alter table public.usuarios_ressoa rename to usuarios_ressoar;
  end if;
end $$;

-- ------------------------------------------------------------------
-- 2. as funções que citam a tabela pelo nome
--
-- `\m` e `\M` são as bordas de palavra do Postgres, e aqui não são
-- luxo: sem elas, `usuarios_ressoa` casaria dentro de
-- `usuarios_ressoar` e a segunda passada escreveria `usuarios_ressoarr`.
-- ------------------------------------------------------------------
do $$
declare
  r record;
  def text;
begin
  for r in select p.oid from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.prosrc ~ '\musuarios_ressoa\M'
  loop
    def := pg_get_functiondef(r.oid);
    def := regexp_replace(def, '\musuarios_ressoa\M', 'usuarios_ressoar', 'g');
    execute def;
  end loop;
end $$;

-- ------------------------------------------------------------------
-- 3. as políticas de RLS (dezenas, espalhadas por muitas tabelas)
-- ------------------------------------------------------------------
do $$
declare r record;
begin
  for r in select schemaname, tablename, policyname from pg_policies
           where policyname like 'ressoa\_%'
  loop
    execute format('alter policy %I on %I.%I rename to %I',
                   r.policyname, r.schemaname, r.tablename,
                   'ressoar_' || substring(r.policyname from 8));
  end loop;
end $$;

-- ------------------------------------------------------------------
-- 4. a função de exclusão de lead
--
-- O gatilho `trg_ressoa_novo_usuario` fica com o nome antigo, e não é
-- escolha: ele mora em `auth.users`, tabela do Supabase, e renomear
-- exige ser dono dela — o banco responde `42501: must be owner of table
-- users`. É o único identificador desta leva que a plataforma não deixa
-- trocar. Ele não aparece para ninguém; a função que ele chama
-- (`fn_novo_usuario_auth`) já aponta para a tabela com o nome novo.
-- ------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'excluir_lead_ressoa') then
    alter function public.excluir_lead_ressoa(uuid) rename to excluir_lead_ressoar;
  end if;
end $$;

-- ------------------------------------------------------------------
-- 5. os nomes das automações gravados no banco
-- ------------------------------------------------------------------
update public.automacoes
set nome = replace(nome, '[RESSOA]', '[RESSOAR]')
where nome like '[RESSOA]%';

-- ------------------------------------------------------------------
-- 6. os relógios do pg_cron
--
-- pg_cron não tem rename: é preciso desagendar e reagendar mantendo
-- horário e comando. O jobid muda; o que eles fazem, não.
-- ------------------------------------------------------------------
do $$
declare j record;
begin
  for j in select jobname, schedule, command from cron.job
           where jobname like 'ressoa-%'
  loop
    perform cron.unschedule(j.jobname);
    perform cron.schedule('ressoar-' || substring(j.jobname from 8),
                          j.schedule, j.command);
  end loop;
end $$;

-- ------------------------------------------------------------------
-- 7. a ponte para o painel que ainda está no ar
--
-- `security_invoker` é o detalhe que importa: sem ele a view rodaria com
-- os direitos de quem a criou e furaria o RLS da tabela. Com ele, cada
-- pessoa continua vendo exatamente o que via.
-- ------------------------------------------------------------------
create or replace view public.usuarios_ressoa
  with (security_invoker = true) as
  select * from public.usuarios_ressoar;

grant select, insert, update, delete on public.usuarios_ressoa
  to authenticated, service_role;

commit;

-- conferência
select
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'usuarios_ressoar') as tabela_nova,
  (select count(*) from pg_policies where policyname like 'ressoa\_%') as politicas_velhas,
  (select count(*) from pg_policies where policyname like 'ressoar\_%') as politicas_novas,
  (select count(*) from cron.job where jobname like 'ressoa-%') as crons_velhos,
  (select count(*) from cron.job where jobname like 'ressoar-%') as crons_novos,
  (select count(*) from public.automacoes where nome like '[RESSOA]%') as autos_velhas,
  (select count(*) from public.automacoes where nome like '[RESSOAR]%') as autos_novas;

-- A ponte JÁ FOI derrubada em 12/08/2026, logo depois de o painel novo
-- subir. Quem reconstruir o banco do zero nunca precisa dela (não existe
-- painel antigo no ar), mas ela fica aqui porque é o que explica como a
-- troca aconteceu sem janela. Para derrubar de novo, se for o caso:
--   drop view if exists public.usuarios_ressoa;
