-- Per-song signals that can be added up across a nucleus, instead of only prose.
-- analysis_version lets the catalog re-analyse songs read with an older prompt.
alter table public.tracks
  add column secondary_emotion text
    check (secondary_emotion in ('joy', 'sadness', 'anger', 'fear', 'love', 'surprise', 'calm', 'nostalgia')),
  add column addressee text
    check (addressee in ('ex', 'partner', 'crush', 'self', 'friend', 'family', 'everyone', 'nobody')),
  add column stance text
    check (stance in ('longing', 'defiant', 'resigned', 'euphoric', 'bitter', 'tender', 'anxious', 'detached', 'playful', 'reflective', 'confident')),
  add column themes text[] check (cardinality(themes) <= 5),
  add column analysis_version smallint not null default 1;

-- A nucleus's first impression: a few lines about what its songs say about the person.
-- name_is_custom keeps a name the user typed from being replaced by the AI's.
alter table public.nuclei
  add column impression text check (char_length(impression) <= 1200),
  add column impression_track_count integer,
  add column impression_updated_at timestamptz,
  add column name_is_custom boolean not null default false;
