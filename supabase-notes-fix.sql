-- A row used to need at least one score, which was right before notes existed.
-- A note with no scores is a perfectly good row now — someone can have something
-- to say about a film without wanting to grade it. What is meaningless is a row
-- carrying neither, so the constraint moves to that.

alter table public.user_ratings drop constraint if exists at_least_one_score;

alter table public.user_ratings
  add constraint has_something check (
    jumps is not null or gore is not null or dread is not null
    or (note is not null and char_length(btrim(note)) > 0)
  );

-- check: this should succeed where it previously failed
--   insert into public.user_ratings (movie_idx, note, source) values (3, 'note only', 'offline');
--   delete from public.user_ratings where note = 'note only';
