-- =====================================================================
-- RETOMAR ENVIOS — desfaz o `pausar_envios.sql`.
--
-- LEIA ANTES DE RODAR: enquanto esteve pausada, a fila continuou
-- enchendo. Tudo que estiver em `queued` sai no primeiro minuto depois
-- que isto rodar, de uma vez só — e hoje não há teto diário para
-- segurar o volume (ver `aquecimento_v2_sem_teto.sql`).
--
-- Então confira ANTES quantos estão presos:
--
--   select status, count(*) from public.envios group by status;
--
-- Se o número assustar, esvazie ou adie o que não quiser enviar antes
-- de retomar. Marcar como 'cancelado' tira da fila sem apagar histórico:
--
--   update public.envios set status = 'cancelado' where status = 'queued';
-- =====================================================================

begin;

update public.app_config
   set valor = 'false', updated_at = now()
 where chave = 'envio_pausado';

commit;

-- devolve o agendamento semanal no mesmo horário de antes (terças 10:23)
select cron.schedule('ressoar-reativacao-semanal', '23 10 * * 2',
                     'select public.enfileirar_reativacao(150)')
 where not exists (select 1 from cron.job where jobname = 'ressoar-reativacao-semanal');

select 'envio_pausado' as item, valor as estado from public.app_config where chave = 'envio_pausado'
union all
select 'reativacao semanal', coalesce((select schedule from cron.job
                                        where jobname = 'ressoar-reativacao-semanal'), 'fora do ar')
union all
select 'vai sair agora (queued)', count(*)::text from public.envios where status = 'queued';
