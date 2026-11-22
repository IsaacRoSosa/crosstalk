-- Songs added from Apple Music links. Like spotify_id and deezer_id, the id lets a song be found again
-- without asking Apple; the ISRC still matches it with the same recording from the other sources.
alter table public.tracks add column apple_music_id text unique;

alter table public.tracks drop constraint tracks_has_source;
alter table public.tracks add constraint tracks_has_source
  check (spotify_id is not null or deezer_id is not null or apple_music_id is not null);

comment on column public.tracks.apple_music_id is 'Apple Music catalog song id (from music.apple.com links)';
