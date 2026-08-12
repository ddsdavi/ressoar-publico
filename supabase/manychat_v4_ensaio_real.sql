-- =====================================================================
-- RODAR A REGRA DE UM PRODUTO À MÃO
--
-- "Preciso testar a operação real antes de deixar a automação rodando."
--
-- Isto faz exatamente o que acontece quando uma compra é aprovada: acha ou
-- cria o contato, entra na lista, ganha a tag da turma, e é marcado no
-- ManyChat. Nada é fingido — a pessoa aparece lá de verdade.
--
-- O que NÃO faz: não registra venda. Um teste não pode virar faturamento
-- no relatório, nem entrar na conta de quantos compraram.
-- =====================================================================
begin;

create or replace function public.testar_regra_produto(
  p_nome text, p_whatsapp text, p_email text, p_produto_id int)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  m record;
  v_lead uuid;
  v_email citext := nullif(lower(btrim(coalesce(p_email, ''))), '')::citext;
  v_fone text := nullif(regexp_replace(coalesce(p_whatsapp, ''), '\D', '', 'g'), '');
  v_como text;
  v_res jsonb;
begin
  if public.papel_atual() is distinct from 'admin' then
    raise exception 'só admin roda teste de regra';
  end if;

  select * into m from public.hotmart_produtos where id = p_produto_id;
  if not found then
    return jsonb_build_object('ok', false, 'erro', 'produto não encontrado');
  end if;
  if coalesce(v_fone, '') = '' then
    return jsonb_build_object('ok', false, 'erro',
      'sem WhatsApp não dá: é por ele que a pessoa é achada no ManyChat');
  end if;

  -- acha o contato aqui, do mesmo jeito que a venda acharia
  if v_email is not null then
    select lead_id into v_lead from public.tabela_1_leads where email = v_email;
    if found then v_como := 'já existia, achado pelo e-mail'; end if;
  end if;
  if v_lead is null then
    select lead_id into v_lead from public.tabela_1_leads
    where whatsapp is not null
      and regexp_replace(whatsapp, '\D', '', 'g') in (v_fone, right(v_fone, 11), right(v_fone, 10))
    limit 1;
    if found then v_como := 'já existia, achado pelo WhatsApp'; end if;
  end if;
  if v_lead is null then
    insert into public.tabela_1_leads (email, nome, whatsapp)
    values (v_email, nullif(btrim(coalesce(p_nome, '')), ''),
            case when not exists (
              select 1 from public.tabela_1_leads o
              where regexp_replace(coalesce(o.whatsapp,''), '\D','','g') = right(v_fone, 11))
            then right(v_fone, 11) end)
    returning lead_id into v_lead;
    v_como := 'criado agora na Ressoar';
  end if;

  -- e agora a regra, igual à da compra
  v_res := public.aplicar_mapa_produto(v_lead, coalesce(m.padrao_nome, m.apelido),
                                       'aprovada', m.ucode, now());

  return jsonb_build_object(
    'ok', true,
    'contato', jsonb_build_object('lead_id', v_lead, 'como', v_como),
    'produto', m.apelido,
    'resultado', v_res,
    'aviso', 'O ManyChat é chamado em segundo plano. Confira o resultado logo abaixo, '
          || 'ou procure a pessoa pelo WhatsApp nesta mesma tela.');
end $$;

grant execute on function public.testar_regra_produto(text, text, text, int) to authenticated;

commit;

select p.id, p.apelido,
       coalesce(p.tag_manychat, '—') as tag_no_manychat,
       p.tag_manychat_turma          as manda_turma
from public.hotmart_produtos p where p.ativo order by p.apelido;
