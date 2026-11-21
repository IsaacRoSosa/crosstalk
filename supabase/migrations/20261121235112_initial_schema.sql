-- Crosstalk initial schema
--
-- tracks          shared catalog: one row per song, analysed once and reused by every user
-- nuclei          one per user for now (created automatically on sign-up)
-- nucleus_tracks  which catalog tracks orbit each nucleus
-- chat_messages   conversation with a nucleus
-- profiles        public profile data for each auth user (anonymous users included)
--
-- Security model: users read and write only their own nuclei, nucleus tracks and messages.
-- The track catalog is read-only for users; only the server (secret key, bypasses RLS) writes it,
-- so nobody can inject fake analyses that other users would see.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.tracks (
  id bigint generated always as identity primary key,
  spotify_id text unique,
  deezer_id bigint unique,
  isrc text,
  title text not null,
  artist text not null,
  album text,
  cover_url text,
  duration_ms integer check (duration_ms > 0),
  youtube_video_id text,
  genius_url text,
  -- Analysis (null until the track has been analysed)
  emotion text check (emotion in ('joy', 'sadness', 'anger', 'fear', 'love', 'surprise', 'calm', 'nostalgia')),
  valence real check (valence between 0 and 1),
  energy real check (energy between 0 and 1),
  genre text,
  mood_description text,
  lyrical_style text,
  analysis_model text,
  analyzed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint tracks_has_source check (spotify_id is not null or deezer_id is not null)
);

create index tracks_isrc_idx on public.tracks (isrc);

create table public.nuclei (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null default 'The Nucleus' check (char_length(name) between 1 and 80),
  dominant_emotion text check (dominant_emotion in ('joy', 'sadness', 'anger', 'fear', 'love', 'surprise', 'calm', 'nostalgia')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index nuclei_user_id_idx on public.nuclei (user_id);

create table public.nucleus_tracks (
  nucleus_id bigint not null references public.nuclei (id) on delete cascade,
  track_id bigint not null references public.tracks (id) on delete restrict,
  added_at timestamptz not null default now(),
  primary key (nucleus_id, track_id)
);

create index nucleus_tracks_track_id_idx on public.nucleus_tracks (track_id);

create table public.chat_messages (
  id bigint generated always as identity primary key,
  nucleus_id bigint not null references public.nuclei (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(content) between 1 and 8000),
  created_at timestamptz not null default now()
);

create index chat_messages_nucleus_id_created_at_idx on public.chat_messages (nucleus_id, created_at);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create trigger nuclei_set_updated_at
  before update on public.nuclei
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- New users get a profile and a nucleus automatically
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url'
  );

  insert into public.nuclei (user_id) values (new.id);

  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.tracks enable row level security;
alter table public.nuclei enable row level security;
alter table public.nucleus_tracks enable row level security;
alter table public.chat_messages enable row level security;

-- profiles: own row only
create policy "Users can view their own profile"
  on public.profiles for select to authenticated
  using ((select auth.uid()) = id);

create policy "Users can update their own profile"
  on public.profiles for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- tracks: readable by signed-in users (anonymous sessions included); written only by the server
create policy "Signed-in users can read the track catalog"
  on public.tracks for select to authenticated
  using (true);

-- nuclei: own rows only
create policy "Users can view their own nuclei"
  on public.nuclei for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can create their own nuclei"
  on public.nuclei for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can update their own nuclei"
  on public.nuclei for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users can delete their own nuclei"
  on public.nuclei for delete to authenticated
  using ((select auth.uid()) = user_id);

-- nucleus_tracks: only within nuclei the user owns
create policy "Users can view tracks in their own nuclei"
  on public.nucleus_tracks for select to authenticated
  using (exists (
    select 1 from public.nuclei n
    where n.id = nucleus_id and n.user_id = (select auth.uid())
  ));

create policy "Users can add tracks to their own nuclei"
  on public.nucleus_tracks for insert to authenticated
  with check (exists (
    select 1 from public.nuclei n
    where n.id = nucleus_id and n.user_id = (select auth.uid())
  ));

create policy "Users can remove tracks from their own nuclei"
  on public.nucleus_tracks for delete to authenticated
  using (exists (
    select 1 from public.nuclei n
    where n.id = nucleus_id and n.user_id = (select auth.uid())
  ));

-- chat_messages: only within nuclei the user owns
create policy "Users can view messages in their own nuclei"
  on public.chat_messages for select to authenticated
  using (exists (
    select 1 from public.nuclei n
    where n.id = nucleus_id and n.user_id = (select auth.uid())
  ));

create policy "Users can add messages to their own nuclei"
  on public.chat_messages for insert to authenticated
  with check (exists (
    select 1 from public.nuclei n
    where n.id = nucleus_id and n.user_id = (select auth.uid())
  ));

create policy "Users can delete messages in their own nuclei"
  on public.chat_messages for delete to authenticated
  using (exists (
    select 1 from public.nuclei n
    where n.id = nucleus_id and n.user_id = (select auth.uid())
  ));

-- ---------------------------------------------------------------------------
-- Grants (explicit, so access does not depend on project defaults; RLS still applies)
-- ---------------------------------------------------------------------------

revoke all on public.profiles, public.tracks, public.nuclei, public.nucleus_tracks, public.chat_messages from anon;

grant select, update on public.profiles to authenticated;
grant select on public.tracks to authenticated;
grant select, insert, update, delete on public.nuclei to authenticated;
grant select, insert, delete on public.nucleus_tracks to authenticated;
grant select, insert, delete on public.chat_messages to authenticated;

grant all on public.profiles, public.tracks, public.nuclei, public.nucleus_tracks, public.chat_messages to service_role;
