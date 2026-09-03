-- Executar somente depois de restaurar uma versao do painel que nao chama esta RPC.
-- Remove apenas a funcao em lote; nao restaura leads ja excluidos por administradores.
begin;

drop function if exists public.excluir_leads_ressoar(uuid[]);

commit;
