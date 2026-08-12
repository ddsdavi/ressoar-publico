-- =====================================================================
-- AUTH v1 do Ressoar — área logada com papéis:
--   admin      → tudo (Davi/a dona da conta)
--   terapeuta  → opera leads/campanhas/mensagens/automações (sem config/API)
--   assistente → somente leitura
-- Cadastro nasce 'pendente' + 'assistente'; admin aprova e promove
-- (desenho padrao de papeis com Supabase Auth).
-- =====================================================================
begin;

-- ------------------ perfis ------------------
create table if not exists public.usuarios_ressoa (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      citext not null unique,
  nome       text,
  papel      text not null default 'assistente' check (papel in ('admin','terapeuta','assistente')),
  status     text not null default 'pendente' check (status in ('pendente','aprovado','bloqueado')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.usuarios_ressoa enable row level security;

-- papel do usuário logado (null se não aprovado) — security definer p/ não recursar RLS
create or replace function public.papel_atual() returns text
language sql stable security definer set search_path = public as $$
  select papel from public.usuarios_ressoa
  where user_id = auth.uid() and status = 'aprovado'
$$;

-- todo usuário novo do Auth ganha perfil; e-mails do dono nascem admin aprovado
create or replace function public.fn_novo_usuario_auth() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_admin boolean := lower(new.email) in
    ('voce@exemplo.com','socio@exemplo.com',
     'dona@exemplo.com','suporte@exemplo.com');
begin
  insert into public.usuarios_ressoa (user_id, email, nome, papel, status)
  values (new.id, lower(new.email),
          coalesce(new.raw_user_meta_data->>'nome',''),
          case when v_admin then 'admin' else 'assistente' end,
          case when v_admin then 'aprovado' else 'pendente' end)
  on conflict (user_id) do nothing;
  -- avisa o motor que chegou cadastro novo (webhooks de saída podem notificar o admin)
  insert into public.eventos_sistema (tipo, payload)
  values ('usuario_cadastrado', jsonb_build_object('email', lower(new.email)));
  return new;
end $$;

drop trigger if exists trg_ressoa_novo_usuario on auth.users;
create trigger trg_ressoa_novo_usuario
  after insert on auth.users
  for each row execute function public.fn_novo_usuario_auth();

-- políticas do próprio perfil
drop policy if exists ressoa_perfil_proprio on public.usuarios_ressoa;
create policy ressoa_perfil_proprio on public.usuarios_ressoa
  for select to authenticated using (user_id = auth.uid());
drop policy if exists ressoa_perfil_admin on public.usuarios_ressoa;
create policy ressoa_perfil_admin on public.usuarios_ressoa
  for all to authenticated
  using (public.papel_atual() = 'admin') with check (public.papel_atual() = 'admin');

-- ------------------ grants de base p/ authenticated ------------------
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
grant usage, select on all sequences in schema public to authenticated;
-- (RLS é quem manda de verdade; sem policy = sem acesso)

-- ------------------ políticas por papel ------------------
do $$
declare
  t text;
  operacionais text[] := array[
    'tabela_1_leads','tabela_2_participacoes','tabela_3_precheckout','tabela_4_alunos',
    'listas','lead_listas','tags','lead_tags','lead_atributos',
    'mensagens','mensagem_links','campanhas','envios','eventos_email',
    'supressao','segmentos','automacoes','automacao_passos','automacao_execucoes',
    'eventos_sistema'];
  leitura_assistente text[] := array[
    'tabela_1_leads','tabela_2_participacoes','listas','lead_listas','tags','lead_tags',
    'lead_atributos','mensagens','campanhas','envios','eventos_email',
    'segmentos','automacoes','automacao_passos'];
  so_admin text[] := array[
    'app_config','webhooks_saida',
    'ac_contacts','ac_lists','ac_tags','ac_fields','ac_field_values',
    'ac_contact_tags','ac_contact_lists','ac_automations','ac_campaigns','ac_messages'];
begin
  foreach t in array operacionais loop
    execute format('drop policy if exists ressoa_opera on public.%I', t);
    execute format(
      'create policy ressoa_opera on public.%I for all to authenticated
       using (public.papel_atual() in (''admin'',''terapeuta''))
       with check (public.papel_atual() in (''admin'',''terapeuta''))', t);
  end loop;
  foreach t in array leitura_assistente loop
    execute format('drop policy if exists ressoa_le on public.%I', t);
    execute format(
      'create policy ressoa_le on public.%I for select to authenticated
       using (public.papel_atual() = ''assistente'')', t);
  end loop;
  foreach t in array so_admin loop
    execute format('drop policy if exists ressoa_admin on public.%I', t);
    execute format(
      'create policy ressoa_admin on public.%I for all to authenticated
       using (public.papel_atual() = ''admin'')
       with check (public.papel_atual() = ''admin'')', t);
  end loop;
end $$;

-- view de métricas (roda com direitos do dono; liberada a todo aprovado)
grant select on public.campanha_stats to authenticated;

-- ------------------ gates nas funções mutantes ------------------
-- disparar_campanha: painel só admin/terapeuta; cron (auth.uid() null) continua livre
create or replace function public.gate_operacao() returns void
language plpgsql stable as $$
begin
  if auth.uid() is not null
     and coalesce(public.papel_atual(), '') not in ('admin','terapeuta') then
    raise exception 'Seu papel não permite esta operação.';
  end if;
end $$;

-- injeta o gate no início das funções expostas por RPC
create or replace function public.disparar_campanha(p_campanha uuid) returns int
language plpgsql security definer as $$
declare
  v_camp record;
  v_lead uuid;
  v_def jsonb;
  v_qtd int := 0;
begin
  perform public.gate_operacao();
  select * into v_camp from public.campanhas where campanha_id = p_campanha;
  if not found or v_camp.status not in ('draft','scheduled') then
    return 0;
  end if;
  update public.campanhas set status = 'sending', started_at = now() where campanha_id = p_campanha;

  if v_camp.segmento_fk is not null then
    select definicao into v_def from public.segmentos where segmento_id = v_camp.segmento_fk;
    for v_lead in select * from public.leads_do_segmento(coalesce(v_def, '{}'::jsonb)) loop
      if public.enfileirar_email(v_lead, v_camp.mensagem_fk, p_campanha) is not null then
        v_qtd := v_qtd + 1;
      end if;
    end loop;
  else
    for v_lead in
      select distinct ll.lead_fk from public.lead_listas ll
      where ll.lista_fk = any(v_camp.lista_ids) and ll.status = 1
    loop
      if public.enfileirar_email(v_lead, v_camp.mensagem_fk, p_campanha) is not null then
        v_qtd := v_qtd + 1;
      end if;
    end loop;
  end if;
  return v_qtd;
end $$;

-- importar_leads também ganha gate (o corpo original segue igual; só o gate entra)
-- (recriada com o gate na frente)
create or replace function public.importar_leads(
  p_leads jsonb, p_lista int default null, p_tag int default null
) returns jsonb
language plpgsql security definer as $$
declare
  x jsonb;
  v_email text; v_nome text; v_cpf text; v_wa text;
  v_lead uuid;
  v_ins int := 0; v_upd int := 0; v_inv int := 0;
begin
  perform public.gate_operacao();
  for x in select * from jsonb_array_elements(p_leads) loop
    begin
      v_email := lower(trim(coalesce(x->>'email', '')));
      if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then v_email := null; end if;
      v_nome  := nullif(trim(coalesce(x->>'nome', '')), '');
      v_cpf   := nullif(regexp_replace(coalesce(x->>'cpf', ''), '\D', '', 'g'), '');
      v_wa    := public.normalizar_whatsapp(x->>'whatsapp');

      if v_email is null and v_wa is null then
        v_inv := v_inv + 1;
        continue;
      end if;

      v_lead := null;
      if v_wa is not null then
        select lead_id into v_lead from public.tabela_1_leads where whatsapp = v_wa;
      end if;
      if v_lead is null and v_email is not null then
        select lead_id into v_lead from public.tabela_1_leads where lower(email) = v_email limit 1;
      end if;

      if v_lead is null then
        insert into public.tabela_1_leads (email, nome, whatsapp, cpf)
        values (v_email, v_nome, v_wa, v_cpf)
        returning lead_id into v_lead;
        v_ins := v_ins + 1;
      else
        update public.tabela_1_leads
        set nome = coalesce(v_nome, nome),
            email = coalesce(email, v_email),
            whatsapp = coalesce(whatsapp, v_wa),
            cpf = coalesce(cpf, v_cpf)
        where lead_id = v_lead;
        v_upd := v_upd + 1;
      end if;

      if p_lista is not null then
        insert into public.lead_listas (lead_fk, lista_fk, status, source)
        values (v_lead, p_lista, 1, 'import_csv')
        on conflict (lead_fk, lista_fk) do nothing;
      end if;
      if p_tag is not null then
        insert into public.lead_tags (lead_fk, tag_fk)
        values (v_lead, p_tag)
        on conflict do nothing;
      end if;

    exception when others then
      v_inv := v_inv + 1;
    end;
  end loop;
  return jsonb_build_object('inseridos', v_ins, 'atualizados', v_upd, 'invalidos', v_inv);
end $$;

-- funções internas do motor: fora do alcance do painel
revoke execute on function public.processar_eventos_sistema() from public, anon, authenticated;
revoke execute on function public.executar_automacoes() from public, anon, authenticated;
revoke execute on function public.processar_fila_envios() from public, anon, authenticated;
revoke execute on function public.processar_campanhas() from public, anon, authenticated;

commit;
