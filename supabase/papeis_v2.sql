-- =====================================================================
-- PAPÉIS v2 — Assistente PREPARA, mas NÃO DISPARA.
--   admin      → tudo
--   terapeuta  → opera + dispara campanha + liga/desliga automação
--   assistente → cria e edita leads/listas/tags/mensagens/campanhas (rascunho),
--                importa CSV — mas NÃO dispara e-mail, NÃO mexe em automação
--                e NÃO exporta a base.
-- =====================================================================
begin;

do $$
declare
  t text;
  -- assistente também escreve nestas (preparar a operação)
  preparaveis text[] := array[
    'tabela_1_leads','tabela_2_participacoes','tabela_3_precheckout','tabela_4_alunos',
    'listas','lead_listas','tags','lead_tags','lead_atributos',
    'mensagens','mensagem_links','campanhas','segmentos'];
  -- só admin/terapeuta escrevem (disparo e motor)
  so_operador text[] := array[
    'envios','eventos_email','supressao','automacoes','automacao_passos',
    'automacao_execucoes','eventos_sistema'];
begin
  foreach t in array preparaveis loop
    execute format('drop policy if exists ressoar_opera on public.%I', t);
    execute format('drop policy if exists ressoar_le on public.%I', t);
    execute format(
      'create policy ressoar_opera on public.%I for all to authenticated
       using (public.papel_atual() in (''admin'',''terapeuta'',''assistente''))
       with check (public.papel_atual() in (''admin'',''terapeuta'',''assistente''))', t);
  end loop;

  foreach t in array so_operador loop
    execute format('drop policy if exists ressoar_opera on public.%I', t);
    execute format('drop policy if exists ressoar_le on public.%I', t);
    execute format(
      'create policy ressoar_opera on public.%I for all to authenticated
       using (public.papel_atual() in (''admin'',''terapeuta''))
       with check (public.papel_atual() in (''admin'',''terapeuta''))', t);
    -- assistente ainda ENXERGA (acompanha os números), só não escreve
    execute format(
      'create policy ressoar_le on public.%I for select to authenticated
       using (public.papel_atual() = ''assistente'')', t);
  end loop;
end $$;

-- gate de importação: assistente PODE importar (prepara a base)
create or replace function public.gate_preparacao() returns void
language plpgsql stable as $$
begin
  if auth.uid() is not null
     and coalesce(public.papel_atual(), '') not in ('admin','terapeuta','assistente') then
    raise exception 'Seu papel não permite esta operação.';
  end if;
end $$;

-- importar_leads passa a usar o gate de preparação
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
  perform public.gate_preparacao();
  for x in select * from jsonb_array_elements(p_leads) loop
    begin
      v_email := lower(trim(coalesce(x->>'email', '')));
      if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then v_email := null; end if;
      v_nome  := nullif(trim(coalesce(x->>'nome', '')), '');
      v_cpf   := nullif(regexp_replace(coalesce(x->>'cpf', ''), '\D', '', 'g'), '');
      v_wa    := public.normalizar_whatsapp(x->>'whatsapp');
      if v_email is null and v_wa is null then v_inv := v_inv + 1; continue; end if;
      v_lead := null;
      if v_wa is not null then
        select lead_id into v_lead from public.tabela_1_leads where whatsapp = v_wa;
      end if;
      if v_lead is null and v_email is not null then
        select lead_id into v_lead from public.tabela_1_leads where lower(email) = v_email limit 1;
      end if;
      if v_lead is null then
        insert into public.tabela_1_leads (email, nome, whatsapp, cpf)
        values (v_email, v_nome, v_wa, v_cpf) returning lead_id into v_lead;
        v_ins := v_ins + 1;
      else
        update public.tabela_1_leads
        set nome = coalesce(v_nome, nome), email = coalesce(email, v_email),
            whatsapp = coalesce(whatsapp, v_wa), cpf = coalesce(cpf, v_cpf)
        where lead_id = v_lead;
        v_upd := v_upd + 1;
      end if;
      if p_lista is not null then
        insert into public.lead_listas (lead_fk, lista_fk, status, source)
        values (v_lead, p_lista, 1, 'import_csv') on conflict (lead_fk, lista_fk) do nothing;
      end if;
      if p_tag is not null then
        insert into public.lead_tags (lead_fk, tag_fk) values (v_lead, p_tag) on conflict do nothing;
      end if;
    exception when others then v_inv := v_inv + 1;
    end;
  end loop;
  return jsonb_build_object('inseridos', v_ins, 'atualizados', v_upd, 'invalidos', v_inv);
end $$;

-- disparar_campanha continua exigindo admin/terapeuta (gate_operacao) — inalterado
commit;
