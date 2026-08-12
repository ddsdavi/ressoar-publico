-- =====================================================================
-- AUTH v4 — cada pessoa edita os próprios dados (nome), mas NUNCA o
-- próprio papel/situação. Só admin muda papel e status de alguém.
-- =====================================================================
begin;

-- permite ao usuário atualizar a própria linha…
drop policy if exists ressoar_perfil_proprio_update on public.usuarios_ressoar;
create policy ressoar_perfil_proprio_update on public.usuarios_ressoar
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- …e o trigger garante que ele não se promova
create or replace function public.fn_protege_admin_mestre() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_papel_de_quem_edita text := public.papel_atual();
begin
  if tg_op = 'DELETE' then
    if old.admin_mestre then
      raise exception 'Conta de administração permanente — não pode ser excluída.';
    end if;
    return old;
  end if;

  -- ninguém muda o próprio papel/situação (nem admin, para evitar acidente);
  -- só outro admin faz isso pela tela de Usuários
  if auth.uid() is not null and auth.uid() = old.user_id then
    if new.papel is distinct from old.papel or new.status is distinct from old.status then
      raise exception 'Você não pode alterar o próprio papel ou a própria situação.';
    end if;
  elsif auth.uid() is not null and coalesce(v_papel_de_quem_edita, '') <> 'admin' then
    raise exception 'Somente admin altera dados de outra pessoa.';
  end if;

  if old.admin_mestre then
    if new.papel is distinct from 'admin' then
      raise exception 'Conta de administração permanente — o papel não pode ser alterado.';
    end if;
    if new.status is distinct from 'aprovado' then
      raise exception 'Conta de administração permanente — não pode ser bloqueada.';
    end if;
    if new.admin_mestre is distinct from true then
      raise exception 'A trava de administração permanente não pode ser removida pela aplicação.';
    end if;
  end if;

  if not coalesce(old.admin_mestre, false) and coalesce(new.admin_mestre, false) then
    raise exception 'Só o banco de dados concede administração permanente.';
  end if;

  if (new.papel is distinct from 'admin' or new.status is distinct from 'aprovado')
     and old.papel = 'admin' and old.status = 'aprovado'
     and (select count(*) from public.usuarios_ressoar
          where papel = 'admin' and status = 'aprovado' and user_id <> old.user_id) = 0 then
    raise exception 'Este é o último admin ativo — promova outra pessoa antes.';
  end if;

  return new;
end $$;

commit;
