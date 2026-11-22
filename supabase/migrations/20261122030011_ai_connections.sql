-- Each user's AI connection (their own OpenRouter key), so analyses and chat are billed to them.
-- The key is encrypted by the server (AES-256-GCM) before it is stored, and this table has no
-- policies for users: only the server, with the secret key, can read or write it.

create table public.ai_connections (
  user_id uuid primary key references auth.users (id) on delete cascade,
  provider text not null check (provider in ('openrouter')),
  encrypted_key text not null,
  -- Last characters of the key, to show which key is connected without exposing it
  key_hint text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger ai_connections_set_updated_at
  before update on public.ai_connections
  for each row execute function public.set_updated_at();

alter table public.ai_connections enable row level security;

revoke all on public.ai_connections from anon, authenticated;
grant all on public.ai_connections to service_role;
