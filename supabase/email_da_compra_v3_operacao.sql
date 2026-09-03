-- =====================================================================
-- QUANDO A COMPRA FOI FEITA PELA PRÓPRIA OPERAÇÃO
--
-- A regra "a comunicação do produto vai para o e-mail da compra" tem uma
-- exceção que a prática mostrou: às vezes quem preenche o checkout é a
-- equipe, não a cliente. Uma compra do Livro Físico saiu no e-mail do
-- suporte; ao pé da letra, os e-mails daquele produto iriam para a caixa
-- do suporte, e a cliente nunca receberia nada.
--
-- Endereço da casa não é endereço de cliente. Quando a compra vier com um
-- deles, a comunicação volta para o e-mail principal da pessoa.
-- =====================================================================
begin;

create table if not exists public.emails_da_operacao (
  email     text primary key,
  observacao text,
  criado_em timestamptz not null default now()
);

comment on table public.emails_da_operacao is
  'Endereços da própria equipe. Compra feita com um deles não vira endereço de comunicação da cliente.';

alter table public.emails_da_operacao enable row level security;

drop policy if exists emails_operacao_leitura on public.emails_da_operacao;
create policy emails_operacao_leitura on public.emails_da_operacao
  for select to authenticated using (public.papel_atual() is not null);

drop policy if exists emails_operacao_escrita on public.emails_da_operacao;
create policy emails_operacao_escrita on public.emails_da_operacao
  for all to authenticated
  using (public.papel_atual() = 'admin')
  with check (public.papel_atual() = 'admin');

-- Nenhum endereço entra aqui. Os e-mails da casa — a caixa institucional
-- e os pessoais da equipe — ficam em `emails_da_operacao_dados.local.sql`,
-- que o .gitignore segura na máquina: o espelho deste projeto é público,
-- e-mail de pessoa não vai para repositório, e a caixa de UMA operação
-- não deve nascer dentro de uma cópia da plataforma (até 03/09/2026 ela
-- estava escrita aqui).
--
-- Quem reconstruir o banco do zero roda aquele arquivo depois deste —
-- sem ele, uma compra feita pela equipe volta a mandar a comunicação do
-- produto para a caixa de quem preencheu o checkout, não para a cliente.

-- ------------------------------------------------------------------
-- a escolha do endereço passa a pular os e-mails da casa
-- ------------------------------------------------------------------
create or replace function public.email_para_contato(
  p_lead uuid, p_produto text default null)
returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select c.email_compra
       from public.tabela_4_alunos c
      where c.lead_fk = p_lead
        and p_produto is not null
        and c.nome_produto ilike '%' || p_produto || '%'
        and coalesce(c.email_compra, '') <> ''
        and c.status = 'aprovada'
        -- compra feita pela equipe não define para onde a cliente ouve
        and not exists (select 1 from public.emails_da_operacao o
                         where lower(o.email) = lower(c.email_compra))
      order by c.data_compra desc
      limit 1),
    (select l.email from public.tabela_1_leads l where l.lead_id = p_lead)
  );
$$;

grant execute on function public.email_para_contato(uuid, text)
  to authenticated, service_role;

-- O mesmo vale para o cadastro: e-mail da casa não entra como endereço
-- da pessoa, senão volta pela porta dos fundos.
create or replace function public.registrar_email_do_lead(
  p_lead uuid, p_email text, p_origem text default null)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(p_email, '') = '' then return; end if;
  if exists (select 1 from public.emails_da_operacao o
              where lower(o.email) = lower(trim(p_email))) then
    return;
  end if;

  insert into public.lead_emails (lead_fk, email, origem)
  values (p_lead, lower(trim(p_email)), p_origem)
  on conflict (lead_fk, email) do update set ultimo_em = now();

  update public.tabela_1_leads
     set email = lower(trim(p_email))
   where lead_id = p_lead and coalesce(email, '') = '';
end $$;

grant execute on function public.registrar_email_do_lead(uuid, text, text)
  to authenticated, service_role;

commit;
