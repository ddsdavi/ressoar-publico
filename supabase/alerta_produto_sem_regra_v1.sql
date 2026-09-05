-- =====================================================================
-- PRODUTO QUE VENDE SEM REGRA — o painel passa a avisar sozinho
--
-- Por que existe: quando uma compra chega, `aplicar_mapa_produto` procura
-- o produto no mapa (`hotmart_produtos`) para saber em que lista a pessoa
-- entra, que tag ela ganha e o que marcar no ManyChat. Produto que não
-- está no mapa **registra a venda e não faz mais nada** — e faz isso em
-- silêncio, que é o pior jeito de falhar: ninguém percebe até alguém
-- perguntar por que a automação não alcançou os compradores.
--
-- Em 04/09/2026 um levantamento à mão achou **158 compras em 30 dias**
-- assim, em oito produtos. Três deles tinham volume e ganharam regra no
-- mesmo dia. O que não dava para aceitar era o levantamento ser à mão:
-- produto novo entra em campanha a qualquer momento, e o buraco volta.
--
-- Agora o próprio sistema pergunta, uma vez por dia: vendeu algo que o
-- mapa não conhece? Se sim, alerta no painel, com o nome do produto e
-- quantas vendas — e o alerta some sozinho quando a regra é criada.
--
-- Uma decisão: o alerta é `aviso`, não `critico`. A venda foi registrada,
-- o dinheiro está contado, o lead existe. O que falta é a esteira, e isso
-- se resolve em dois minutos pela tela (Vendas > Regras de produto).
-- Alerta crítico que não é crítico ensina a ignorar alerta.
--
-- Silêncio de 20 horas: com o relógio diário, um alerta por dia enquanto
-- o produto seguir sem regra — nunca uma enxurrada.
--
-- Reversível: `select cron.unschedule('ressoar-produtos-sem-regra');`
-- Só lê e escreve na tabela de alertas.
-- =====================================================================

begin;

create or replace function public.produtos_sem_regra(p_dias int default 7)
returns table (nome_produto text, vendas bigint)
language sql stable security definer set search_path to 'public' as $$
  select c.nome_produto, count(*) as vendas
    from public.tabela_4_alunos c
   where c.status = 'aprovada'
     and coalesce(c.data_compra, c.created_at) > now() - make_interval(days => greatest(1, p_dias))
     and coalesce(c.nome_produto, '') <> ''
     and not exists (
           select 1 from public.hotmart_produtos p
            where p.ativo
              and coalesce(p.padrao_nome, '') <> ''
              and c.nome_produto ilike '%' || p.padrao_nome || '%')
   group by 1
   order by 2 desc, 1
$$;

revoke execute on function public.produtos_sem_regra(int) from public, anon;
grant execute on function public.produtos_sem_regra(int) to authenticated, service_role;

create or replace function public.checar_produtos_sem_regra(p_dias int default 7)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_lista jsonb;
  v_qtd   int;
  v_vendas bigint;
begin
  select coalesce(jsonb_agg(jsonb_build_object('produto', nome_produto, 'vendas', vendas)), '[]'::jsonb),
         count(*), coalesce(sum(vendas), 0)
    into v_lista, v_qtd, v_vendas
    from public.produtos_sem_regra(p_dias);

  if v_qtd = 0 then
    return jsonb_build_object('achou', false);
  end if;

  perform public.registrar_alerta(
    'produto_sem_regra',
    v_qtd || ' produto(s) vendendo sem regra',
    'Nos últimos ' || p_dias || ' dias, ' || v_vendas || ' compra(s) de ' || v_qtd
      || ' produto(s) que o mapa não conhece: '
      || (select string_agg(x->>'produto', ', ') from jsonb_array_elements(v_lista) x)
      || '. A venda foi registrada, mas quem comprou não entrou em lista, não ganhou tag '
      || 'e nenhuma automação o alcança. Cadastre em Vendas > Regras de produto.',
    'aviso',
    jsonb_build_object('dias', p_dias, 'produtos', v_lista),
    20);

  return jsonb_build_object('achou', true, 'produtos', v_qtd,
                            'vendas', v_vendas, 'detalhe', v_lista);
end $$;

grant execute on function public.checar_produtos_sem_regra(int) to service_role;

commit;

-- 9h de São Paulo = 12h UTC, depois do resumo diário
select cron.schedule('ressoar-produtos-sem-regra', '0 12 * * *',
                     'select public.checar_produtos_sem_regra(7)')
where not exists (select 1 from cron.job where jobname = 'ressoar-produtos-sem-regra');

-- ---- provas ---------------------------------------------------------
select * from public.produtos_sem_regra(30);
select count(*) as relogio from cron.job where jobname = 'ressoar-produtos-sem-regra';
