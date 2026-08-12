-- =====================================================================
-- PAUSAR ENVIOS — a chave geral. Nada sai daqui até alguém retomar.
--
-- Decisão do Davi em 06/08/2026: "para todos os emails, não é pra
-- disparar nada ainda". Este arquivo é o par de `retomar_envios.sql`.
--
-- Existem DUAS saídas de e-mail nesta plataforma, e é preciso fechar as
-- duas — fechar só a primeira dá falsa sensação de silêncio:
--
--   1. A FILA (tabela `envios`), drenada de minuto em minuto pelo cron
--      `ressoar-fila-envios`. É por onde passa tudo que vai para lead e
--      cliente. `envio_pausado = true` faz o drenador devolver 0 na
--      primeira linha, antes de olhar qualquer coisa. A fila continua
--      enchendo e nada se perde: as linhas ficam em `queued`.
--
--   2. O RESUMO DIÁRIO (`enviar_resumo_diario`), que fala DIRETO com a
--      Resend por `net.http_post` e por isso IGNORA o `envio_pausado`.
--      Hoje ele está inerte por outro motivo: `resumo_diario_para` está
--      vazio, e a função devolve sem enviar quando não há destinatário.
--      Não mexo nele aqui, mas fica o aviso: preencher aquela chave
--      volta a mandar e-mail mesmo com tudo "pausado".
--
-- Também tiro do ar o `ressoar-reativacao-semanal`. Com a pausa ligada
-- ele não enviaria nada, mas encheria a fila de 150 pessoas reais por
-- semana — e no dia em que alguém retomasse, tudo isso sairia de uma
-- vez. Melhor não armar a mola. O `retomar_envios.sql` devolve o
-- agendamento no mesmo horário.
-- =====================================================================

begin;

update public.app_config
   set valor = 'true', updated_at = now()
 where chave = 'envio_pausado';

insert into public.app_config (chave, valor) values ('envio_pausado', 'true')
on conflict (chave) do nothing;

commit;

-- fora da transação: cron.unschedule não volta atrás junto com ela
select cron.unschedule('ressoar-reativacao-semanal')
 where exists (select 1 from cron.job where jobname = 'ressoar-reativacao-semanal');

select 'envio_pausado' as item, valor as estado from public.app_config where chave = 'envio_pausado'
union all
select 'resumo_diario_para', coalesce(nullif(valor, ''), '(vazio — resumo nao envia)')
  from public.app_config where chave = 'resumo_diario_para'
union all
select 'reativacao semanal', coalesce((select 'AINDA AGENDADA' from cron.job
                                        where jobname = 'ressoar-reativacao-semanal'), 'fora do ar')
union all
select 'presos na fila (queued)', count(*)::text from public.envios where status = 'queued';
