-- =====================================================================
-- UMA FORMA CANÔNICA DE TELEFONE, IGUAL DOS DOIS LADOS
--
-- Eu tinha casado telefone comparando os 10 últimos dígitos. Parece
-- inofensivo e não é: em número brasileiro isso descarta o primeiro dígito
-- do DDD.
--
--   5521 90000-0000  →  últimos 10 = 1900000000
--   5511 90000-0000  →  últimos 10 = 1900000000
--
-- Duas pessoas diferentes, em estados diferentes, viram a mesma. Achei
-- testando com um número inventado do DDD 11 e recebendo de volta uma
-- pessoa real do DDD 21. Num fluxo que aplica tag, isso é mandar WhatsApp
-- para quem não comprou.
--
-- A correção é normalizar os dois lados para a MESMA forma antes de
-- comparar — e a forma é a mesma que a ponte com o ManyChat usa, senão
-- volta a dar diferença entre o que a Ressoar acha e o que existe lá.
-- =====================================================================
begin;

create or replace function public.normalizar_telefone(p_bruto text)
returns text
language plpgsql immutable as $$
declare
  n text := nullif(regexp_replace(coalesce(p_bruto, ''), '\D', '', 'g'), '');
begin
  if n is null then return null; end if;

  -- celular brasileiro com DDI: 55 + DDD + 9 + 8 dígitos
  if length(n) = 13 and left(n, 2) = '55' then return n; end if;

  -- fixo brasileiro com DDI: falta o 9
  if length(n) = 12 and left(n, 2) = '55' then
    return left(n, 4) || '9' || substr(n, 5);
  end if;

  -- estrangeiro já com DDI
  if length(n) >= 12 then return n; end if;

  -- celular brasileiro sem DDI — o 9 na terceira casa é o que o denuncia
  if length(n) = 11 and substr(n, 3, 1) = '9' then return '55' || n; end if;

  -- 11 dígitos sem esse 9: provavelmente estrangeiro
  if length(n) = 11 then return n; end if;

  -- fixo brasileiro sem DDI
  if length(n) = 10 then return '55' || left(n, 2) || '9' || substr(n, 3); end if;

  return null;   -- curto demais para ser telefone
end $$;

-- ------------------------------------------------------------------
-- quem é este número aqui dentro — agora comparando forma canônica
-- ------------------------------------------------------------------
create or replace function public.lead_por_whatsapp(p_fone text)
returns jsonb
language sql security definer stable set search_path = public as $$
  select case when l.lead_id is null then null else
    jsonb_build_object(
      'lead_id', l.lead_id, 'nome', l.nome, 'email', l.email,
      'whatsapp', l.whatsapp, 'manychat_id', l.manychat_id,
      'tags', (select coalesce(jsonb_agg(t.nome order by t.nome), '[]'::jsonb)
               from public.lead_tags lt join public.tags t on t.tag_id = lt.tag_fk
               where lt.lead_fk = l.lead_id),
      'listas', (select coalesce(jsonb_agg(li.nome order by li.nome), '[]'::jsonb)
                 from public.lead_listas ll join public.listas li on li.lista_id = ll.lista_fk
                 where ll.lead_fk = l.lead_id and ll.status = 1))
  end
  from (select public.normalizar_telefone(p_fone) as n) a
  left join lateral (
    select * from public.tabela_1_leads x
    where a.n is not null
      and public.normalizar_telefone(x.whatsapp) = a.n
    limit 1
  ) l on true;
$$;

create or replace function public.testar_regra_produto(
  p_nome text, p_whatsapp text, p_email text, p_produto_id int)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  m record;
  v_lead uuid;
  v_fone text := public.normalizar_telefone(p_whatsapp);
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
  if v_fone is null then
    return jsonb_build_object('ok', false, 'erro', 'telefone inválido');
  end if;

  select lead_id into v_lead from public.tabela_1_leads
  where public.normalizar_telefone(whatsapp) = v_fone limit 1;
  if found then
    v_como := 'já existia na Ressoar';
  else
    insert into public.tabela_1_leads (nome, whatsapp)
    values (nullif(btrim(coalesce(p_nome, '')), ''),
            case when not exists (select 1 from public.tabela_1_leads o
                                  where o.whatsapp = right(v_fone, 11))
                 then right(v_fone, 11) end)
    returning lead_id into v_lead;
    v_como := 'criado agora na Ressoar';
  end if;

  v_res := public.aplicar_mapa_produto(v_lead, coalesce(m.padrao_nome, m.apelido),
                                       'aprovada', m.ucode, now());

  return jsonb_build_object('ok', true, 'lead_id', v_lead, 'como', v_como,
                            'produto', m.apelido, 'resultado', v_res);
end $$;

-- o registro do ManyChat também passa a casar pela forma canônica
create or replace function public.manychat_registrar(
  p_manychat_id text, p_email text default null,
  p_whatsapp text default null, p_nome text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_lead uuid;
  v_fone text := public.normalizar_telefone(p_whatsapp);
  v_email citext := nullif(lower(btrim(coalesce(p_email, ''))), '')::citext;
  v_como text;
begin
  if coalesce(btrim(p_manychat_id), '') = '' then
    return jsonb_build_object('ok', false, 'erro', 'sem subscriber_id');
  end if;

  select lead_id into v_lead from public.tabela_1_leads where manychat_id = p_manychat_id;
  if found then v_como := 'ja_ligado'; end if;

  if v_lead is null and v_email is not null then
    select lead_id into v_lead from public.tabela_1_leads where email = v_email;
    if found then v_como := 'pelo_email'; end if;
  end if;

  if v_lead is null and v_fone is not null then
    select lead_id into v_lead from public.tabela_1_leads
    where public.normalizar_telefone(whatsapp) = v_fone limit 1;
    if found then v_como := 'pelo_whatsapp'; end if;
  end if;

  if v_lead is null then
    insert into public.tabela_1_leads (email, nome, whatsapp, manychat_id)
    values (v_email, nullif(btrim(coalesce(p_nome, '')), ''),
            case when v_fone is not null and not exists (
                   select 1 from public.tabela_1_leads o where o.whatsapp = right(v_fone, 11))
                 then right(v_fone, 11) end,
            p_manychat_id)
    returning lead_id into v_lead;
    v_como := 'criado';
  else
    update public.tabela_1_leads
    set manychat_id = p_manychat_id,
        nome = coalesce(nullif(nome, ''), nullif(btrim(coalesce(p_nome, '')), '')),
        email = coalesce(email, v_email)
    where lead_id = v_lead;
  end if;

  return jsonb_build_object('ok', true, 'lead', v_lead, 'como', v_como);
end $$;

grant execute on function public.normalizar_telefone(text) to authenticated, anon, service_role;
grant execute on function public.lead_por_whatsapp(text) to authenticated;
grant execute on function public.testar_regra_produto(text, text, text, int) to authenticated;
grant execute on function public.manychat_registrar(text, text, text, text)
  to authenticated, anon, service_role;

commit;

-- prova: os DDDs que se confundiam agora são pessoas diferentes
select public.normalizar_telefone('5521900000000') as ddd21,
       public.normalizar_telefone('5511900000000') as ddd11,
       public.normalizar_telefone('5521900000000')
         <> public.normalizar_telefone('5511900000000')          as sao_diferentes,
       public.lead_por_whatsapp('5511900000000') is null         as ddd11_nao_acha_ninguem,
       public.lead_por_whatsapp('(51) 99999-0000') ->> 'nome'    as continua_achando,
       public.normalizar_telefone('(51) 99999-0000')
         = public.normalizar_telefone('5551999990000')           as formatos_convergem;
