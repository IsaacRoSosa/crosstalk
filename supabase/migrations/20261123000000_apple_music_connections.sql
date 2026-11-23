-- A Google account's Apple Music connection (its Music User Token), so the person can pick their
-- playlists from any device without signing in to Apple again. Guests aren't stored: their
-- connection stays in their browser. The token is encrypted by the server (AES-256-GCM, like
-- ai_connections) and this table has no policies for users: only the server can read or write it.

create table public.apple_music_connections (
  user_id uuid primary key references auth.users (id) on delete cascade,
  encrypted_token text not null,
  -- The person's Apple Music country (e.g. "mx"), for catalog links
  storefront text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger apple_music_connections_set_updated_at
  before update on public.apple_music_connections
  for each row execute function public.set_updated_at();

alter table public.apple_music_connections enable row level security;

revoke all on public.apple_music_connections from anon, authenticated;
grant all on public.apple_music_connections to service_role;
