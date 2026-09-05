-- =====================================================================
-- A ESTEIRA VIRA CONFIGURAÇÃO — a régua de venda deixa de citar produto
--
-- Por que existe: `recalcular_pontuacao_venda` decidia a PRÓXIMA OFERTA
-- de cada lead comparando o nome do produto comprado com três textos
-- escritos dentro dela, e olhando uma lista pelo número 6. Os três
-- textos e o número são desta operação. Numa cópia da plataforma a
-- função rodava — e classificava todo mundo errado, em silêncio: sem
-- produto que casasse, ninguém tinha o produto principal, ninguém era
-- topo, e a base inteira caía em "aquecer primeiro". Era a maior
-- adaptação por instalação, e a única que ainda exigia programação.
--
-- Agora são três chaves em app_config, e o desenho por trás continua o
-- mesmo, porque ele não é de nenhuma operação em particular:
--
--   esteira_produto_principal   o produto que define quem "já entrou"
--   esteira_produtos_topo       os produtos de topo, separados por vírgula
--   esteira_lista_aquecimento   a lista de quem é aquecido sem ter comprado
--
-- Casa por `ilike '%texto%'`, então basta um pedaço estável do nome.
--
-- A guarda que não pode sair: vazio NÃO vira `ilike '%%'`. Com o campo
-- vazio, `'%%'` casaria com QUALQUER produto e jogaria a base inteira no
-- degrau errado, sem erro nenhum na tela. Por isso cada teste começa
-- por `v_principal <> ''` e a lista de topo ignora item em branco.
--
-- Os nomes dos degraus (`formacao_janela_quente`, `desafio_lives`…)
-- ficam como estão: são códigos internos, já gravados em segmentos, no
-- resumo diário e na automação da janela quente, e a tela os traduz por
-- `JOGADAS` em `app/painel/src/lib/venda.ts` — é lá que uma cópia troca
-- os títulos que o operador lê.
--
-- Reversível: as chaves guardam hoje exatamente os valores que estavam
-- escritos na função, então esta migração NÃO muda o resultado desta
-- operação. Foi conferido comparando a distribuição por degrau antes e
-- depois do recálculo completo, em 04/09/2026.
-- =====================================================================

begin;

-- Os valores DESTA operação. `do nothing`: uma reinstalação não
-- sobrescreve o que o dono já tiver ajustado pela tela ou pelo SQL.
insert into public.app_config (chave, valor) values
  ('esteira_produto_principal',  'Formação em Biorressonância Aplicada'),
  ('esteira_produtos_topo',      'Black Ressonante,Acompanhamento Ressonante'),
  ('esteira_lista_aquecimento',  '6')
on conflict (chave) do nothing;

create or replace function public.recalcular_pontuacao_venda(p_lead uuid default null)
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_qtd int;
  v_c1 int; v_c2 int; v_c3 int;
  -- A esteira desta operação, lida da configuração (esteira_configuravel_v1).
  -- Vazio = o degrau que depende dela simplesmente não classifica ninguém;
  -- NUNCA vira `ilike '%%'`, que casaria com todo produto e mandaria a base
  -- inteira para o degrau errado.
  v_principal text := btrim(coalesce(public.cfg('esteira_produto_principal'), ''));
  v_topo      text := coalesce(public.cfg('esteira_produtos_topo'), '');
  v_lista_aq  int  := nullif(btrim(coalesce(public.cfg('esteira_lista_aquecimento'), '')), '')::int;
begin
  with base as (
    select l.lead_id, l.email,
           -- data real de entrada: created_at ou tag mais recente (as datas
           -- de lista têm resíduo da importação — lição da pontuação v1.2)
           greatest(l.created_at,
             coalesce((select max(lt.created_at) from public.lead_tags lt
                       where lt.lead_fk = l.lead_id), l.created_at)) as entrada
    from public.tabela_1_leads l
    where p_lead is null or l.lead_id = p_lead
  ),
  comp as (
    select c.lead_fk,
           count(*) as compras,
           coalesce(sum(c.valor) filter (where c.moeda = 'BRL'), 0) as gasto,
           max(coalesce(c.data_compra, c.created_at)) as ultima,
           bool_or(v_principal <> '' and c.nome_produto ilike '%' || v_principal || '%')
             as tem_formacao,
           bool_or(exists (select 1 from unnest(string_to_array(v_topo, ',')) t
                            where btrim(t) <> ''
                              and c.nome_produto ilike '%' || btrim(t) || '%'))
             as tem_topo_prod
    from public.tabela_4_alunos c
    where c.status = 'aprovada'
      and (p_lead is null or c.lead_fk = p_lead)
    group by 1
  ),
  extras as (
    select b.lead_id,
           exists (select 1 from public.tabela_4_alunos c2
                   where c2.lead_fk = b.lead_id
                     and c2.status in ('reembolsada','chargeback')) as tem_reembolso,
           exists (select 1 from public.lead_listas lv
                   where lv.lead_fk = b.lead_id and lv.lista_fk = v_lista_aq
                     and lv.status = 1) as lives,
           (select count(*) from public.tabela_2_participacoes tp
            where tp.lead_fk = b.lead_id) as participacoes,
           (b.email is not null
             and not exists (select 1 from public.supressao s where s.email = b.email)
             and exists (select 1 from public.lead_listas la
                         where la.lead_fk = b.lead_id and la.status = 1)) as alcancavel
    from base b
  ),
  calc as (
    select b.lead_id,
           coalesce(co.compras, 0) as compras,
           coalesce(co.gasto, 0)   as gasto,
           co.ultima,
           coalesce(co.tem_formacao, false) as tem_formacao,
           coalesce(co.tem_topo_prod, false) as tem_topo,
           e.tem_reembolso, e.lives, e.alcancavel,
           case when co.ultima is not null
                then floor(extract(epoch from (now() - co.ultima)) / 86400)::int end as dias_compra,
           floor(extract(epoch from (now() - b.entrada)) / 86400)::int as dias_entrada,
           greatest(0, least(100,
             case when coalesce(co.compras, 0) > 0 then
                 -- comprador: recência com decaimento + frequência + gasto
                 round(45 * exp(-(extract(epoch from (now() - co.ultima)) / 86400.0) / 45.0))::int
               + least(co.compras, 5) * 4
               + case when co.gasto >= 1500 then 15
                      when co.gasto >= 800  then 12
                      when co.gasto >= 300  then 9
                      when co.gasto >= 100  then 6
                      when co.gasto >= 40   then 4
                      when co.gasto > 0     then 2
                      else 0 end
             else
                 -- sem compra: o que separa as pessoas é há quanto tempo entraram
                 case when b.entrada > now() - interval '30 days'  then 12
                      when b.entrada > now() - interval '90 days'  then 8
                      when b.entrada > now() - interval '180 days' then 5
                      when b.entrada > now() - interval '365 days' then 2
                      else 0 end
             end
             + case when e.lives then 6 else 0 end
             + least(e.participacoes, 3)::int
             - case when e.tem_reembolso and coalesce(co.compras, 0) = 0 then 40
                    when e.tem_reembolso then 10
                    else 0 end
           ))::int as pontos
    from base b
    left join comp co on co.lead_fk = b.lead_id
    join extras e on e.lead_id = b.lead_id
  ),
  final as (
    select c.*,
      case
        when c.tem_reembolso and c.compras = 0 then 'tratar_reembolso'
        when c.tem_formacao and not c.tem_topo then 'alumni_black_acomp'
        when c.tem_formacao and c.tem_topo     then 'vip_relacionamento'
        when c.compras > 0 and c.dias_compra <= 30 then 'formacao_janela_quente'
        when c.compras > 0 and c.dias_compra <= 90 then 'formacao_segunda_chamada'
        when c.compras > 0 then 'reativar_esteira'
        when c.lives then 'desafio_lives'
        when c.dias_entrada <= 90 then 'desafio_novos'
        else 'aquecer_primeiro'
      end as oferta,
      case when c.compras > 0 then
        'Comprou ' || c.compras || 'x · R$ ' || round(c.gasto) ||
        ' · última há ' || c.dias_compra || ' d' ||
        case when c.lives then ' · Lives' else '' end ||
        case when c.tem_reembolso then ' · teve reembolso' else '' end
      else
        'Sem compra · na base há ' || c.dias_entrada || ' d' ||
        case when c.lives then ' · Lives' else '' end ||
        case when c.tem_reembolso then ' · reembolso' else '' end
      end as motivo
    from calc c
  )
  insert into public.lead_venda as lv
    (lead_fk, pontos_venda, proxima_oferta, motivo, ultima_compra,
     compras, gasto_total, alcancavel, calculado_em)
  select lead_id, pontos, oferta, motivo, ultima::date,
         compras, gasto, alcancavel, now()
  from final
  on conflict (lead_fk) do update set
    pontos_venda   = excluded.pontos_venda,
    proxima_oferta = excluded.proxima_oferta,
    motivo         = excluded.motivo,
    ultima_compra  = excluded.ultima_compra,
    compras        = excluded.compras,
    gasto_total    = excluded.gasto_total,
    alcancavel     = excluded.alcancavel,
    calculado_em   = now();

  get diagnostics v_qtd = row_count;

  if p_lead is null then
    -- recálculo completo: recomputa os cortes de percentil e as faixas
    select round(percentile_cont(0.95) within group (order by pontos_venda))::int,
           round(percentile_cont(0.85) within group (order by pontos_venda))::int,
           round(percentile_cont(0.55) within group (order by pontos_venda))::int
      into v_c1, v_c2, v_c3
    from public.lead_venda where alcancavel;

    v_c1 := coalesce(v_c1, 60); v_c2 := coalesce(v_c2, 45); v_c3 := coalesce(v_c3, 20);

    insert into public.venda_cortes (nome, corte) values
      ('prontissimo', v_c1), ('pronto', v_c2), ('aquecendo', v_c3)
    on conflict (nome) do update set corte = excluded.corte;

    update public.lead_venda set faixa =
      case when pontos_venda >= v_c1 then 'prontissimo'
           when pontos_venda >= v_c2 then 'pronto'
           when pontos_venda >= v_c3 then 'aquecendo'
           else 'frio' end
    where faixa is distinct from
      case when pontos_venda >= v_c1 then 'prontissimo'
           when pontos_venda >= v_c2 then 'pronto'
           when pontos_venda >= v_c3 then 'aquecendo'
           else 'frio' end;
  else
    -- recálculo pontual: usa os cortes gravados (ou uma régua de
    -- segurança se o completo nunca rodou)
    select coalesce((select corte from public.venda_cortes where nome = 'prontissimo'), 60),
           coalesce((select corte from public.venda_cortes where nome = 'pronto'), 45),
           coalesce((select corte from public.venda_cortes where nome = 'aquecendo'), 20)
      into v_c1, v_c2, v_c3;

    update public.lead_venda set faixa =
      case when pontos_venda >= v_c1 then 'prontissimo'
           when pontos_venda >= v_c2 then 'pronto'
           when pontos_venda >= v_c3 then 'aquecendo'
           else 'frio' end
    where lead_fk = p_lead;
  end if;

  return v_qtd;
end $$;

-- os mesmos donos de sempre: o painel e o motor
revoke execute on function public.recalcular_pontuacao_venda(uuid) from public, anon;
grant execute on function public.recalcular_pontuacao_venda(uuid) to authenticated, service_role;

commit;

-- ---- provas ---------------------------------------------------------
-- 1. a função não cita mais nome de produto nenhum
select not (pg_get_functiondef('public.recalcular_pontuacao_venda'::regproc)
              ilike '%Biorressonância%')
       as sem_produto_no_codigo;

-- 2. a configuração está lá
select chave, valor from public.app_config
 where chave like 'esteira_%' order by chave;

-- 3. rode o recálculo e compare com o retrato de antes
--    select public.recalcular_pontuacao_venda();
select proxima_oferta, count(*) as leads
  from public.lead_venda group by 1 order by 2 desc;
