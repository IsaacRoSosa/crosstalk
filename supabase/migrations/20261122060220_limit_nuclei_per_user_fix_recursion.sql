-- A policy on nuclei can't query nuclei itself (infinite recursion), so the count lives in a
-- security definer function. It's in a schema the Data API doesn't expose, and only counts the caller's rows.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.own_nucleus_count()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer from public.nuclei where user_id = (select auth.uid());
$$;

revoke all on function private.own_nucleus_count() from public, anon;
grant execute on function private.own_nucleus_count() to authenticated;

drop policy "Users can create their own nuclei" on public.nuclei;

create policy "Users can create their own nuclei"
  on public.nuclei for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and private.own_nucleus_count() < case
      when coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) then 1
      else 20
    end
  );
