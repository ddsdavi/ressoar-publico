-- =====================================================================
-- MOTOR v11 — gatilhos que faltavam e o passo "se / então".
--
-- Gatilhos novos: descadastrou-se, abriu o e-mail, clicou num link,
-- fez uma compra. Os três primeiros já eram registrados; o que faltava
-- era virar evento e casar com automação.
--
-- E o "se / então": até agora o motor só andava em linha reta. Agora o
-- passo de condição desvia o caminho — é isso que permite tratar quem
-- abriu diferente de quem não abriu.
-- =====================================================================
begin;

-- ------------------------------------------------------------------
-- 1. EVENTOS NOVOS
-- ------------------------------------------------------------------

-- descadastro: status 2 na lista
create or replace function public.trg_evento_descadastro() returns trigger
language plpgsql as $$
begin
  if new.status = 2 and coalesce(old.status, -1) <> 2 then
    insert into public.eventos_sistema (tipo, lead_fk, payload)
    values ('lista_descadastrada', new.lead_fk,
            jsonb_build_object('lista_id', new.lista_fk));
  end if;
  return new;
end $$;

drop trigger if exists trg_evento_descadastro on public.lead_listas;
create trigger trg_evento_descadastro
after update on public.lead_listas
for each row execute function public.trg_evento_descadastro();

-- abertura e clique vêm do rastreio
create or replace function public.trg_evento_email() returns trigger
language plpgsql as $$
declare v_camp uuid;
begin
  if new.tipo not in ('open', 'click') then
    return new;
  end if;
  select campanha_fk into v_camp from public.envios where envio_id = new.envio_fk;
  insert into public.eventos_sistema (tipo, lead_fk, payload)
  values (case new.tipo when 'open' then 'email_aberto' else 'email_clicado' end,
          new.lead_fk,
          jsonb_build_object('envio_id', new.envio_fk, 'campanha_id', v_camp, 'url', new.url));
  return new;
end $$;

drop trigger if exists trg_evento_email on public.eventos_email;
create trigger trg_evento_email
after insert on public.eventos_email
for each row execute function public.trg_evento_email();

-- compra
create or replace function public.trg_evento_compra() returns trigger
language plpgsql as $$
begin
  insert into public.eventos_sistema (tipo, lead_fk, payload)
  values ('compra_realizada', new.lead_fk,
          jsonb_build_object('produto', new.nome_produto, 'valor', new.valor,
                             'evento', new.evento_origem, 'transacao', new.codigo_transacao));
  return new;
end $$;

drop trigger if exists trg_evento_compra on public.tabela_4_alunos;
create trigger trg_evento_compra
after insert on public.tabela_4_alunos
for each row execute function public.trg_evento_compra();

-- ------------------------------------------------------------------
-- 2. CASAR OS EVENTOS NOVOS COM OS GATILHOS
-- ------------------------------------------------------------------
create or replace function public.processar_eventos_sistema() returns int
language plpgsql security definer as $$
declare
  v_evento record;
  v_auto record;
  v_hook record;
  v_qtd int := 0;
  v_webhooks boolean := coalesce(public.cfg('executar_webhooks'), 'false') = 'true';
begin
  for v_evento in
    select * from public.eventos_sistema
    where processado_em is null
    order by evento_id
    limit 200
    for update skip locked
  loop
    for v_auto in
      select a.automacao_id from public.automacoes a
      where a.ativa
        and a.gatilho is not null
        and a.gatilho->>'tipo' = v_evento.tipo
        and (
          -- lista: uma específica, ou qualquer uma
          (v_evento.tipo in ('lista_inscrita', 'lista_descadastrada') and (
             coalesce((a.gatilho->>'qualquer_lista')::boolean, false)
             or a.gatilho->>'lista_id' is null
             or (a.gatilho->>'lista_id')::int = (v_evento.payload->>'lista_id')::int))
          or
          (v_evento.tipo = 'tag_adicionada' and
             (a.gatilho->>'tag_id')::int = (v_evento.payload->>'tag_id')::int)
          or
          -- abertura e clique: de uma campanha específica, ou de qualquer uma
          (v_evento.tipo in ('email_aberto', 'email_clicado') and (
             a.gatilho->>'campanha_id' is null
             or a.gatilho->>'campanha_id' = v_evento.payload->>'campanha_id'))
          or
          -- compra: de um produto específico, ou qualquer compra
          (v_evento.tipo = 'compra_realizada' and (
             a.gatilho->>'produto' is null
             or v_evento.payload->>'produto' ilike '%' || (a.gatilho->>'produto') || '%'))
          or
          (v_evento.tipo not in ('lista_inscrita', 'lista_descadastrada', 'tag_adicionada',
                                 'email_aberto', 'email_clicado', 'compra_realizada'))
        )
    loop
      if not exists (select 1 from public.automacao_execucoes e
                     where e.automacao_fk = v_auto.automacao_id
                       and e.lead_fk = v_evento.lead_fk
                       and e.status in ('em_andamento', 'aguardando', 'ativa')) then
        insert into public.automacao_execucoes (automacao_fk, lead_fk, passo_atual, agendado_para)
        values (v_auto.automacao_id, v_evento.lead_fk, 1, now());
      end if;
    end loop;

    -- webhooks de saída: também respeitam a chave-geral
    if v_webhooks then
      for v_hook in
        select * from public.webhooks_saida w where w.ativo and v_evento.tipo = any(w.eventos)
      loop
        perform net.http_post(
          url := v_hook.url,
          body := jsonb_build_object(
            'evento', v_evento.tipo,
            'payload', v_evento.payload,
            'contato', case when v_evento.lead_fk is not null then public.payload_contato(v_evento.lead_fk) end,
            'ocorrido_em', v_evento.created_at),
          headers := jsonb_build_object('Content-Type', 'application/json',
                                        'X-Webhook-Secret', coalesce(v_hook.secret, '')));
      end loop;
    end if;

    update public.eventos_sistema set processado_em = now() where evento_id = v_evento.evento_id;
    v_qtd := v_qtd + 1;
  end loop;
  return v_qtd;
end $$;

-- ------------------------------------------------------------------
-- 3. A CONDIÇÃO
-- ------------------------------------------------------------------
create or replace function public.avaliar_condicao(p_lead uuid, p_cond jsonb)
returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  v_tipo text := p_cond->>'tipo';
  v_dias int := coalesce((p_cond->>'dias')::int, 30);
begin
  if v_tipo = 'tem_tag' then
    return exists (select 1 from public.lead_tags
                   where lead_fk = p_lead and tag_fk = (p_cond->>'tag_id')::int);

  elsif v_tipo = 'na_lista' then
    return exists (select 1 from public.lead_listas
                   where lead_fk = p_lead and lista_fk = (p_cond->>'lista_id')::int
                     and status = coalesce((p_cond->>'status')::int, 1));

  elsif v_tipo = 'abriu_email' then
    return exists (select 1 from public.eventos_email
                   where lead_fk = p_lead and tipo = 'open'
                     and occurred_at > now() - (v_dias || ' days')::interval);

  elsif v_tipo = 'clicou_email' then
    return exists (select 1 from public.eventos_email
                   where lead_fk = p_lead and tipo = 'click'
                     and occurred_at > now() - (v_dias || ' days')::interval);

  elsif v_tipo = 'comprou' then
    return exists (select 1 from public.tabela_4_alunos
                   where lead_fk = p_lead
                     and (p_cond->>'produto' is null
                          or nome_produto ilike '%' || (p_cond->>'produto') || '%'));

  elsif v_tipo = 'tem_whatsapp' then
    return exists (select 1 from public.tabela_1_leads
                   where lead_id = p_lead and coalesce(whatsapp, '') <> '');

  elsif v_tipo = 'campo_igual' then
    return exists (select 1 from public.lead_atributos
                   where lead_fk = p_lead
                     and dados ->> (p_cond->>'chave') = (p_cond->>'valor'));

  elsif v_tipo = 'nao_suprimido' then
    return not exists (select 1 from public.supressao s
                       join public.tabela_1_leads l on l.email = s.email
                       where l.lead_id = p_lead);
  end if;

  -- condição desconhecida não deve travar o fluxo nem inventar caminho:
  -- segue como verdadeira, que é o caminho principal
  return true;
end $$;

grant execute on function public.avaliar_condicao(uuid, jsonb) to authenticated;

-- ------------------------------------------------------------------
-- 4. O EXECUTOR ENTENDE O DESVIO
-- ------------------------------------------------------------------
create or replace function public.executar_automacoes() returns int
language plpgsql security definer as $$
declare
  v_exec record;
  v_passo record;
  v_msg uuid;
  v_qtd int := 0;
  v_ok boolean;
  v_destino int;
  v_webhooks boolean := coalesce(public.cfg('executar_webhooks'), 'false') = 'true';
begin
  for v_exec in
    select * from public.automacao_execucoes
    where status in ('em_andamento', 'aguardando', 'ativa')
      and coalesce(agendado_para, now()) <= now()
    order by iniciado_em
    limit 200
    for update skip locked
  loop
    select * into v_passo from public.automacao_passos
    where automacao_fk = v_exec.automacao_fk and ordem = v_exec.passo_atual;

    if not found then
      update public.automacao_execucoes
      set status = 'concluida', finalizado_em = now()
      where execucao_id = v_exec.execucao_id;
      continue;
    end if;

    begin
      if v_passo.tipo = 'esperar' then
        update public.automacao_execucoes
        set agendado_para = now() + (v_passo.config->>'duracao')::interval,
            passo_atual = passo_atual + 1
        where execucao_id = v_exec.execucao_id;
        v_qtd := v_qtd + 1;
        continue;

      elsif v_passo.tipo = 'condicao' then
        v_ok := public.avaliar_condicao(v_exec.lead_fk, v_passo.config->'condicao');
        -- destino nulo = segue para o passo seguinte
        v_destino := nullif(v_passo.config->>(case when v_ok then 'ir_se_verdadeiro' else 'ir_se_falso' end), '')::int;
        if v_destino is null then
          v_destino := v_exec.passo_atual + 1;
        end if;
        -- destino 0 = encerra a automação por aqui
        if v_destino = 0 then
          update public.automacao_execucoes
          set status = 'concluida', finalizado_em = now()
          where execucao_id = v_exec.execucao_id;
        else
          update public.automacao_execucoes
          set passo_atual = v_destino, agendado_para = now()
          where execucao_id = v_exec.execucao_id;
        end if;
        v_qtd := v_qtd + 1;
        continue;

      elsif v_passo.tipo = 'enviar_email' then
        v_msg := nullif(v_passo.config->>'mensagem_id', '')::uuid;
        if v_msg is not null then
          perform public.enfileirar_email(v_exec.lead_fk, v_msg,
                    null, v_exec.automacao_fk, v_passo.passo_id);
        end if;

      elsif v_passo.tipo in ('webhook', 'google_sheets', 'google_drive') then
        if v_webhooks
           and v_passo.config ? 'url'
           and (v_passo.config->>'url') not like '%(TRUNCADO)%' then
          perform net.http_post(
            url := v_passo.config->>'url',
            body := jsonb_build_object(
              'origem', 'ressoar', 'passo', v_passo.tipo,
              'automacao', v_exec.automacao_fk,
              'contato', public.payload_contato(v_exec.lead_fk)),
            headers := jsonb_build_object('Content-Type', 'application/json'));
        end if;

      elsif v_passo.tipo = 'aplicar_tag' then
        insert into public.lead_tags (lead_fk, tag_fk)
        values (v_exec.lead_fk, (v_passo.config->>'tag_id')::int)
        on conflict do nothing;

      elsif v_passo.tipo = 'remover_tag' then
        delete from public.lead_tags
        where lead_fk = v_exec.lead_fk and tag_fk = (v_passo.config->>'tag_id')::int;

      elsif v_passo.tipo = 'inscrever_lista' then
        insert into public.lead_listas (lead_fk, lista_fk, status, source)
        values (v_exec.lead_fk, (v_passo.config->>'lista_id')::int, 1, 'automation')
        on conflict (lead_fk, lista_fk) do update set status = 1, updated_at = now();

      elsif v_passo.tipo = 'desinscrever_lista' then
        update public.lead_listas set status = 2, updated_at = now()
        where lead_fk = v_exec.lead_fk and lista_fk = (v_passo.config->>'lista_id')::int;
      end if;

      update public.automacao_execucoes
      set passo_atual = passo_atual + 1, agendado_para = now()
      where execucao_id = v_exec.execucao_id;
      v_qtd := v_qtd + 1;

    exception when others then
      update public.automacao_execucoes
      set status = 'erro', erro = sqlerrm, finalizado_em = now()
      where execucao_id = v_exec.execucao_id;
    end;
  end loop;
  return v_qtd;
end $$;

commit;

select (select count(*) from pg_trigger
        where tgname in ('trg_evento_descadastro','trg_evento_email','trg_evento_compra')) as gatilhos_novos,
       (select position('condicao' in prosrc) > 0 from pg_proc where proname='executar_automacoes') as entende_se_entao,
       (select position('email_aberto' in prosrc) > 0 from pg_proc where proname='processar_eventos_sistema') as casa_abertura;
