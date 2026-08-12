-- =====================================================================
-- MOTOR v1 da Ressoar — roda inteiro dentro do Postgres.
-- Eventos (outbox) -> automações -> passos (email/webhook/tag/lista/espera)
-- Fila de envios com provedor abstraído: 'simulado' agora, 'resend' depois.
-- =====================================================================

begin;

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ------------------ configuração ------------------
create table if not exists public.app_config (
  chave      text primary key,
  valor      text,
  updated_at timestamptz not null default now()
);
alter table public.app_config enable row level security;

insert into public.app_config (chave, valor) values
  ('provedor_email', 'simulado'),
  ('resend_api_key', ''),
  ('from_email_padrao', 'contato@seudominio.com.br'),
  ('from_name_padrao', 'Nome do Remetente'),
  ('base_url_tracking', '')
on conflict (chave) do nothing;

create or replace function public.cfg(p_chave text) returns text
language sql stable as $$
  select valor from public.app_config where chave = p_chave
$$;

-- ------------------ triggers -> outbox ------------------
create or replace function public.fn_evento_lead_lista() returns trigger
language plpgsql security definer as $$
begin
  if tg_op = 'INSERT' then
    insert into public.eventos_sistema (tipo, lead_fk, payload)
    values ('lista_inscrita', new.lead_fk,
            jsonb_build_object('lista_id', new.lista_fk, 'status', new.status, 'source', new.source));
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
    insert into public.eventos_sistema (tipo, lead_fk, payload)
    values ('lista_status_alterado', new.lead_fk,
            jsonb_build_object('lista_id', new.lista_fk, 'de', old.status, 'para', new.status));
  end if;
  return new;
end $$;

drop trigger if exists trg_evento_lead_lista on public.lead_listas;
create trigger trg_evento_lead_lista
  after insert or update on public.lead_listas
  for each row execute function public.fn_evento_lead_lista();

create or replace function public.fn_evento_lead_tag() returns trigger
language plpgsql security definer as $$
begin
  insert into public.eventos_sistema (tipo, lead_fk, payload)
  values ('tag_adicionada', new.lead_fk, jsonb_build_object('tag_id', new.tag_fk));
  return new;
end $$;

drop trigger if exists trg_evento_lead_tag on public.lead_tags;
create trigger trg_evento_lead_tag
  after insert on public.lead_tags
  for each row execute function public.fn_evento_lead_tag();

create or replace function public.fn_evento_lead_novo() returns trigger
language plpgsql security definer as $$
begin
  insert into public.eventos_sistema (tipo, lead_fk, payload)
  values ('lead_criado', new.lead_id, jsonb_build_object('email', new.email));
  return new;
end $$;

drop trigger if exists trg_evento_lead_novo on public.tabela_1_leads;
create trigger trg_evento_lead_novo
  after insert on public.tabela_1_leads
  for each row execute function public.fn_evento_lead_novo();

-- ------------------ payload de contato (estilo AC, p/ webhooks) ------------------
create or replace function public.payload_contato(p_lead uuid) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'lead_id', l.lead_id,
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

-- ------------------ processar outbox: casar gatilhos + webhooks de saída ------------------
create or replace function public.processar_eventos_sistema() returns int
language plpgsql security definer as $$
declare
  v_evento record;
  v_auto record;
  v_hook record;
  v_qtd int := 0;
begin
  for v_evento in
    select * from public.eventos_sistema
    where processado_em is null
    order by evento_id
    limit 200
    for update skip locked
  loop
    -- automações cujo gatilho casa com o evento
    for v_auto in
      select a.automacao_id from public.automacoes a
      where a.ativa
        and a.gatilho is not null
        and a.gatilho->>'tipo' = v_evento.tipo
        and (
          (v_evento.tipo = 'lista_inscrita' and (
             coalesce((a.gatilho->>'qualquer_lista')::boolean, false)
             or (a.gatilho->>'lista_id')::int = (v_evento.payload->>'lista_id')::int))
          or
          (v_evento.tipo = 'tag_adicionada' and
             (a.gatilho->>'tag_id')::int = (v_evento.payload->>'tag_id')::int)
          or
          (v_evento.tipo not in ('lista_inscrita','tag_adicionada'))
        )
    loop
      -- não reentra a mesma automação pro mesmo lead se já há execução aberta
      if not exists (select 1 from public.automacao_execucoes e
                     where e.automacao_fk = v_auto.automacao_id
                       and e.lead_fk = v_evento.lead_fk
                       and e.status in ('em_andamento','aguardando')) then
        insert into public.automacao_execucoes (automacao_fk, lead_fk, agendado_para)
        values (v_auto.automacao_id, v_evento.lead_fk, now());
      end if;
    end loop;

    -- webhooks de saída assinantes do tipo
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
                                      'X-Webhook-Secret', coalesce(v_hook.secret, ''))
      );
    end loop;

    update public.eventos_sistema set processado_em = now() where evento_id = v_evento.evento_id;
    v_qtd := v_qtd + 1;
  end loop;
  return v_qtd;
end $$;

-- ------------------ enfileirar e-mail com todas as travas ------------------
create or replace function public.enfileirar_email(
  p_lead uuid, p_mensagem uuid, p_campanha uuid default null,
  p_automacao uuid default null, p_passo uuid default null
) returns uuid
language plpgsql security definer as $$
declare
  v_email citext;
  v_envio uuid;
begin
  select email into v_email from public.tabela_1_leads where lead_id = p_lead;
  if v_email is null then
    return null;                                   -- lead sem e-mail
  end if;
  if exists (select 1 from public.supressao s where s.email = v_email) then
    insert into public.envios (lead_fk, mensagem_fk, campanha_fk, automacao_fk, passo_fk, status)
    values (p_lead, p_mensagem, p_campanha, p_automacao, p_passo, 'suppressed')
    on conflict do nothing;
    return null;                                   -- suprimido: registra e não envia
  end if;
  insert into public.envios (lead_fk, mensagem_fk, campanha_fk, automacao_fk, passo_fk)
  values (p_lead, p_mensagem, p_campanha, p_automacao, p_passo)
  on conflict do nothing
  returning envio_id into v_envio;
  return v_envio;
end $$;

-- ------------------ executor de automações ------------------
create or replace function public.executar_automacoes() returns int
language plpgsql security definer as $$
declare
  v_exec record;
  v_passo record;
  v_msg uuid;
  v_qtd int := 0;
  v_continua boolean;
begin
  for v_exec in
    select e.* from public.automacao_execucoes e
    where e.status in ('em_andamento','aguardando')
      and coalesce(e.agendado_para, now()) <= now()
    order by e.iniciado_em
    limit 200
    for update skip locked
  loop
    v_continua := true;
    while v_continua loop
      select * into v_passo
      from public.automacao_passos p
      where p.automacao_fk = v_exec.automacao_fk and p.ordem = v_exec.passo_atual + 1;

      if not found then
        update public.automacao_execucoes
        set status = 'concluida', finalizado_em = now(), passo_atual = v_exec.passo_atual
        where execucao_id = v_exec.execucao_id;
        v_continua := false;

      else
        begin
          if v_passo.tipo = 'enviar_email' then
            -- resolve a mensagem: por uuid explícito ou por nome/assunto aproximado
            v_msg := null;
            if v_passo.config ? 'mensagem_id' then
              v_msg := (v_passo.config->>'mensagem_id')::uuid;
            else
              select mensagem_id into v_msg from public.mensagens
              where nome ilike '%' || (v_passo.config->>'mensagem') || '%'
                 or subject ilike '%' || coalesce(v_passo.config->>'assunto', v_passo.config->>'mensagem') || '%'
              order by created_at desc limit 1;
            end if;
            if v_msg is not null then
              perform public.enfileirar_email(v_exec.lead_fk, v_msg,
                        null, v_exec.automacao_fk, v_passo.passo_id);
            end if;

          elsif v_passo.tipo in ('webhook', 'google_sheets') then
            if v_passo.config ? 'url' and (v_passo.config->>'url') not like '%(TRUNCADO)%' then
              perform net.http_post(
                url := v_passo.config->>'url',
                body := jsonb_build_object(
                  'origem', 'active-proprio',
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

          elsif v_passo.tipo = 'esperar' then
            update public.automacao_execucoes
            set passo_atual = v_passo.ordem, status = 'aguardando',
                agendado_para = now() + (coalesce(v_passo.config->>'duracao','1 hour'))::interval
            where execucao_id = v_exec.execucao_id;
            v_continua := false;
            continue;
          end if;

          -- avança o ponteiro (exceto 'esperar', que já saiu do loop)
          update public.automacao_execucoes
          set passo_atual = v_passo.ordem
          where execucao_id = v_exec.execucao_id;
          v_exec.passo_atual := v_passo.ordem;

        exception when others then
          update public.automacao_execucoes
          set status = 'erro', erro = sqlerrm, finalizado_em = now()
          where execucao_id = v_exec.execucao_id;
          v_continua := false;
        end;
      end if;
    end loop;
    v_qtd := v_qtd + 1;
  end loop;
  return v_qtd;
end $$;

-- ------------------ personalização simples ------------------
create or replace function public.personalizar(p_texto text, p_lead uuid) returns text
language sql stable as $$
  select replace(replace(replace(coalesce(p_texto,''),
           '{{nome}}', coalesce(split_part(l.nome, ' ', 1), '')),
           '{{nome_completo}}', coalesce(l.nome, '')),
           '{{email}}', coalesce(l.email, ''))
  from public.tabela_1_leads l where l.lead_id = p_lead
$$;

-- ------------------ fila de envios ------------------
create or replace function public.processar_fila_envios() returns int
language plpgsql security definer as $$
declare
  v_envio record;
  v_msg record;
  v_provedor text := coalesce(public.cfg('provedor_email'), 'simulado');
  v_key text := public.cfg('resend_api_key');
  v_req bigint;
  v_qtd int := 0;
begin
  for v_envio in
    select e.*, l.email as para_email, l.nome as para_nome
    from public.envios e
    join public.tabela_1_leads l on l.lead_id = e.lead_fk
    where e.status = 'queued'
    order by e.queued_at
    limit 100
    for update of e skip locked
  loop
    select * into v_msg from public.mensagens where mensagem_id = v_envio.mensagem_fk;

    -- trava dura de supressão (pode ter entrado depois do enfileiramento)
    if exists (select 1 from public.supressao s where s.email = v_envio.para_email) then
      update public.envios set status = 'suppressed' where envio_id = v_envio.envio_id;
      continue;
    end if;

    if v_provedor = 'resend' and coalesce(v_key,'') <> '' then
      v_req := net.http_post(
        url := 'https://api.resend.com/emails',
        body := jsonb_build_object(
          'from', coalesce(nullif(v_msg.from_name,''), public.cfg('from_name_padrao'))
                  || ' <' || coalesce(nullif(v_msg.from_email,''), public.cfg('from_email_padrao')) || '>',
          'to', jsonb_build_array(v_envio.para_email),
          'subject', public.personalizar(v_msg.subject, v_envio.lead_fk),
          'html', public.personalizar(v_msg.html, v_envio.lead_fk),
          'reply_to', v_msg.reply_to),
        headers := jsonb_build_object('Authorization', 'Bearer ' || v_key,
                                      'Content-Type', 'application/json'));
      update public.envios
      set status = 'sent', sent_at = now(), provider = 'resend', provider_message_id = 'pgnet:' || v_req
      where envio_id = v_envio.envio_id;
      insert into public.eventos_email (envio_fk, lead_fk, tipo, occurred_at, payload)
      values (v_envio.envio_id, v_envio.lead_fk, 'sent', now(), jsonb_build_object('req', v_req));

    else  -- modo simulado: marca como enviado sem sair um e-mail real
      update public.envios
      set status = 'sent', sent_at = now(), provider = 'simulado'
      where envio_id = v_envio.envio_id;
      insert into public.eventos_email (envio_fk, lead_fk, tipo, occurred_at, payload)
      values (v_envio.envio_id, v_envio.lead_fk, 'sent', now(), '{"simulado": true}'::jsonb);
    end if;
    v_qtd := v_qtd + 1;
  end loop;
  return v_qtd;
end $$;

-- ------------------ campanhas ------------------
create or replace function public.disparar_campanha(p_campanha uuid) returns int
language plpgsql security definer as $$
declare
  v_camp record;
  v_lead record;
  v_qtd int := 0;
begin
  select * into v_camp from public.campanhas where campanha_id = p_campanha;
  if not found or v_camp.status not in ('draft','scheduled') then
    return 0;
  end if;
  update public.campanhas set status = 'sending', started_at = now() where campanha_id = p_campanha;

  for v_lead in
    select distinct ll.lead_fk
    from public.lead_listas ll
    where ll.lista_fk = any(v_camp.lista_ids) and ll.status = 1
  loop
    if public.enfileirar_email(v_lead.lead_fk, v_camp.mensagem_fk, p_campanha) is not null then
      v_qtd := v_qtd + 1;
    end if;
  end loop;
  return v_qtd;
end $$;

create or replace function public.processar_campanhas() returns int
language plpgsql security definer as $$
declare
  v_camp record;
  v_qtd int := 0;
begin
  -- dispara agendadas
  for v_camp in
    select campanha_id from public.campanhas
    where status = 'scheduled' and scheduled_at <= now()
  loop
    perform public.disparar_campanha(v_camp.campanha_id);
    v_qtd := v_qtd + 1;
  end loop;
  -- finaliza as que drenaram a fila
  update public.campanhas c
  set status = 'sent', finished_at = now()
  where c.status = 'sending'
    and not exists (select 1 from public.envios e
                    where e.campanha_fk = c.campanha_id and e.status = 'queued');
  return v_qtd;
end $$;

-- ------------------ métricas ------------------
create or replace view public.campanha_stats as
select c.campanha_id, c.nome, c.status,
       count(e.envio_id)                                              as enviados,
       count(e.envio_id) filter (where e.status = 'suppressed')       as suprimidos,
       count(distinct ev.lead_fk) filter (where ev.tipo = 'open')     as aberturas_unicas,
       count(distinct ev.lead_fk) filter (where ev.tipo = 'click')    as cliques_unicos,
       count(ev.evento_id) filter (where ev.tipo = 'bounce_hard')     as hard_bounces,
       count(ev.evento_id) filter (where ev.tipo = 'complaint')       as complaints,
       count(ev.evento_id) filter (where ev.tipo = 'unsubscribe')     as descadastros
from public.campanhas c
left join public.envios e on e.campanha_fk = c.campanha_id
left join public.eventos_email ev on ev.envio_fk = e.envio_id
group by c.campanha_id, c.nome, c.status;

-- ------------------ agendamento (a cada minuto) ------------------
select cron.schedule('ressoa-processar-eventos',   '* * * * *', $$select public.processar_eventos_sistema()$$);
select cron.schedule('ressoa-executar-automacoes', '* * * * *', $$select public.executar_automacoes()$$);
select cron.schedule('ressoa-fila-envios',         '* * * * *', $$select public.processar_fila_envios()$$);
select cron.schedule('ressoa-campanhas',           '* * * * *', $$select public.processar_campanhas()$$);

commit;
