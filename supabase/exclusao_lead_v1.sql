-- Exclusao individual de um lead pela area Contatos > Leads.
-- A operacao e atomica e restrita a administradores aprovados.
begin;

create or replace function public.excluir_lead_ressoar(p_lead_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_lead record;
begin
  if auth.uid() is null or coalesce(public.papel_atual(), '') <> 'admin' then
    raise exception using
      errcode = '42501',
      message = 'Somente administradores podem excluir leads.';
  end if;

  select lead_id, nome, email, whatsapp
    into v_lead
  from public.tabela_1_leads
  where lead_id = p_lead_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'Lead nao encontrado.';
  end if;

  -- Preserva a supressao de e-mail, mas solta a referencia ao envio que sera
  -- removido. Assim uma exclusao nunca reinscreve alguem por acidente.
  update public.supressao
     set origem_envio_fk = null
   where origem_envio_fk in (
     select envio_id from public.envios where lead_fk = p_lead_id
   );

  -- Estas tabelas antigas nao possuem FK com ON DELETE CASCADE na producao.
  delete from public.eventos_email
   where lead_fk = p_lead_id
      or envio_fk in (
        select envio_id from public.envios where lead_fk = p_lead_id
      );
  delete from public.envios where lead_fk = p_lead_id;
  delete from public.data_disparos where lead_fk = p_lead_id;
  delete from public.eventos_sistema where lead_fk = p_lead_id;
  delete from public.manychat_log where lead_fk = p_lead_id;

  -- Remove tambem a copia importada do ActiveCampaign ligada ao cadastro.
  delete from public.ac_contacts where lead_fk = p_lead_id;

  -- Listas, tags, notas, pontos, automacoes, participacoes, pre-checkouts e
  -- compras possuem FK com cascade e sao removidos junto com o cadastro.
  delete from public.tabela_1_leads where lead_id = p_lead_id;

  return jsonb_build_object(
    'ok', true,
    'lead_id', v_lead.lead_id,
    'nome', v_lead.nome,
    'email', v_lead.email,
    'whatsapp', v_lead.whatsapp
  );
end;
$$;

comment on function public.excluir_lead_ressoar(uuid) is
  'Exclui atomicamente um lead da Ressoar e seus vinculos internos. Somente admin.';

revoke all on function public.excluir_lead_ressoar(uuid) from public, anon;
grant execute on function public.excluir_lead_ressoar(uuid) to authenticated;

commit;
