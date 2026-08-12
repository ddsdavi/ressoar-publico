-- =====================================================================
-- AUTH v3 — a lista de admins permanentes vira DADO (tabela), não código.
-- Permanentes (trava eterna): dona2@exemplo.com e
--                             suporte@exemplo.com
-- voce@exemplo.com continua ADMIN, porém removível/alterável normalmente.
-- Só SQL direto no banco altera esta lista — a aplicação nunca.
-- =====================================================================
begin;

create table if not exists public.admins_permanentes (
  email      citext primary key,
  nota       text,
  created_at timestamptz not null default now()
);
alter table public.admins_permanentes enable row level security;
-- sem policy = invisível/imutável pela aplicação; só service role/SQL direto

delete from public.admins_permanentes;
insert into public.admins_permanentes (email, nota) values
  ('dona2@exemplo.com', 'Nome do Remetente — conta permanente'),
  ('suporte@exemplo.com', 'Suporte Nome do Remetente — conta permanente');

-- trigger de cadastro passa a consultar a tabela
create or replace function public.fn_novo_usuario_auth() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_mestre boolean := exists (
    select 1 from public.admins_permanentes p where p.email = lower(new.email));
begin
  insert into public.usuarios_ressoar (user_id, email, nome, papel, status, admin_mestre)
  values (new.id, lower(new.email),
          coalesce(new.raw_user_meta_data->>'nome',''),
          case when v_mestre then 'admin' else 'assistente' end,
          case when v_mestre then 'aprovado' else 'pendente' end,
          v_mestre)
  on conflict (user_id) do nothing;
  insert into public.eventos_sistema (tipo, payload)
  values ('usuario_cadastrado', jsonb_build_object('email', lower(new.email)));
  return new;
end $$;

-- ressincroniza quem já existe (a trava impede pela aplicação; aqui é SQL direto)
alter table public.usuarios_ressoar disable trigger trg_protege_admin_mestre;

update public.usuarios_ressoar u
set admin_mestre = exists (select 1 from public.admins_permanentes p where p.email = u.email);

-- garante que os permanentes já cadastrados fiquem admin/aprovado
update public.usuarios_ressoar u
set papel = 'admin', status = 'aprovado'
where u.admin_mestre;

-- Davi segue admin aprovado, mas sem a trava (pode ser alterado/removido)
update public.usuarios_ressoar
set papel = 'admin', status = 'aprovado'
where email = 'voce@exemplo.com';

alter table public.usuarios_ressoar enable trigger trg_protege_admin_mestre;

commit;

select email, papel, status, admin_mestre from public.usuarios_ressoar order by created_at;
