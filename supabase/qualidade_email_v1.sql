-- =====================================================================
-- QUALIDADE DA CONTA DE E-MAIL — a saúde do envio numa tela só
--
-- Por que existe: o painel sabia dizer como foi UMA campanha, mas não
-- como vai a CONTA. Quantos e-mails saíram, quantos chegaram, quantos
-- voltaram, quantos deram erro, quantas pessoas abriram, clicaram,
-- saíram da lista ou marcaram spam — a resposta existia espalhada em
-- envios e eventos_email, e não havia tela.
--
-- Isso não é vaidade: devolução e reclamação são o que o Gmail e o SES
-- olham para decidir se a mensagem cai na caixa de entrada ou na de
-- spam. Os limites mostrados (2% e 0,1%) são os MESMOS que o
-- freio_entregabilidade usa para parar a fila sozinho — repetidos de
-- propósito, para não existirem duas verdades na casa.
--
-- Tudo é somado AQUI, no banco. Somar linha a linha no navegador é a
-- armadilha nº 1 deste projeto: a API corta em 1.000 registros e a conta
-- sai errada sem avisar.
--
-- Cuidado que o corpo repete: `count(distinct ...)` em toda parte. O
-- join de envios com eventos multiplica a linha do envio por evento — um
-- envio com três aberturas viraria três enviados.
--
-- Pessoas x mensagens: abertura, clique, descadastro e reclamação são
-- contados por PESSOA (lead distinto). O mesmo e-mail aberto quatro
-- vezes é uma pessoa interessada, não quatro. Entrega e devolução são
-- contadas por MENSAGEM, que é como o provedor conta.
--
-- O bloco `scoring` fecha o círculo: cada evento de e-mail já vale ponto
-- na pontuação de leads (regras_pontuacao), e aqui aparece quantas
-- pessoas cada regra está pontuando agora. Sem isso a tela seria só
-- estatística bonita que não vira decisão.
--
-- Reversível: `drop function public.qualidade_email(int);`
-- Só lê. Não escreve em tabela nenhuma.
-- =====================================================================

begin;

create or replace function public.qualidade_email(p_dias int default 30)
returns jsonb
language sql stable security definer set search_path to 'public' as $fn$
with j as (
  -- p_dias <= 0 significa "desde sempre"
  select case when coalesce(p_dias, 0) <= 0 then '1970-01-01'::timestamptz
              else now() - make_interval(days => p_dias) end as de
),
env as (
  select e.envio_id, e.lead_fk, e.status, e.campanha_fk, e.automacao_fk,
         coalesce(e.sent_at, e.queued_at) as quando
  from public.envios e, j
  where coalesce(e.sent_at, e.queued_at) >= j.de
),
ev as (
  select v.envio_fk, v.lead_fk, v.tipo
  from public.eventos_email v
  join env e on e.envio_id = v.envio_fk
),
c as (
  select
    -- saiu de verdade: o provedor aceitou. Suprimido nem foi tentado e
    -- erro nem chegou ao provedor — nenhum dos dois entra no denominador
    (select count(*) from env where status in ('sent', 'delivered', 'bounced', 'complained')) as enviados,
    (select count(*) from env where status = 'suppressed')                                   as suprimidos,
    (select count(*) from env where status in ('erro', 'failed'))                            as erros,
    (select count(*) from env where status = 'queued')                                       as na_fila,
    (select count(distinct envio_fk) from ev where tipo = 'delivered')                       as entregues,
    (select count(distinct envio_fk) from ev where tipo = 'bounce_hard')                     as devolvidos_definitivos,
    (select count(distinct envio_fk) from ev where tipo = 'bounce_soft')                     as devolvidos_temporarios,
    (select count(distinct envio_fk) from ev where tipo = 'deferred')                        as adiados,
    (select count(distinct envio_fk) from ev where tipo = 'send_error')                      as falhas_no_provedor,
    (select count(distinct lead_fk)  from ev where tipo = 'open')                            as abriram,
    (select count(distinct lead_fk)  from ev where tipo = 'click')                           as clicaram,
    (select count(distinct lead_fk)  from ev where tipo = 'unsubscribe')                     as descadastraram,
    (select count(distinct lead_fk)  from ev where tipo = 'complaint')                       as reclamaram
),
por_dia as (
  select (e.quando at time zone 'America/Sao_Paulo')::date                                     as dia,
         count(distinct e.envio_id) filter (where e.status in ('sent', 'delivered', 'bounced', 'complained')) as enviados,
         count(distinct v.envio_fk) filter (where v.tipo = 'delivered')                        as entregues,
         count(distinct v.lead_fk)  filter (where v.tipo = 'open')                             as abriram,
         count(distinct v.lead_fk)  filter (where v.tipo = 'click')                            as clicaram,
         count(distinct v.envio_fk) filter (where v.tipo in ('bounce_hard', 'bounce_soft'))    as devolvidos
  from env e left join ev v on v.envio_fk = e.envio_id
  group by 1
),
por_origem as (
  select case when e.campanha_fk is not null then 'campanha'
              when e.automacao_fk is not null then 'automacao'
              else 'avulso' end                                                                as origem,
         count(distinct e.envio_id) filter (where e.status in ('sent', 'delivered', 'bounced', 'complained')) as enviados,
         count(distinct v.envio_fk) filter (where v.tipo = 'delivered')                        as entregues,
         count(distinct v.lead_fk)  filter (where v.tipo = 'open')                             as abriram,
         count(distinct v.lead_fk)  filter (where v.tipo = 'click')                            as clicaram,
         count(distinct v.envio_fk) filter (where v.tipo in ('bounce_hard', 'bounce_soft'))    as devolvidos
  from env e left join ev v on v.envio_fk = e.envio_id
  group by 1
),
-- quantas pessoas cada regra de e-mail está pontuando AGORA. Não usa a
-- janela da tela: pontuação é estado do lead, não recorte de período
regras as (
  select r.nome, r.tipo, r.pontos, r.dias, r.ativa,
    case r.tipo
      when 'abriu_email' then (select count(distinct e.lead_fk) from public.eventos_email e
                               where e.tipo = 'open'
                                 and e.occurred_at > now() - make_interval(days => coalesce(r.dias, 3650)))
      when 'clicou_email' then (select count(distinct e.lead_fk) from public.eventos_email e
                                where e.tipo = 'click'
                                  and e.occurred_at > now() - make_interval(days => coalesce(r.dias, 3650)))
      when 'bounce' then (select count(*) from public.supressao s
                          join public.tabela_1_leads l on lower(l.email) = lower(s.email)
                          where s.motivo = 'hard_bounce')
      when 'reclamou' then (select count(*) from public.supressao s
                            join public.tabela_1_leads l on lower(l.email) = lower(s.email)
                            where s.motivo = 'complaint')
      when 'descadastrou' then (select count(distinct ll.lead_fk) from public.lead_listas ll where ll.status = 2)
      else null
    end as pessoas
  from public.regras_pontuacao r
  where r.tipo in ('abriu_email', 'clicou_email', 'bounce', 'reclamou', 'descadastrou')
)
select jsonb_build_object(
  'dias', coalesce(p_dias, 30),
  'enviados', c.enviados, 'entregues', c.entregues,
  'suprimidos', c.suprimidos, 'erros', c.erros, 'na_fila', c.na_fila,
  'devolvidos_definitivos', c.devolvidos_definitivos,
  'devolvidos_temporarios', c.devolvidos_temporarios,
  'adiados', c.adiados, 'falhas_no_provedor', c.falhas_no_provedor,
  'abriram', c.abriram, 'clicaram', c.clicaram,
  'descadastraram', c.descadastraram, 'reclamaram', c.reclamaram,
  -- entrega sobre o que saiu; engajamento sobre o que chegou. Medir
  -- abertura sobre o enviado castiga o número por causa do que voltou
  'taxa_entrega',      round(100.0 * c.entregues / nullif(c.enviados, 0), 2),
  'taxa_devolucao',    round(100.0 * (c.devolvidos_definitivos + c.devolvidos_temporarios) / nullif(c.enviados, 0), 2),
  'taxa_abertura',     round(100.0 * c.abriram / nullif(c.entregues, 0), 2),
  'taxa_clique',       round(100.0 * c.clicaram / nullif(c.entregues, 0), 2),
  'taxa_clique_de_quem_abriu', round(100.0 * c.clicaram / nullif(c.abriram, 0), 2),
  'taxa_descadastro',  round(100.0 * c.descadastraram / nullif(c.entregues, 0), 2),
  'taxa_reclamacao',   round(100.0 * c.reclamaram / nullif(c.entregues, 0), 3),
  -- os mesmos limites que o freio usa para pausar a fila sozinho
  'limite_devolucao', 2.0, 'limite_reclamacao', 0.1,
  'pausado', coalesce(public.cfg('envio_pausado'), 'false') = 'true',
  'limite_diario', coalesce(nullif(public.cfg('envio_limite_diario'), ''), '0')::int,
  'enviados_24h', (select count(*) from public.envios
                   where sent_at > now() - interval '24 hours'
                     and status in ('sent', 'delivered', 'bounced', 'complained')),
  'na_supressao', (select count(*) from public.supressao),
  'por_dia', (select coalesce(jsonb_agg(to_jsonb(d) order by d.dia), '[]'::jsonb) from por_dia d),
  'por_origem', (select coalesce(jsonb_agg(to_jsonb(o) order by o.enviados desc), '[]'::jsonb) from por_origem o),
  'scoring', jsonb_build_object(
    'calculado_em', (select max(calculado_em) from public.lead_pontuacao),
    'regras', (select coalesce(jsonb_agg(to_jsonb(r) order by r.pontos desc), '[]'::jsonb) from regras r),
    'faixas', (select coalesce(jsonb_agg(to_jsonb(f) order by f.ordem), '[]'::jsonb) from (
        select 1 as ordem, 'Quentes (40+)' as faixa, count(*) as leads
          from public.lead_pontuacao where pontos >= 40
        union all select 2, 'Mornos (10 a 39)', count(*) from public.lead_pontuacao where pontos between 10 and 39
        union all select 3, 'Frios (1 a 9)',    count(*) from public.lead_pontuacao where pontos between 1 and 9
        union all select 4, 'Zero ou negativo', count(*) from public.lead_pontuacao where pontos <= 0) f)
  )
)
from c;
$fn$;

revoke execute on function public.qualidade_email(int) from public, anon;
grant execute on function public.qualidade_email(int) to authenticated, service_role;

commit;
