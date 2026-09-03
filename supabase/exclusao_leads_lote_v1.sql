-- Exclusao atomica de varios leads explicitamente selecionados no painel.
-- A funcao individual continua sendo a fonte unica das regras de limpeza.
begin;

create or replace function public.excluir_leads_ressoar(p_lead_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_lead_id uuid;
  v_quantidade integer := 0;
  v_solicitados integer;
begin
  if auth.uid() is null or coalesce(public.papel_atual(), '') <> 'admin' then
    raise exception using
      errcode = '42501',
      message = 'Somente administradores podem excluir leads.';
  end if;

  -- Limitar o array bruto antes do UNNEST impede abuso com milhoes de
  -- duplicatas ou valores nulos, mesmo por uma sessao administrativa.
  if coalesce(cardinality(p_lead_ids), 0) > 100 then
    raise exception using
      errcode = '22023',
      message = 'Selecione no maximo 100 leads por exclusao.';
  end if;

  select count(distinct lead_id)
    into v_solicitados
  from unnest(coalesce(p_lead_ids, array[]::uuid[])) as ids(lead_id)
  where lead_id is not null;

  if v_solicitados = 0 then
    raise exception using
      errcode = '22023',
      message = 'Selecione ao menos um lead para excluir.';
  end if;

  -- Ordenar os IDs evita deadlock se dois administradores tentarem excluir
  -- lotes sobrepostos ao mesmo tempo. DISTINCT impede excluir o mesmo ID duas vezes.
  for v_lead_id in
    select distinct lead_id
    from unnest(p_lead_ids) as ids(lead_id)
    where lead_id is not null
    order by lead_id
  loop
    perform public.excluir_lead_ressoar(v_lead_id);
    v_quantidade := v_quantidade + 1;
  end loop;

  if v_quantidade = 0 then
    raise exception using
      errcode = '22023',
      message = 'Selecione ao menos um lead valido para excluir.';
  end if;

  return jsonb_build_object(
    'ok', true,
    'quantidade', v_quantidade
  );
end;
$$;

comment on function public.excluir_leads_ressoar(uuid[]) is
  'Exclui atomicamente ate 100 leads explicitamente selecionados. Somente admin.';

revoke all on function public.excluir_leads_ressoar(uuid[]) from public, anon;
grant execute on function public.excluir_leads_ressoar(uuid[]) to authenticated;

commit;
