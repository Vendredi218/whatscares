-- Short reviews on the intensity ratings: "how did it scare you?"
-- Run in Supabase SQL Editor after supabase-ratings.sql.

alter table public.user_ratings
  add column if not exists note text check (char_length(note) <= 140),
  -- keeps the original when a note was written in another language and
  -- translated for display, so nothing is lost and the source stays checkable
  add column if not exists note_original text check (char_length(note_original) <= 200),
  add column if not exists note_lang text;

-- ─────────────────────────────────────────────────────────────
-- Notes are public in a way scores are not: a score is a number in an
-- average, a note is someone's words on a page. RLS still limits writing to
-- the row's owner, and this view is what everyone reads — it exposes the
-- text and when it landed, never who wrote it.
-- ─────────────────────────────────────────────────────────────
create or replace view public.movie_notes as
  select
    movie_idx,
    note,
    note_lang,
    jumps, gore, dread,
    created_at
  from public.user_ratings
  where note is not null and char_length(btrim(note)) > 0
  order by created_at desc;

grant select on public.movie_notes to anon, authenticated;

-- Sanity check:
--   select movie_idx, left(note, 40) from public.movie_notes limit 5;
