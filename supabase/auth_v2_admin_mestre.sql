-- =====================================================================
-- AUTH v2 — ADMIN MESTRE (trava eterna)
-- Contas mestras nunca podem ser rebaixadas, bloqueadas nem excluídas —
-- nem pelo painel, nem pela API, nem por outro admin. Só por SQL direto
-- no banco (fora do alcance da aplicação).
-- =====================================================================
begin;

alter table public.usuarios_ressoar
  add column if not exists admin_mestre boolean not null default false;

-- os donos da operação: trava permanente
update public.usuarios_ressoar
set admin_mestre = true, papel = 'admin', status = 'aprovado'
where email in ('voce@exemplo.com','socio@exemplo.com',
                'dona@exemplo.com','suporte@exemplo.com');

-- o trigger de cadastro também já marca mestre quem for da lista
create or replace function public.fn_novo_usuario_auth() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_mestre boolean := lower(new.email) in
    ('voce@exemplo.com','socio@exemplo.com',
     'dona@exemplo.com','suporte@exemplo.com');
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

-- ------------------ a trava ------------------
create or replace function public.fn_protege_admin_mestre() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.admin_mestre then
      raise exception 'Conta de administração permanente — não pode ser excluída.';
    end if;
    return old;
  end if;

  if old.admin_mestre then
    -- mestre nunca perde papel nem é bloqueado
    if new.papel is distinct from 'admin' then
      raise exception 'Conta de administração permanente — o papel não pode ser alterado.';
    end if;
    if new.status is distinct from 'aprovado' then
      raise exception 'Conta de administração permanente — não pode ser bloqueada.';
    end if;
    -- e ninguém remove a própria trava pela aplicação
    if new.admin_mestre is distinct from true then
      raise exception 'A trava de administração permanente não pode ser removida pela aplicação.';
    end if;
  end if;

  -- promover alguém a mestre também é proibido pela aplicação (só SQL direto)
  if not coalesce(old.admin_mestre, false) and coalesce(new.admin_mestre, false) then
    raise exception 'Só o banco de dados concede administração permanente.';
  end if;

  -- sempre deve sobrar ao menos um admin aprovado
  if (new.papel is distinct from 'admin' or new.status is distinct from 'aprovado')
     and old.papel = 'admin' and old.status = 'aprovado'
     and (select count(*) from public.usuarios_ressoar
          where papel = 'admin' and status = 'aprovado' and user_id <> old.user_id) = 0 then
    raise exception 'Esta é a última administradora ativa — promova outra pessoa antes.';
  end if;

  return new;
end $$;

drop trigger if exists trg_protege_admin_mestre on public.usuarios_ressoar;
create trigger trg_protege_admin_mestre
  before update or delete on public.usuarios_ressoar
  for each row execute function public.fn_protege_admin_mestre();

commit;
