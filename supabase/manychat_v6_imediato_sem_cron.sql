-- MANYCHAT IMEDIATO, EM QUALQUER AUTOMAÇÃO
--
-- Regra estrutural:
--   * manychat_tag precisa ser o primeiro passo;
--   * eventos comuns disparam esse passo no INSERT do evento;
--   * formulários chamam e aguardam a Edge Function diretamente;
--   * o processador agendado nunca cria uma execução no passo ManyChat;
--   * inclusões manuais também antecipam o primeiro passo antes do cron.
begin;

create or replace function public.automacao_gatilho_corresponde(
  p_gatilho jsonb, p_tipo text, p_payload jsonb)
returns boolean
language sql immutable set search_path = public as $$
  select exists (
    select 1
    from jsonb_array_elements(
      case jsonb_typeof(p_gatilho)
        when 'array' then p_gatilho
        when 'object' then jsonb_build_array(p_gatilho)
        else '[]'::jsonb
      end
    ) g
    where g->>'tipo' = p_tipo
      and case
        when p_tipo in ('lista_inscrita', 'lista_descadastrada') then
          coalesce((g->>'qualquer_lista')::boolean, false)
          or g->>'lista_id' is null
          or (g->>'lista_id')::int = (p_payload->>'lista_id')::int
        when p_tipo = 'tag_adicionada' then
          (g->>'tag_id')::int = (p_payload->>'tag_id')::int
        when p_tipo in ('email_aberto', 'email_clicado') then
          g->>'campanha_id' is null or g->>'campanha_id' = p_payload->>'campanha_id'
        when p_tipo = 'compra_realizada' then
          g->>'produto' is null
          or p_payload->>'produto' ilike '%' || (g->>'produto') || '%'
        else true
      end
  );
$$;

create or replace function public.automacao_manychat_imediata(p_automacao uuid)
returns boolean
language sql stable set search_path = public as $$
  select exists (
    select 1
    from public.automacao_passos p
    where p.automacao_fk = p_automacao
      and p.ordem = (
        select min(x.ordem) from public.automacao_passos x
        where x.automacao_fk = p_automacao
      )
      and p.tipo = 'manychat_tag'
      and coalesce(btrim(p.config->>'tag'), '') <> ''
  );
$$;

-- Qualquer inclusão manual de uma execução também pula o primeiro passo
-- somente depois de dispará-lo imediatamente.
create or replace function public.trg_manychat_execucao_imediata()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_passo record;
  v_proximo int;
begin
  select p.* into v_passo
  from public.automacao_passos p
  where p.automacao_fk = new.automacao_fk
    and p.ordem = new.passo_atual
    and p.tipo = 'manychat_tag';

  if not found then return new; end if;

  perform public.executar_passo_manychat(new.lead_fk, v_passo.config);
  select min(p.ordem) into v_proximo
  from public.automacao_passos p
  where p.automacao_fk = new.automacao_fk and p.ordem > v_passo.ordem;

  new.contexto := coalesce(new.contexto, '{}'::jsonb)
                  || jsonb_build_object('manychat_imediato', true);
  if v_proximo is null then
    new.passo_atual := v_passo.ordem + 1;
    new.status := 'concluida';
    new.finalizado_em := now();
  else
    new.passo_atual := v_proximo;
    new.status := 'em_andamento';
    new.agendado_para := now();
  end if;
  return new;
end $$;

drop trigger if exists trg_manychat_execucao_imediata on public.automacao_execucoes;
create trigger trg_manychat_execucao_imediata
before insert on public.automacao_execucoes
for each row execute function public.trg_manychat_execucao_imediata();

-- Eventos que não vieram da Edge Function de formulário são despachados
-- aqui. O formulário é excluído porque ele próprio espera a confirmação.
create or replace function public.trg_manychat_evento_imediato()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_marca record;
  v_auto record;
begin
  if new.lead_fk is null then return new; end if;
  if new.tipo = 'lista_inscrita'
     and coalesce(new.payload->>'source', '') like 'form:%' then
    return new;
  end if;

  -- Uma mesma tag pode estar em duas automações que respondem ao mesmo
  -- evento. Envia uma vez só, mas mantém uma execução para cada fluxo.
  for v_marca in
    select distinct on (p.config->>'tag') p.config
    from public.automacoes a
    join public.automacao_passos p
      on p.automacao_fk = a.automacao_id
     and p.ordem = (select min(x.ordem) from public.automacao_passos x
                    where x.automacao_fk = a.automacao_id)
    where a.ativa
      and p.tipo = 'manychat_tag'
      and coalesce(btrim(p.config->>'tag'), '') <> ''
      and public.automacao_gatilho_corresponde(a.gatilho, new.tipo, new.payload)
    order by p.config->>'tag', a.automacao_id
  loop
    perform public.executar_passo_manychat(new.lead_fk, v_marca.config);
  end loop;

  for v_auto in
    select a.automacao_id, p.ordem as passo_manychat,
           (select min(x.ordem) from public.automacao_passos x
            where x.automacao_fk = a.automacao_id and x.ordem > p.ordem) as proximo
    from public.automacoes a
    join public.automacao_passos p
      on p.automacao_fk = a.automacao_id
     and p.ordem = (select min(x.ordem) from public.automacao_passos x
                    where x.automacao_fk = a.automacao_id)
    where a.ativa and p.tipo = 'manychat_tag'
      and public.automacao_gatilho_corresponde(a.gatilho, new.tipo, new.payload)
  loop
    insert into public.automacao_execucoes (
      automacao_fk, lead_fk, passo_atual, status, agendado_para,
      finalizado_em, contexto)
    values (
      v_auto.automacao_id, new.lead_fk,
      coalesce(v_auto.proximo, v_auto.passo_manychat + 1),
      case when v_auto.proximo is null then 'concluida' else 'em_andamento' end,
      now(), case when v_auto.proximo is null then now() else null end,
      jsonb_build_object('manychat_imediato', true, 'evento_id', new.evento_id));
  end loop;

  return new;
end $$;

drop trigger if exists trg_manychat_evento_imediato on public.eventos_sistema;
create trigger trg_manychat_evento_imediato
after insert on public.eventos_sistema
for each row execute function public.trg_manychat_evento_imediato();

-- Execuções antigas que ainda estejam paradas exatamente no passo ManyChat
-- são disparadas agora e avançadas antes de retirar o ramo do cron.
do $$
declare
  v_exec record;
  v_proximo int;
begin
  for v_exec in
    select e.execucao_id, e.automacao_fk, e.lead_fk, e.passo_atual, p.config
    from public.automacao_execucoes e
    join public.automacao_passos p
      on p.automacao_fk = e.automacao_fk and p.ordem = e.passo_atual
    where e.status in ('em_andamento', 'aguardando', 'ativa')
      and p.tipo = 'manychat_tag'
  loop
    perform public.executar_passo_manychat(v_exec.lead_fk, v_exec.config);
    select min(ordem) into v_proximo from public.automacao_passos
    where automacao_fk = v_exec.automacao_fk and ordem > v_exec.passo_atual;
    update public.automacao_execucoes
    set passo_atual = coalesce(v_proximo, v_exec.passo_atual + 1),
        status = case when v_proximo is null then 'concluida' else 'em_andamento' end,
        agendado_para = now(),
        finalizado_em = case when v_proximo is null then now() else null end,
        contexto = coalesce(contexto, '{}'::jsonb) || '{"manychat_imediato":true}'::jsonb
    where execucao_id = v_exec.execucao_id;
  end loop;
end $$;

-- O processador continua cuidando de todos os eventos, exceto das automações
-- já criadas pelo trigger imediato.
do $$
declare
  v_oid oid;
  v_src text;
  v_novo text;
  v_def text;
begin
  select p.oid, p.prosrc, pg_get_functiondef(p.oid)
    into v_oid, v_src, v_def
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace
    and p.proname = 'processar_eventos_sistema' and p.pronargs = 0;

  if position('automacao_manychat_imediata' in v_src) = 0 then
    v_novo := replace(v_src,
      'where a.ativa' || E'\n' || '        and a.gatilho is not null',
      'where a.ativa' || E'\n' ||
      '        and not public.automacao_manychat_imediata(a.automacao_id)' || E'\n' ||
      '        and a.gatilho is not null');
    if v_novo = v_src then
      raise exception 'nao achei o seletor de automacoes no processador';
    end if;
    execute replace(v_def, v_src, v_novo);
  end if;
end $$;

-- O executor agendado fica fisicamente incapaz de enviar ao ManyChat.
do $$
declare
  v_oid oid;
  v_src text;
  v_novo text;
  v_def text;
  v_antigo constant text :=
    'elsif v_passo.tipo = ''manychat_tag'' then' || E'\n' ||
    '            perform public.executar_passo_manychat(v_exec.lead_fk, v_passo.config);';
  v_novo_ramo constant text :=
    'elsif v_passo.tipo = ''manychat_tag'' then' || E'\n' ||
    '            raise exception ''manychat_tag chegou ao cron; o passo deve ser imediato'';';
begin
  select p.oid, p.prosrc, pg_get_functiondef(p.oid)
    into v_oid, v_src, v_def
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace
    and p.proname = 'executar_automacoes' and p.pronargs = 0;

  if position(v_antigo in v_src) > 0 then
    v_novo := replace(v_src, v_antigo, v_novo_ramo);
    execute replace(v_def, v_src, v_novo);
  elsif position('manychat_tag chegou ao cron' in v_src) = 0 then
    raise exception 'nao achei o ramo ManyChat do executor';
  end if;
end $$;

commit;

-- Falha o release se qualquer uma das travas não estiver ativa.
do $$
declare
  v_executor text;
  v_processador text;
begin
  if to_regprocedure('public.automacao_manychat_imediata(uuid)') is null then
    raise exception 'falta classificador de automacao ManyChat imediata';
  end if;
  if not public.automacao_gatilho_corresponde(
    '[{"tipo":"tag_adicionada","tag_id":85},{"tipo":"lista_inscrita","lista_id":32}]'::jsonb,
    'lista_inscrita', '{"lista_id":32}'::jsonb) then
    raise exception 'gatilho multiplo nao foi reconhecido';
  end if;
  if not exists (select 1 from pg_trigger
                 where tgrelid = 'public.eventos_sistema'::regclass
                   and tgname = 'trg_manychat_evento_imediato' and not tgisinternal) then
    raise exception 'falta trigger de evento imediato';
  end if;
  if not exists (select 1 from pg_trigger
                 where tgrelid = 'public.automacao_execucoes'::regclass
                   and tgname = 'trg_manychat_execucao_imediata' and not tgisinternal) then
    raise exception 'falta trigger de execucao imediata';
  end if;
  select prosrc into v_executor from pg_proc
  where pronamespace = 'public'::regnamespace and proname = 'executar_automacoes' and pronargs = 0;
  select prosrc into v_processador from pg_proc
  where pronamespace = 'public'::regnamespace and proname = 'processar_eventos_sistema' and pronargs = 0;
  if position('perform public.executar_passo_manychat' in coalesce(v_executor, '')) > 0
     or position('automacao_manychat_imediata' in coalesce(v_processador, '')) = 0 then
    raise exception 'cron ainda participa do envio ao ManyChat';
  end if;
end $$;
