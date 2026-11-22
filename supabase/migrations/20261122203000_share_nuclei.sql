-- Share a nucleus by link. The token is random (16 bytes, base64url) and revocable: set it back to
-- null to turn the link off. Shared nuclei are read on the server with the admin client, which
-- returns only public fields, so no RLS policy opens nuclei to anonymous visitors.
alter table public.nuclei
  add column share_token text unique,
  add column shared_at timestamptz,
  add constraint nuclei_share_token_format check (share_token is null or share_token ~ '^[A-Za-z0-9_-]{22}$');

comment on column public.nuclei.share_token is 'Random token for the public read-only link (/s/<token>); null when not shared';
comment on column public.nuclei.shared_at is 'When the current share link was created';
