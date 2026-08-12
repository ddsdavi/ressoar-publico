-- =====================================================================
-- MANYCHAT
--
-- A chave da API fica guardada dentro da Ressoar e é trocável pela tela —
-- ninguém precisa mexer em arquivo nem chamar programador para trocar.
--
-- Onde ela mora importa. Não vai para app_config: a tela de Configurações
-- carrega o app_config inteiro, e a chave iria junto para o navegador.
-- Vai para public.segredos, que não tem policy nenhuma — o painel escreve
-- por uma função, mas não consegue ler de volta. Por isso a tela mostra
-- "configurada ✓" em vez do valor: quem digitou já sabe qual é, e quem
-- não digitou não tem por que descobrir.
-- =====================================================================
begin;

-- ------------------------------------------------------------------
-- guardar e conferir segredos pela tela
-- ------------------------------------------------------------------
create or replace function public.guardar_segredo(p_chave text, p_valor text)
returns text
language plpgsql security definer set search_path = public as $$
begin
  -- "is distinct from", não "<>". papel_atual() devolve null para quem não
  -- está logado, e em SQL `null <> 'admin'` vale NULL — que não é verdadeiro,
  -- então o if não dispara e a porta fica aberta para a chave pública.
  -- Custou um teste com curl anônimo para aparecer.
  if public.papel_atual() is distinct from 'admin' then
    raise exception 'só admin muda segredo';
  end if;
  -- lista fechada: assim ninguém usa esta função para gravar qualquer coisa
  if p_chave not in ('manychat_api_key', 'service_key') then
    raise exception 'segredo desconhecido: %', p_chave;
  end if;

  if coalesce(btrim(p_valor), '') = '' then
    delete from public.segredos where chave = p_chave;
    return 'removido';
  end if;

  insert into public.segredos (chave, valor) values (p_chave, btrim(p_valor))
  on conflict (chave) do update set valor = excluded.valor, updated_at = now();
  return 'guardado';
end $$;

-- devolve só se existe e o tamanho — nunca o valor
create or replace function public.segredos_configurados()
returns jsonb
language sql security definer stable set search_path = public as $$
  select coalesce(jsonb_object_agg(chave, jsonb_build_object(
           'configurado', true, 'tamanho', length(valor),
           'atualizado_em', updated_at)), '{}'::jsonb)
  from public.segredos
  where public.papel_atual() = 'admin';
$$;

grant execute on function public.guardar_segredo(text, text) to authenticated;
grant execute on function public.segredos_configurados() to authenticated;

-- ------------------------------------------------------------------
-- o passo de automação
-- ------------------------------------------------------------------
-- Quem fala com o ManyChat é a Edge Function: o Postgres não tem como
-- fazer chamada HTTP e esperar a resposta para decidir o passo seguinte.
-- O pg_net dispara e esquece, que é o suficiente aqui — aplicar uma tag
-- não muda o rumo da automação.
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

  select email, nome, whatsapp into v_lead
  from public.tabela_1_leads where lead_id = p_lead;
  if not found then return 'lead não encontrado'; end if;

  perform net.http_post(
    url := v_base || '/manychat',
    body := jsonb_build_object(
      'lead_id', p_lead, 'email', v_lead.email, 'nome', v_lead.nome,
      'whatsapp', v_lead.whatsapp, 'tag', p_tag, 'criar', p_criar),
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'Authorization', 'Bearer ' || v_key));
  return 'enviado';
end $$;

grant execute on function public.manychat_aplicar(uuid, text, boolean)
  to authenticated, service_role;

-- registro do que aconteceu, para dar para conferir depois
create table if not exists public.manychat_log (
  log_id      bigserial primary key,
  lead_fk     uuid,
  acao        text,
  tag         text,
  sucesso     boolean,
  detalhe     text,
  created_at  timestamptz not null default now()
);
alter table public.manychat_log enable row level security;
drop policy if exists mc_le on public.manychat_log;
create policy mc_le on public.manychat_log
  for select to authenticated using (public.papel_atual() is not null);
grant select on public.manychat_log to authenticated;

commit;

-- o passo entra no executor
create or replace function public.executar_passo_manychat(
  p_lead uuid, p_config jsonb) returns text
language sql security definer set search_path = public as $$
  select public.manychat_aplicar(p_lead, p_config->>'tag',
                                 coalesce((p_config->>'criar')::boolean, true));
$$;
grant execute on function public.executar_passo_manychat(uuid, jsonb) to authenticated;

select (select count(*) from pg_proc where proname = 'guardar_segredo')   as tem_guardar,
       (select count(*) from pg_proc where proname = 'manychat_aplicar')  as tem_aplicar,
       public.manychat_aplicar(
         (select lead_id from public.tabela_1_leads limit 1), 'TESTE', false) as estado_agora;
