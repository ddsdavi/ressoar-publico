-- Descobrir os produtos a partir dos eventos que já chegaram.
--
-- Com uma configuração única para "todos os produtos", a Hotmart manda
-- tudo e é o Ressoar que decide o que fazer com cada um. Então o mapa
-- precisa ser fácil de preencher — e o mais fácil é não digitar nada:
-- os nomes e ucodes vêm dos próprios eventos recebidos.
begin;

create or replace function public.hotmart_produtos_vistos()
returns table (produto text, ucode text, eventos bigint,
               primeira timestamptz, ultima timestamptz, mapeado boolean)
language sql stable security definer set search_path = public as $$
  select e.produto,
         max(e.corpo #>> '{data,product,ucode}') as ucode,
         count(*),
         min(e.recebido_em),
         max(e.recebido_em),
         exists (select 1 from public.hotmart_produtos m
                 where m.ativo
                   and ((m.ucode is not null and m.ucode = max(e.corpo #>> '{data,product,ucode}'))
                        or (coalesce(m.padrao_nome,'') <> '' and e.produto ilike '%' || m.padrao_nome || '%')))
  from public.hotmart_eventos e
  where coalesce(e.produto, '') <> ''
  group by e.produto
  order by 3 desc
$$;

grant execute on function public.hotmart_produtos_vistos() to authenticated;

-- reprocessa um evento guardado: serve quando o mapa estava errado ou
-- vazio na hora em que a venda entrou
create or replace function public.reprocessar_evento_hotmart(p_evento uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  e record;
  v_lead uuid;
  v_status text;
begin
  select * into e from public.hotmart_eventos where evento_id = p_evento;
  if not found then return jsonb_build_object('erro', 'evento não encontrado'); end if;

  select lead_fk, status into v_lead, v_status
  from public.tabela_4_alunos where codigo_transacao = e.transacao;

  if v_lead is null then
    return jsonb_build_object('erro', 'a compra desse evento não está gravada; reenvie pelo webhook');
  end if;

  return public.aplicar_mapa_produto(
    v_lead, e.produto, v_status, e.corpo #>> '{data,product,ucode}');
end $$;

grant execute on function public.reprocessar_evento_hotmart(uuid) to authenticated;

commit;
select 'ok' as pronto;
