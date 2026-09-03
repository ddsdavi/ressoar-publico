-- =====================================================================
-- DESEMPENHO FORA DA CAMPANHA — automação e mensagem também têm número
--
-- Por que existe: em 30/08/2026 o painel só sabia dizer quantos abriram
-- e clicaram quando o e-mail saiu por CAMPANHA (view campanha_stats).
-- O e-mail que sai por automação — confirmação de inscrição, boas-vindas,
-- lembrete de live — some do relatório: 302 envios e 26 aberturas já
-- gravados no banco sem nenhuma tela que os mostre.
--
-- O dado sempre esteve lá: `envios` guarda automacao_fk e mensagem_fk, e
-- `eventos_email` grava open/click do mesmo jeito, venha de onde vier.
-- Faltava só somar. São duas views, e nenhuma tabela nova:
--
--   automacao_stats — uma linha por automação: quantos e-mails ela já
--                     mandou, quantas pessoas abriram e clicaram.
--   mensagem_stats  — uma linha por e-mail da biblioteca, somando TODOS
--                     os envios dele (campanha + automação), e dizendo
--                     quantos vieram de cada lado.
--
-- Por que `count(distinct ...)`: é a armadilha nº 1 deste banco. O join
-- com eventos_email multiplica a linha do envio por evento — um envio
-- com 3 aberturas viraria 3 enviados. A campanha_stats já foi corrigida
-- por isso (mesa_v1_motor.sql) e a guarda do motor confere o texto da
-- view. Estas duas nascem com a conta certa.
--
-- Aberturas são contadas por PESSOA (lead_fk distinto), como na campanha:
-- o mesmo e-mail aberto quatro vezes é uma pessoa interessada, não quatro.
--
-- Reversível: `drop view public.automacao_stats, public.mensagem_stats;`
-- Não cria, não apaga e não altera dado nenhum.
-- =====================================================================

begin;

create or replace view public.automacao_stats as
select a.automacao_id, a.nome, a.ativa,
       count(distinct e.envio_id) filter (where e.status not in ('suppressed', 'erro')) as enviados,
       count(distinct e.envio_id) filter (where e.status = 'suppressed')                as suprimidos,
       count(distinct e.lead_fk)  filter (where ev.tipo = 'open')                       as aberturas_unicas,
       count(distinct e.lead_fk)  filter (where ev.tipo = 'click')                      as cliques_unicos,
       count(distinct e.lead_fk)  filter (where ev.tipo = 'bounce_hard')                as hard_bounces,
       count(distinct e.lead_fk)  filter (where ev.tipo = 'unsubscribe')                as descadastros,
       max(e.sent_at)                                                                   as ultimo_envio
from public.automacoes a
left join public.envios e        on e.automacao_fk = a.automacao_id
left join public.eventos_email ev on ev.envio_fk = e.envio_id
group by a.automacao_id, a.nome, a.ativa;

create or replace view public.mensagem_stats as
select m.mensagem_id, m.nome, m.subject,
       count(distinct e.envio_id) filter (where e.status not in ('suppressed', 'erro')) as enviados,
       count(distinct e.lead_fk)  filter (where ev.tipo = 'open')                       as aberturas_unicas,
       count(distinct e.lead_fk)  filter (where ev.tipo = 'click')                      as cliques_unicos,
       count(distinct e.lead_fk)  filter (where ev.tipo = 'bounce_hard')                as hard_bounces,
       -- de onde o e-mail saiu, para a linha explicar sozinha por que tem
       -- número mesmo sem campanha nenhuma no nome
       count(distinct e.envio_id) filter (where e.campanha_fk is not null)              as por_campanha,
       count(distinct e.envio_id) filter (where e.automacao_fk is not null)             as por_automacao,
       max(e.sent_at)                                                                   as ultimo_envio
from public.mensagens m
left join public.envios e        on e.mensagem_fk = m.mensagem_id
left join public.eventos_email ev on ev.envio_fk = e.envio_id
group by m.mensagem_id, m.nome, m.subject;

grant select on public.automacao_stats to authenticated;
grant select on public.mensagem_stats  to authenticated;

commit;
