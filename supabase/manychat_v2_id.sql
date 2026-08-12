-- =====================================================================
-- MANYCHAT v2 — guardar o id do assinante
--
-- A v1 procurava a pessoa no ManyChat por e-mail e, se não achasse, por
-- telefone. Testando na conta real, nenhum dos dois encontra ninguém:
--
--   - findBySystemField aceita SÓ "phone" ou "email" (a própria API
--     responde "Only phone or email can be specified");
--   - nesta conta os assinantes vêm do WhatsApp e do Instagram, então
--     "email" e "phone" chegam vazios. O número está em "whatsapp_phone",
--     que não é um campo pesquisável.
--
-- Ou seja: procurar de fora para dentro não funciona, e nenhuma variação
-- de formato do telefone resolve. Quem sabe quem é a pessoa é o ManyChat.
--
-- Então o sentido se inverte. O ManyChat manda o subscriber_id para a
-- Ressoar uma vez (uma ação "External Request" dentro do fluxo dele), a
-- gente guarda esse id no lead, e a partir daí marcar é direto — sem
-- busca, sem ambiguidade, e funciona para quem nunca deu e-mail.
-- =====================================================================
begin;

alter table public.tabela_1_leads
  add column if not exists manychat_id text;

create unique index if not exists leads_manychat_id_key
  on public.tabela_1_leads (manychat_id) where manychat_id is not null;

-- ------------------------------------------------------------------
-- recebe o assinante vindo do ManyChat
-- ------------------------------------------------------------------
-- Casa por manychat_id, depois por e-mail, depois por WhatsApp. Se não
-- achar ninguém, cria — é gente do Instagram e do WhatsApp que nunca
-- passou por formulário, e é justamente essa a base que faltava aqui.
create or replace function public.manychat_registrar(
  p_manychat_id text,
  p_email text default null,
  p_whatsapp text default null,
  p_nome text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_lead uuid;
  v_fone text := nullif(regexp_replace(coalesce(p_whatsapp, ''), '\D', '', 'g'), '');
  v_email citext := nullif(lower(btrim(coalesce(p_email, ''))), '')::citext;
  v_como text;
begin
  if coalesce(btrim(p_manychat_id), '') = '' then
    return jsonb_build_object('ok', false, 'erro', 'sem subscriber_id');
  end if;

  select lead_id into v_lead from public.tabela_1_leads
  where manychat_id = p_manychat_id;
  if found then v_como := 'ja_ligado'; end if;

  if v_lead is null and v_email is not null then
    select lead_id into v_lead from public.tabela_1_leads where email = v_email;
    if found then v_como := 'pelo_email'; end if;
  end if;

  -- o número guardado aqui não tem o 55 na frente; o do ManyChat tem
  if v_lead is null and v_fone is not null then
    select lead_id into v_lead from public.tabela_1_leads
    where whatsapp is not null
      and regexp_replace(whatsapp, '\D', '', 'g') in (v_fone, right(v_fone, 11), right(v_fone, 10))
    limit 1;
    if found then v_como := 'pelo_whatsapp'; end if;
  end if;

  if v_lead is null then
    insert into public.tabela_1_leads (email, nome, whatsapp, manychat_id)
    values (v_email, nullif(btrim(coalesce(p_nome, '')), ''),
            -- respeita o UNIQUE do telefone: se já é de outro, entra sem
            case when v_fone is not null and not exists (
                   select 1 from public.tabela_1_leads o
                   where regexp_replace(coalesce(o.whatsapp,''), '\D', '', 'g') = right(v_fone, 11))
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

grant execute on function public.manychat_registrar(text, text, text, text)
  to authenticated, anon, service_role;

-- ------------------------------------------------------------------
-- aplicar tag: agora manda o id junto quando já o temos
-- ------------------------------------------------------------------
create or replace function public.manychat_aplicar(
  p_lead uuid, p_tag text, p_criar boolean default true)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_base text := public.cfg('base_url_tracking');
  v_key  text := public.segredo('service_key');
  v_lead record;
begin
  if coalesce(public.segredo('manychat_api_key'), '') = '' then
    return 'sem chave do ManyChat configurada';
  end if;
  if coalesce(v_base, '') = '' or coalesce(v_key, '') = '' then
    return 'falta base_url_tracking ou service_key';
  end if;

  select email, nome, whatsapp, manychat_id into v_lead
  from public.tabela_1_leads where lead_id = p_lead;
  if not found then return 'lead não encontrado'; end if;

  perform net.http_post(
    url := v_base || '/manychat',
    body := jsonb_build_object(
      'lead_id', p_lead, 'manychat_id', v_lead.manychat_id,
      'email', v_lead.email, 'nome', v_lead.nome,
      'whatsapp', v_lead.whatsapp, 'tag', p_tag, 'criar', p_criar),
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'Authorization', 'Bearer ' || v_key));
  return 'enviado';
end $$;

grant execute on function public.manychat_aplicar(uuid, text, boolean)
  to authenticated, service_role;

commit;

select (select count(*) from information_schema.columns
        where table_name='tabela_1_leads' and column_name='manychat_id')  as coluna_criada,
       (select count(*) from public.tabela_1_leads
        where manychat_id is not null)                                     as leads_ja_ligados,
       (select count(*) from public.tabela_1_leads)                        as leads_no_total;
