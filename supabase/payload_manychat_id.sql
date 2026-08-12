-- =====================================================================
-- O pacote do contato passa a levar o ID DO MANYCHAT.
--
-- Por que isso importa: a planilha das lives tem uma coluna "ID do
-- Contato" que sempre guardou o identificador do ManyChat (1347252605),
-- não o da Ressoar. Sem esse número no pacote, o passo de planilha só
-- tinha o uuid daqui para oferecer — e escrevia o número errado numa
-- coluna que alguém pode usar para cruzar dados lá.
--
-- Vale para todos os passos que recebem o contato: planilha, webhook e
-- Drive. Quem já usava `contato.lead_id` continua igual.
-- =====================================================================
begin;

create or replace function public.payload_contato(p_lead uuid) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'lead_id', l.lead_id,
    'manychat_id', l.manychat_id,
    'email', l.email,
    'nome', l.nome,
    'whatsapp', l.whatsapp,
    'atributos', coalesce(a.dados, '{}'::jsonb),
    'listas', coalesce((select jsonb_agg(jsonb_build_object('id', li.lista_id, 'nome', li.nome, 'status', ll.status))
                        from public.lead_listas ll join public.listas li on li.lista_id = ll.lista_fk
                        where ll.lead_fk = l.lead_id), '[]'::jsonb),
    'tags', coalesce((select jsonb_agg(t.nome)
                      from public.lead_tags lt join public.tags t on t.tag_id = lt.tag_fk
                      where lt.lead_fk = l.lead_id), '[]'::jsonb)
  )
  from public.tabela_1_leads l
  left join public.lead_atributos a on a.lead_fk = l.lead_id
  where l.lead_id = p_lead
$$;

commit;

-- prova: o número do ManyChat agora viaja junto
select public.payload_contato(
         (select lead_id from public.tabela_1_leads
          where manychat_id is not null limit 1))->>'manychat_id' as manychat_id_no_pacote;
