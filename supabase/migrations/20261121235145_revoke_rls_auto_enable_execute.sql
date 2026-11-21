-- rls_auto_enable() is the event-trigger function Supabase installs to enable RLS on new tables.
-- It only needs to run as an event trigger, so it should not be callable through the API.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
