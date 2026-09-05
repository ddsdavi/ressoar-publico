-- =====================================================================
-- SUPRESSÃO: o motivo "domínio impossível" passa a existir
--
-- Por que existe: a supressão aceitava cinco motivos, e a lista era
-- fechada por check constraint — hard_bounce, complaint,
-- unsubscribe_global, manual, ac_import. Faltava o caso que mais
-- machuca esta base: o endereço cujo DOMÍNIO não existe (`gmail.con`,
-- `gmail.comm`, `hotiimail.com`), erro de digitação herdado da migração
-- do ActiveCampaign. Ele não é "e-mail que não existe" (hard_bounce só
-- se sabe depois de tentar e queimar reputação), não é bloqueio manual
-- de uma pessoa, e não veio bloqueado do AC.
--
-- Sem um motivo próprio, a higiene teria de mentir a causa em cima de
-- um dos cinco — e mentir aqui custa caro: é o motivo que diz se dá
-- para desfazer em lote depois, e é o que a tela de Envios e exclusões
-- mostra ao operador.
--
-- Descoberto em 04/09/2026, ao aplicar `higiene_dominios_v1.sql` pela
-- primeira vez: o insert batia na constraint (23514) e o roteiro inteiro
-- morria. A tela ganhou o rótulo correspondente no mesmo commit.
--
-- Reversível: recriar a constraint sem 'dominio_invalido' — depois de
-- apagar ou reclassificar as linhas que usam o motivo.
-- =====================================================================

begin;

alter table public.supressao drop constraint if exists supressao_motivo_check;

alter table public.supressao add constraint supressao_motivo_check
  check (motivo = any (array[
    'hard_bounce', 'complaint', 'unsubscribe_global', 'manual', 'ac_import',
    'dominio_invalido']));

commit;

-- prova: a lista nova está de pé e nenhuma linha existente ficou fora dela
select pg_get_constraintdef(oid) as motivos_aceitos
  from pg_constraint
 where conrelid = 'public.supressao'::regclass and conname = 'supressao_motivo_check';

select motivo, count(*) as linhas from public.supressao group by 1 order by 2 desc;
