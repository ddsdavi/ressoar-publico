-- =====================================================================
-- AUTH v5 — foto de perfil (WebP no Storage) e sincronia de e-mail.
-- =====================================================================
begin;

alter table public.usuarios_ressoar add column if not exists avatar_url text;

-- quando o e-mail muda no Auth, o perfil acompanha
create or replace function public.fn_sync_email_usuario() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.email is distinct from old.email then
    update public.usuarios_ressoar
    set email = lower(new.email), updated_at = now()
    where user_id = new.id;
  end if;
  return new;
end $$;

drop trigger if exists trg_sync_email_usuario on auth.users;
create trigger trg_sync_email_usuario
  after update of email on auth.users
  for each row execute function public.fn_sync_email_usuario();

-- ------------------ Storage: bucket de avatares ------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatares', 'avatares', true, 2097152, array['image/webp'])
on conflict (id) do update
  set public = true, file_size_limit = 2097152, allowed_mime_types = array['image/webp'];

-- cada pessoa manda a própria foto: o arquivo precisa começar com o id dela
drop policy if exists avatar_leitura_publica on storage.objects;
create policy avatar_leitura_publica on storage.objects
  for select to public using (bucket_id = 'avatares');

drop policy if exists avatar_envio_proprio on storage.objects;
create policy avatar_envio_proprio on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatares' and name like auth.uid()::text || '%');

drop policy if exists avatar_troca_propria on storage.objects;
create policy avatar_troca_propria on storage.objects
  for update to authenticated
  using (bucket_id = 'avatares' and name like auth.uid()::text || '%');

drop policy if exists avatar_remove_proprio on storage.objects;
create policy avatar_remove_proprio on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatares' and name like auth.uid()::text || '%');

commit;

select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'avatares';
