-- Guests (anonymous users) that haven't been around for 30 days can't get back to their nuclei anyway
-- in most cases (their session lives in one browser), so they're deleted every night. Deleting the
-- auth user cascades to their profile, nuclei, nucleus tracks, chat and AI connection. The shared
-- song catalog stays.
create extension if not exists pg_cron with schema pg_catalog;

create or replace function private.delete_inactive_guests(inactive_for interval default interval '30 days')
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted integer;
begin
  with activity as (
    select
      u.id,
      greatest(
        u.created_at,
        u.last_sign_in_at,
        u.updated_at,
        (select max(greatest(s.updated_at, s.refreshed_at::timestamptz)) from auth.sessions s where s.user_id = u.id),
        (select max(nt.added_at) from public.nucleus_tracks nt join public.nuclei n on n.id = nt.nucleus_id where n.user_id = u.id),
        (select max(cm.created_at) from public.chat_messages cm join public.nuclei n on n.id = cm.nucleus_id where n.user_id = u.id)
      ) as last_active
    from auth.users u
    where u.is_anonymous is true
  ),
  removed as (
    delete from auth.users u
    using activity a
    where u.id = a.id and a.last_active < now() - inactive_for
    returning u.id
  )
  select count(*) into deleted from removed;
  return deleted;
end;
$$;

revoke all on function private.delete_inactive_guests(interval) from public, anon, authenticated;

-- Every night at 09:17 UTC (03:17 in Mexico City)
select cron.schedule('delete-inactive-guests', '17 9 * * *', $$select private.delete_inactive_guests()$$);
