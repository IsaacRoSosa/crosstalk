-- Guests (anonymous sessions) keep a single nucleus; Google accounts can have up to 20.
-- The sign-up trigger runs as security definer, so the first nucleus is never blocked by this.
-- (This first version recursed; 20261122060220 replaces the policy.)
drop policy "Users can create their own nuclei" on public.nuclei;

create policy "Users can create their own nuclei"
  on public.nuclei for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and (
      select count(*) from public.nuclei n where n.user_id = (select auth.uid())
    ) < case
      when coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) then 1
      else 20
    end
  );
