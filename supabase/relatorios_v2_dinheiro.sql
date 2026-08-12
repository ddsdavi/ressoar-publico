-- =====================================================================
-- RELATÓRIOS v2 — "De onde vem o dinheiro" que dá para entender.
--
-- O diagnóstico (medido em 06/08/2026): só 206 dos 6.232 compradores têm
-- origem (3%) — o rastreio nasceu com o Ressoar, o histórico veio sem.
-- A tela mostrava "(sem origem) R$ 232 mil" na primeira linha, jargão de
-- máquina (paid_metaads) e conversão de "100%" calculada sobre 1 pessoa.
-- Tecnicamente certo, humanamente inútil.
--
-- O que muda no banco:
--   1. rel_atribuicao e rel_anuncios ganham p_dias (janela de tempo) —
--      os últimos 30 dias têm 21% de cobertura e melhorando; é a foto
--      que faz sentido olhar. DROP antes de recriar: assinatura nova
--      criaria SOBRECARGA, e sobrecarga já derrubou o processamento de
--      venda uma vez (PGRST203, armadilha 38).
--   2. rel_dinheiro_resumo(p_dias): os números do topo da tela — quantas
--      compras têm origem, quanta receita é rastreada — para a tela
--      falar a verdade ANTES de mostrar qualquer ranking.
-- A tradução dos nomes (paid_metaads → "Anúncios pagos (Meta)") mora no
-- painel: é rótulo de exibição, não dado.
-- =====================================================================
begin;

drop function if exists public.rel_atribuicao(text);
create or replace function public.rel_atribuicao(p_campo text default 'origem_trafego', p_dias int default null)
returns table (valor text, compradores bigint, compras bigint, receita numeric,
               ticket numeric, leads bigint, conversao numeric)
language plpgsql stable security definer set search_path to 'public' as $$
begin
  return query execute format($f$
    with base as (
      select la.lead_fk,
             coalesce(nullif(la.dados ->> %L, ''), '(sem origem)') as valor
      from public.lead_atributos la
    ),
    vendas as (
      select b.valor,
             count(distinct c.lead_fk) as compradores,
             count(*) as compras,
             coalesce(sum(c.valor) filter (where c.moeda = 'BRL'), 0) as receita,
             count(*) filter (where c.moeda = 'BRL') as compras_brl
      from base b
      join public.tabela_4_alunos c on c.lead_fk = b.lead_fk and c.status = 'aprovada'
      where $1::int is null
         or coalesce(c.data_compra, c.created_at) > now() - make_interval(days => $1)
      group by b.valor
    ),
    todos as (select base.valor, count(*) as leads from base group by base.valor)
    select t.valor,
           coalesce(v.compradores, 0),
           coalesce(v.compras, 0),
           coalesce(v.receita, 0)::numeric(12,2),
           (coalesce(v.receita, 0) / nullif(v.compras_brl, 0))::numeric(12,2),
           t.leads,
           (100.0 * coalesce(v.compradores, 0) / nullif(t.leads, 0))::numeric(6,2)
    from todos t
    join vendas v on v.valor = t.valor
    order by 4 desc, 6 desc
  $f$, p_campo) using p_dias;
end $$;

revoke execute on function public.rel_atribuicao(text, int) from public, anon;
grant execute on function public.rel_atribuicao(text, int) to authenticated, service_role;

drop function if exists public.rel_anuncios(integer);
create or replace function public.rel_anuncios(p_limite integer default 20, p_dias int default null)
returns table (anuncio text, rede text, pagina text, compradores bigint,
               receita numeric, primeira date, ultima date)
language sql stable security definer set search_path to 'public' as $$
  select coalesce(nullif(la.dados ->> 'anuncio_id', ''), '(sem anúncio)'),
         max(la.dados ->> 'rede'),
         max(la.dados ->> 'pagina_captura'),
         count(distinct c.lead_fk),
         coalesce(sum(c.valor) filter (where c.moeda = 'BRL'), 0)::numeric(12,2),
         min(c.data_compra)::date,
         max(c.data_compra)::date
  from public.lead_atributos la
  join public.tabela_4_alunos c on c.lead_fk = la.lead_fk and c.status = 'aprovada'
  where p_dias is null
     or coalesce(c.data_compra, c.created_at) > now() - make_interval(days => p_dias)
  group by 1
  order by 5 desc
  limit greatest(1, least(coalesce(p_limite, 20), 100))
$$;

revoke execute on function public.rel_anuncios(integer, int) from public, anon;
grant execute on function public.rel_anuncios(integer, int) to authenticated, service_role;

-- os números do topo: quanta verdade a tela consegue contar
create or replace function public.rel_dinheiro_resumo(p_dias int default 30)
returns jsonb
language sql stable security definer set search_path to 'public' as $$
  with v as (
    select c.lead_fk, c.valor, c.moeda,
           exists (select 1 from public.lead_atributos la
                   where la.lead_fk = c.lead_fk
                     and coalesce(la.dados ->> 'origem_trafego', '') <> '') as tem_origem
    from public.tabela_4_alunos c
    where c.status = 'aprovada'
      and (p_dias is null
           or coalesce(c.data_compra, c.created_at) > now() - make_interval(days => p_dias)))
  select jsonb_build_object(
    'compras',            (select count(*) from v),
    'compras_com_origem', (select count(*) from v where tem_origem),
    'receita',            (select round(coalesce(sum(v.valor) filter (where v.moeda = 'BRL'), 0)) from v),
    'receita_rastreada',  (select round(coalesce(sum(v.valor) filter (where v.moeda = 'BRL' and v.tem_origem), 0)) from v))
$$;

revoke execute on function public.rel_dinheiro_resumo(int) from public, anon;
grant execute on function public.rel_dinheiro_resumo(int) to authenticated, service_role;

commit;

-- conferência: 30 dias e desde sempre
select public.rel_dinheiro_resumo(30) as ultimos_30d, public.rel_dinheiro_resumo(null) as desde_sempre;
select valor, compradores, receita from public.rel_atribuicao('origem_trafego', 30) limit 5;
