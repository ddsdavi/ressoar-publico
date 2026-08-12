-- =====================================================================
-- SEM TETO v1.1 — tira o relógio que não tem mais o que fazer.
--
-- O Davi confirmou em 06/08/2026: a operação NÃO trabalha com teto de
-- e-mails por dia. O `aquecimento_v2_sem_teto.sql` já zerou o
-- `envio_limite_diario`; falta a consequência.
--
-- Com o teto em 0, `subir_rampa()` devolve "sem teto — rampa concluída"
-- sem escrever nada. Ou seja: um relógio que acorda todo dia às 6h51
-- para não fazer nada. Isso não é neutro — relógio agendado é coisa que
-- alguém vai ler daqui a três meses tentando entender o que ele faz, e
-- vai concluir que existe uma rampa que não existe.
--
-- A função FICA (não custa nada parada, e se um dia um teto voltar a
-- fazer sentido ela é o degrau pronto). O agendamento sai.
--
-- O que continua de pé, e é o que importa: o FREIO. Ele não limita
-- volume — ele PARA o envio se bounce passar de 2% ou reclamação de
-- 0,1%. Sem teto, ele deixa de ser rede de segurança secundária e passa
-- a ser a única. Por isso segue de hora em hora.
-- =====================================================================
begin;

select cron.unschedule('ressoar-rampa-aquecimento')
where exists (select 1 from cron.job where jobname = 'ressoar-rampa-aquecimento');

-- `comment on` só aceita um literal, nunca concatenação
comment on function public.subir_rampa() is
  'Rampa de aquecimento. DESAGENDADA em 06/08/2026: a operação não trabalha com teto diário (envio_limite_diario = 0). Fica disponível caso um teto volte a fazer sentido.';

commit;

select jsonb_build_object(
  'teto', public.cfg('envio_limite_diario'),
  'pausado', public.cfg('envio_pausado'),
  'relogios_de_envio', (select jsonb_agg(jobname) from cron.job
                        where jobname like 'ressoa-%'
                          and jobname in ('ressoar-fila-envios', 'ressoar-freio-entregabilidade',
                                          'ressoar-rampa-aquecimento'))) as estado;
