-- =====================================================================
-- CONTEXTO DO EVENTO + RSS
--
-- O problema: uma automação disparada por "carrinho abandonado" sabia
-- QUEM abandonou, mas não O QUÊ. O e-mail só podia dizer "você deixou
-- algo para trás" — quando o que converte é "você deixou o Desafio Casa
-- Harmonizada para trás". O evento trazia o produto no payload e a
-- gente jogava fora ao criar a execução.
--
-- A correção é levar o payload do evento junto: da execução até o
-- envio, para o texto poder citar %EVENTO.produto%. O mesmo encanamento
-- serve para o RSS — o post novo vira evento e o e-mail cita
-- %EVENTO.titulo%.
-- =====================================================================
begin;

-- ------------------------------------------------------------------
-- 1. o contexto viaja com a execução e com o envio
-- ------------------------------------------------------------------
alter table public.automacao_execucoes add column if not exists contexto jsonb;
alter table public.envios add column if not exists contexto jsonb;

-- ------------------------------------------------------------------
-- 2. quem cria a execução agora guarda o payload do evento
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
          (v_evento.tipo in ('lista_inscrita', 'lista_descadastrada') and (
             coalesce((a.gatilho->>'qualquer_lista')::boolean, false)
             or a.gatilho->>'lista_id' is null
             or (a.gatilho->>'lista_id')::int = (v_evento.payload->>'lista_id')::int))
          or
          (v_evento.tipo = 'tag_adicionada' and
             (a.gatilho->>'tag_id')::int = (v_evento.payload->>'tag_id')::int)
          or
          (v_evento.tipo in ('email_aberto', 'email_clicado') and (
             a.gatilho->>'campanha_id' is null
             or a.gatilho->>'campanha_id' = v_evento.payload->>'campanha_id'))
          or
          -- compra e as intenções: filtro opcional por produto
          (v_evento.tipo in ('compra_realizada', 'carrinho_abandonado', 'boleto_gerado',
                             'pagamento_atrasado', 'pagamento_expirou') and (
             a.gatilho->>'produto' is null
             or v_evento.payload->>'produto' ilike '%' || (a.gatilho->>'produto') || '%'))
          or
          -- post novo: filtro opcional por fonte
          (v_evento.tipo = 'rss_novo_item' and (
             a.gatilho->>'fonte_id' is null
             or (a.gatilho->>'fonte_id')::int = (v_evento.payload->>'fonte_id')::int))
          or
          (v_evento.tipo not in ('lista_inscrita', 'lista_descadastrada', 'tag_adicionada',
                                 'email_aberto', 'email_clicado', 'compra_realizada',
                                 'carrinho_abandonado', 'boleto_gerado',
                                 'pagamento_atrasado', 'pagamento_expirou', 'rss_novo_item'))
        )
    loop
      if not exists (select 1 from public.automacao_execucoes e
                     where e.automacao_fk = v_auto.automacao_id
                       and e.lead_fk = v_evento.lead_fk
                       and e.status in ('em_andamento', 'aguardando', 'ativa')) then
        insert into public.automacao_execucoes
          (automacao_fk, lead_fk, passo_atual, agendado_para, contexto)
        values (v_auto.automacao_id, v_evento.lead_fk, 1, now(), v_evento.payload);
      end if;
    end loop;

    if v_webhooks then
      for v_hook in
        select * from public.webhooks_saida w where w.ativo and v_evento.tipo = any(w.eventos)
      loop
        perform net.http_post(
          url := v_hook.url,
          body := jsonb_build_object(
            'evento', v_evento.tipo, 'payload', v_evento.payload,
            'contato', case when v_evento.lead_fk is not null
                            then public.payload_contato(v_evento.lead_fk) end,
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
-- 3. personalizar passa a entender %EVENTO.chave%
-- ------------------------------------------------------------------
-- Assinatura nova, com o contexto no fim. A antiga continua existindo e
-- passa a ser um atalho para esta — assim nada que já chamava quebra.
create or replace function public.personalizar(p_texto text, p_lead uuid, p_contexto jsonb)
returns text
language plpgsql stable as $$
declare
  v_texto text := coalesce(p_texto, '');
  v_lead record;
  v_dados jsonb;
  v_c record;
  v_k record;
begin
  if v_texto = '' then
    return v_texto;
  end if;

  -- ---- o que vem do evento que disparou (produto, título do post…) ----
  -- Vem primeiro porque é o mais específico. Chave ausente vira texto
  -- vazio, nunca a variável crua vazando para o assinante.
  if p_contexto is not null then
    for v_k in select key, value from jsonb_each_text(p_contexto) loop
      v_texto := replace(v_texto, '%EVENTO.' || upper(v_k.key) || '%', coalesce(v_k.value, ''));
      v_texto := replace(v_texto, '%EVENTO.' || v_k.key || '%', coalesce(v_k.value, ''));
      v_texto := replace(v_texto, '{{evento.' || v_k.key || '}}', coalesce(v_k.value, ''));
    end loop;
  end if;
  -- sobrou alguma? some com ela antes de virar constrangimento
  v_texto := regexp_replace(v_texto, '%EVENTO\.[A-Za-z0-9_]+%', '', 'g');
  v_texto := regexp_replace(v_texto, '\{\{evento\.[A-Za-z0-9_]+\}\}', '', 'g');

  if p_lead is null then
    return v_texto;
  end if;

  select * into v_lead from public.tabela_1_leads where lead_id = p_lead;
  if not found then
    return v_texto;
  end if;

  v_texto := replace(v_texto, '{{nome}}', coalesce(split_part(v_lead.nome, ' ', 1), ''));
  v_texto := replace(v_texto, '{{nome_completo}}', coalesce(v_lead.nome, ''));
  v_texto := replace(v_texto, '{{email}}', coalesce(v_lead.email, ''));
  v_texto := replace(v_texto, '{{whatsapp}}', coalesce(v_lead.whatsapp, ''));
  v_texto := replace(v_texto, '%FIRSTNAME%', coalesce(split_part(v_lead.nome, ' ', 1), ''));
  v_texto := replace(v_texto, '%FULLNAME%', coalesce(v_lead.nome, ''));
  v_texto := replace(v_texto, '%LASTNAME%',
    coalesce(nullif(regexp_replace(coalesce(v_lead.nome, ''), '^\S+\s*', ''), ''), ''));
  v_texto := replace(v_texto, '%EMAIL%', coalesce(v_lead.email, ''));
  v_texto := replace(v_texto, '%PHONE%', coalesce(v_lead.whatsapp, ''));

  select dados into v_dados from public.lead_atributos where lead_fk = p_lead;
  v_dados := coalesce(v_dados, '{}'::jsonb);

  for v_c in select chave, perstag from public.campos_personalizados loop
    v_texto := replace(v_texto, '{{campo.' || v_c.chave || '}}',
                       coalesce(v_dados ->> v_c.chave, ''));
    if coalesce(v_c.perstag, '') <> '' then
      v_texto := replace(v_texto, '%' || v_c.perstag || '%',
                         coalesce(v_dados ->> v_c.chave, ''));
    end if;
  end loop;

  return v_texto;
end $$;

create or replace function public.personalizar(p_texto text, p_lead uuid) returns text
language sql stable as $$
  select public.personalizar(p_texto, p_lead, null::jsonb);
$$;

-- ------------------------------------------------------------------
-- 4. o envio guarda o contexto, e o HTML final o utiliza
-- ------------------------------------------------------------------
-- Um parâmetro novo com DEFAULT criaria duas funções de mesmo nome e a
-- chamada de 5 argumentos ficaria ambígua. Por isso derruba a antiga.
drop function if exists public.enfileirar_email(uuid, uuid, uuid, uuid, uuid);

create or replace function public.enfileirar_email(
  p_lead uuid, p_mensagem uuid, p_campanha uuid default null,
  p_automacao uuid default null, p_passo uuid default null,
  p_contexto jsonb default null)
returns uuid
language plpgsql security definer as $$
declare
  v_email citext;
  v_envio uuid;
begin
  select email into v_email from public.tabela_1_leads where lead_id = p_lead;
  if v_email is null then
    return null;
  end if;
  if exists (select 1 from public.supressao s where s.email = v_email) then
    insert into public.envios (lead_fk, mensagem_fk, campanha_fk, automacao_fk, passo_fk, status)
    values (p_lead, p_mensagem, p_campanha, p_automacao, p_passo, 'suppressed')
    on conflict do nothing;
    return null;
  end if;
  insert into public.envios
    (lead_fk, mensagem_fk, campanha_fk, automacao_fk, passo_fk, contexto)
  values (p_lead, p_mensagem, p_campanha, p_automacao, p_passo, p_contexto)
  on conflict do nothing
  returning envio_id into v_envio;
  return v_envio;
end $$;

create or replace function public.montar_html_envio(p_html text, p_envio uuid, p_lead uuid)
returns text
language plpgsql stable as $$
declare
  v_base text := public.cfg('base_url_tracking');
  v_ctx jsonb;
  v_html text;
  v_end  text := public.cfg('endereco_fisico');
  v_pre text;
  v_rodape text;
  v_m text[];
  v_url text;
  v_novo text;
begin
  select contexto into v_ctx from public.envios where envio_id = p_envio;
  v_html := public.personalizar(p_html, p_lead, v_ctx);

  if coalesce(v_base, '') = '' then
    return v_html;
  end if;

  -- ---- 1. rastreio de clique -------------------------------------------
  for v_m in select regexp_matches(v_html, 'href="(https?://[^"]*)"', 'g') loop
    v_url := v_m[1];
    if position(v_base in v_url) = 0 then
      v_novo := v_base || '/rastreio?t=c&amp;e=' || p_envio || '&amp;u=' ||
                translate(encode(convert_to(v_url, 'UTF8'), 'base64'),
                          '+/=' || chr(10) || chr(13), '-_');
      v_html := replace(v_html, 'href="' || v_url || '"', 'href="' || v_novo || '"');
    end if;
  end loop;

  -- ---- 2. texto de prévia ----------------------------------------------
  select public.personalizar(m.preheader, p_lead, v_ctx) into v_pre
  from public.envios e
  join public.mensagens m on m.mensagem_id = e.mensagem_fk
  where e.envio_id = p_envio;

  if coalesce(v_pre, '') <> '' then
    v_pre := '<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">' ||
             v_pre ||
             '</div><div style="display:none;max-height:0;overflow:hidden;mso-hide:all">' ||
             repeat('&#847;&zwnj;&nbsp;', 40) || '</div>';
    if position('<body' in lower(v_html)) > 0 then
      v_html := regexp_replace(v_html, '(<body[^>]*>)', '\1' || v_pre, 'i');
    else
      v_html := v_pre || v_html;
    end if;
  end if;

  -- ---- 3. rodapé obrigatório + pixel de abertura ------------------------
  v_rodape :=
    '<div style="text-align:center;font-size:12px;color:#8a8a8a;padding:24px 12px;font-family:sans-serif">' ||
    case when coalesce(v_end, '') <> '' then v_end || ' &middot; ' else '' end ||
    '<a href="' || v_base || '/descadastro?e=' || p_envio ||
    '" style="color:#8a8a8a">Não quero mais receber estes e-mails</a></div>' ||
    '<img src="' || v_base || '/rastreio?t=o&e=' || p_envio ||
    '" width="1" height="1" alt="" style="display:none">';

  if position('</body>' in lower(v_html)) > 0 then
    return regexp_replace(v_html, '</body>', v_rodape || '</body>', 'i');
  end if;
  return v_html || v_rodape;
end $$;

-- ------------------------------------------------------------------
-- 5. o passo de e-mail repassa o contexto da execução
-- ------------------------------------------------------------------
create or replace function public.executar_automacoes() returns int
language plpgsql security definer as $$
declare
  v_exec record;
  v_passo record;
  v_qtd int := 0;
  v_msg uuid;
  v_ok boolean;
  v_destino int;
  v_webhooks boolean := coalesce(public.cfg('executar_webhooks'), 'false') = 'true';
begin
  for v_exec in
    select * from public.automacao_execucoes
    where status in ('em_andamento', 'aguardando', 'ativa')
      and agendado_para <= now()
    order by agendado_para
    limit 500
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
        v_destino := nullif(v_passo.config->>(case when v_ok then 'ir_se_verdadeiro'
                                                   else 'ir_se_falso' end), '')::int;
        if v_destino is null then
          v_destino := v_exec.passo_atual + 1;
        end if;
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
                    null, v_exec.automacao_fk, v_passo.passo_id, v_exec.contexto);
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
              'evento', v_exec.contexto,
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
        values (v_exec.lead_fk, (v_passo.config->>'lista_id')::int, 1, 'automacao')
        on conflict (lead_fk, lista_fk) do update set status = 1, updated_at = now();

      elsif v_passo.tipo = 'remover_lista' then
        update public.lead_listas set status = 2, updated_at = now()
        where lead_fk = v_exec.lead_fk and lista_fk = (v_passo.config->>'lista_id')::int;

      elsif v_passo.tipo = 'pontuar' then
        perform public.recalcular_pontuacao(v_exec.lead_fk);

      elsif v_passo.tipo = 'adicionar_a_automacao' then
        perform public.adicionar_a_automacao(v_exec.lead_fk,
                  (v_passo.config->>'automacao_id')::uuid);
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

-- ------------------------------------------------------------------
-- 6. RSS: fontes acompanhadas
-- ------------------------------------------------------------------
-- Cada post novo vira um evento, e o evento dispara automação como
-- qualquer outro. O e-mail cita %EVENTO.titulo% e %EVENTO.link%.
create table if not exists public.rss_fontes (
  fonte_id    serial primary key,
  nome        text not null,
  url         text not null unique,
  lista_fk    int references public.listas(lista_id),  -- para quem avisar
  ultimo_guid text,
  ultima_checagem timestamptz,
  ativo       boolean not null default true,
  created_at  timestamptz not null default now()
);

alter table public.rss_fontes enable row level security;
drop policy if exists rss_le on public.rss_fontes;
create policy rss_le on public.rss_fontes
  for select to authenticated using (public.papel_atual() is not null);
drop policy if exists rss_escreve on public.rss_fontes;
create policy rss_escreve on public.rss_fontes
  for all to authenticated
  using (public.papel_atual() = 'admin')
  with check (public.papel_atual() = 'admin');
grant select, insert, update, delete on public.rss_fontes to authenticated;
grant usage on sequence public.rss_fontes_fonte_id_seq to authenticated;

-- Registra o post novo. Um evento por assinante da lista escolhida —
-- é assim que o motor funciona: automação roda para uma pessoa.
create or replace function public.rss_registrar_item(
  p_fonte int, p_guid text, p_titulo text, p_link text,
  p_resumo text default null, p_imagem text default null)
returns int
language plpgsql security definer set search_path = public as $$
declare
  f record;
  v_qtd int := 0;
begin
  select * into f from public.rss_fontes where fonte_id = p_fonte and ativo;
  if not found then return 0; end if;

  -- já vimos este post? então não há nada a fazer
  if f.ultimo_guid is not distinct from p_guid then
    update public.rss_fontes set ultima_checagem = now() where fonte_id = p_fonte;
    return 0;
  end if;

  insert into public.eventos_sistema (tipo, lead_fk, payload)
  select 'rss_novo_item', ll.lead_fk,
         jsonb_build_object('fonte_id', p_fonte, 'fonte', f.nome,
                            'titulo', p_titulo, 'link', p_link,
                            'resumo', coalesce(p_resumo, ''),
                            'imagem', coalesce(p_imagem, ''))
  from public.lead_listas ll
  where f.lista_fk is not null and ll.lista_fk = f.lista_fk and ll.status = 1;
  get diagnostics v_qtd = row_count;

  update public.rss_fontes
  set ultimo_guid = p_guid, ultima_checagem = now()
  where fonte_id = p_fonte;
  return v_qtd;
end $$;

grant execute on function public.rss_registrar_item(int, text, text, text, text, text)
  to authenticated, service_role;
grant execute on function public.personalizar(text, uuid, jsonb) to authenticated;
grant execute on function public.enfileirar_email(uuid, uuid, uuid, uuid, uuid, jsonb)
  to authenticated, service_role;

commit;

select (select count(*) from information_schema.columns
        where table_name = 'automacao_execucoes' and column_name = 'contexto') as contexto_na_execucao,
       (select count(*) from information_schema.columns
        where table_name = 'envios' and column_name = 'contexto') as contexto_no_envio,
       (select count(*) from public.rss_fontes) as fontes_rss,
       public.personalizar('Você deixou %EVENTO.produto% para trás. %EVENTO.inexistente%',
                           null, '{"produto":"Desafio Casa Harmonizada"}'::jsonb) as prova;
