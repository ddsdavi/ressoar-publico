-- =====================================================================
-- OS QUATRO RELÓGIOS DO MOTOR AINDA SE CHAMAVAM "active-*".
--
-- É o nome antigo do projeto, de quando ele era só "o Active próprio".
-- Ninguém vê isso na tela, mas é o que aparece pra quem abre o banco
-- pelo Supabase, lê o log do pg_cron ou vai investigar por que um envio
-- não saiu — e ali "active" sugere ActiveCampaign, que já foi desligado.
--
-- Trocar o nome não mexe no que eles fazem: a mesma função, no mesmo
-- minuto. O jobid muda (é o preço de usar a API do pg_cron, que não
-- tem renomear), e por isso tudo acontece dentro de uma transação só —
-- ou os quatro trocam de nome, ou nenhum troca e o motor segue rodando
-- com os nomes velhos. Quem já rodou o motor_v1 antigo pega esta
-- migração; instalação nova já nasce com o nome certo.
-- =====================================================================

begin;

do $$
declare
  v_par record;
begin
  for v_par in
    select * from (values
      ('active-processar-eventos',   'ressoar-processar-eventos',   'select public.processar_eventos_sistema()'),
      ('active-executar-automacoes', 'ressoar-executar-automacoes', 'select public.executar_automacoes()'),
      ('active-fila-envios',         'ressoar-fila-envios',         'select public.processar_fila_envios()'),
      ('active-campanhas',           'ressoar-campanhas',           'select public.processar_campanhas()')
    ) as t(velho, novo, comando)
  loop
    -- só desagenda o que existe: rodar a migração duas vezes não pode dar erro
    if exists (select 1 from cron.job where jobname = v_par.velho) then
      perform cron.unschedule(v_par.velho);
    end if;
    perform cron.schedule(v_par.novo, '* * * * *', v_par.comando);
  end loop;
end $$;

commit;

-- prova: quatro relógios "ressoar-*" ativos, nenhum "active-*" sobrando
-- (o alvo virou "ressoar-" no renome profundo de 12/08/2026; o nome deste
--  arquivo ficou como está para não mexer na ordem do instalador)
select
  count(*) filter (where jobname like 'ressoar-%' and active) as relogios_ressoar,
  count(*) filter (where jobname like 'active-%')            as sobrou_active
from cron.job;
