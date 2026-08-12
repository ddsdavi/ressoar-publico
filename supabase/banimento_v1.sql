-- =====================================================================
-- BANIMENTO DO MANYCHAT v1 — números que NUNCA recebem tag
--
-- Ordem do dono (11/08/2026): certos números não podem ganhar nenhuma
-- tag no ManyChat, nunca — e o sistema deve vigiá-los: se aparecerem
-- lá, devem ser excluídos; não dando para excluir, descadastrados do
-- WhatsApp; e, no mínimo, marcados com a tag ESC WHATSAPP.
--
-- O que a API do ManyChat permite, medido antes de desenhar (11/08/2026):
--   - excluir assinante: NÃO EXISTE na API pública (404) — exclusão é
--     só pela interface, à mão;
--   - descadastrar: updateSubscriber aceita has_opt_in_sms/email; o
--     opt-in do WhatsApp não tem escrita documentada — o monitor tenta
--     e registra o que conseguiu;
--   - a tag ESC WHATSAPP funciona sempre — é a garantia de verdade.
--
-- Três camadas, porque uma só falha:
--   1. TRAVA em manychat_aplicar: o motor nem chama o ManyChat para
--      número banido (compra, automação, regra de produto — tudo passa
--      por aqui).
--   2. TRAVA na Edge Function manychat: cobre o que não passa pelo
--      motor — a tela do painel e o External Request de lá.
--   3. MONITOR (cron, 10 em 10 min): cobre o que a Ressoar não controla,
--      como o próprio ManyChat criando o assinante quando a pessoa manda
--      mensagem, ou sistemas de fora (n8n) criando por conta própria.
--
-- Os NÚMEROS banidos são dado pessoal e o repositório é público: os
-- valores reais moram em banimento_dados.local.sql (fora do git, padrão
-- *.local.sql). Quem reconstruir o banco do zero precisa rodar o par
-- local depois desta migração — sem ele a tabela nasce vazia e a regra
-- volta a não existir.
-- =====================================================================
begin;

create table if not exists public.manychat_banidos (
  whatsapp            text primary key,       -- forma canônica: DDI+DDD+número
  nome                text,
  motivo              text,
  manychat_id         text,                   -- último assinante visto lá
  ultima_verificacao  timestamptz,
  ultima_acao         text,                   -- o que o monitor conseguiu fazer
  created_at          timestamptz not null default now()
);

comment on table public.manychat_banidos is
  'Números que nunca recebem tag no ManyChat. O monitor vigia e aplica: descadastro (melhor esforço) + tag ESC WHATSAPP. Exclusão de verdade é manual — a API não tem.';
comment on column public.manychat_banidos.whatsapp is
  'Forma canônica DDI+DDD+número (5511999990000). A comparação da trava é exata.';

alter table public.manychat_banidos enable row level security;

drop policy if exists manychat_banidos_leitura on public.manychat_banidos;
create policy manychat_banidos_leitura on public.manychat_banidos
  for select to authenticated using (public.papel_atual() is not null);

drop policy if exists manychat_banidos_escrita on public.manychat_banidos;
create policy manychat_banidos_escrita on public.manychat_banidos
  for all to authenticated
  using (public.papel_atual() = 'admin')
  with check (public.papel_atual() = 'admin');

grant select, insert, update, delete on public.manychat_banidos to authenticated;

-- a tag de último recurso fica em configuração, não no código
insert into public.app_config (chave, valor) values ('manychat_tag_esc', '44605757')
on conflict (chave) do nothing;

-- ------------------------------------------------------------------
-- a trava no motor: banido não recebe tag, de nenhuma origem
--
-- Mesmo corpo de telefone_da_compra_v2 (assinatura única de 4
-- parâmetros), com a verificação ANTES de qualquer chamada externa.
-- ------------------------------------------------------------------
create or replace function public.manychat_aplicar(
  p_lead uuid, p_tag text, p_criar boolean default true, p_produto text default null)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_base text := public.cfg('base_url_tracking');
  v_key  text := public.segredo('service_key');
  v_lead record;
  v_fone text;
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

  -- o número da compra daquele produto manda; sem produto, o principal
  v_fone := coalesce(public.whatsapp_para_contato(p_lead, p_produto), v_lead.whatsapp);

  -- número banido: nada sai daqui, e o bloqueio fica registrado
  if exists (
    select 1 from public.manychat_banidos b
     where b.whatsapp in (v_fone, v_lead.whatsapp)
        or (v_lead.manychat_id is not null and b.manychat_id = v_lead.manychat_id)
  ) then
    insert into public.manychat_log (lead_fk, acao, tag, sucesso, detalhe, simulado)
    values (p_lead, 'bloqueado', p_tag, true,
            'número banido do ManyChat — nenhuma tag é aplicada', false);
    return 'banido';
  end if;

  perform net.http_post(
    url := v_base || '/manychat',
    body := jsonb_build_object(
      'lead_id', p_lead, 'manychat_id', v_lead.manychat_id,
      'email', v_lead.email, 'nome', v_lead.nome,
      'whatsapp', v_fone, 'tag', p_tag, 'criar', p_criar),
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'Authorization', 'Bearer ' || v_key));
  return 'enviado';
end $$;

grant execute on function public.manychat_aplicar(uuid, text, boolean, text)
  to authenticated, service_role;

-- a lição da armadilha 38: uma assinatura só, sempre
do $$
declare v_qtd int;
begin
  select count(*) into v_qtd from pg_proc
   where proname = 'manychat_aplicar' and pronamespace = 'public'::regnamespace;
  if v_qtd <> 1 then
    raise exception 'manychat_aplicar tem % assinaturas; deveria ter 1', v_qtd;
  end if;
end $$;

-- ------------------------------------------------------------------
-- o monitor: pede à Edge Function a verificação dos banidos
--
-- A lógica mora na função (é ela que fala com a API do ManyChat); aqui
-- só o disparo. Lista vazia não gasta chamada nenhuma.
-- ------------------------------------------------------------------
create or replace function public.monitorar_banidos()
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_base text := public.cfg('base_url_tracking');
  v_key  text := public.segredo('service_key');
begin
  if not exists (select 1 from public.manychat_banidos) then
    return 'sem banidos — nada a verificar';
  end if;
  if coalesce(v_base, '') = '' or coalesce(v_key, '') = '' then
    return 'falta base_url_tracking ou service_key';
  end if;

  perform net.http_post(
    url := v_base || '/manychat',
    body := jsonb_build_object('acao', 'banidos_verificar'),
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'Authorization', 'Bearer ' || v_key));
  return 'verificação pedida';
end $$;

grant execute on function public.monitorar_banidos() to service_role;

select cron.schedule('ressoar-banidos-manychat', '*/10 * * * *',
                     'select public.monitorar_banidos()')
where not exists (select 1 from cron.job where jobname = 'ressoar-banidos-manychat');

commit;

-- prova: a trava existe e o relógio está de pé
select
  (select count(*) = 1 from pg_proc
    where proname = 'manychat_aplicar'
      and pronamespace = 'public'::regnamespace
      and position('manychat_banidos' in prosrc) > 0) as trava_no_motor,
  (select count(*) = 1 from cron.job
    where jobname = 'ressoar-banidos-manychat')        as relogio_agendado,
  (select valor from public.app_config
    where chave = 'manychat_tag_esc')                 as tag_esc;
