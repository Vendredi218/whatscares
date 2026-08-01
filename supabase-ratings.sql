-- User intensity ratings. Run in Supabase SQL Editor (Dashboard → SQL Editor → New query).
-- One row per user per film — the unique constraint is the real defence against
-- vote stuffing; anything the front-end does is only a convenience on top of it.

create table if not exists public.user_ratings (
  id          uuid primary key default gen_random_uuid(),
  -- null user_id = a rating collected off-platform and imported. Those have no
  -- account to attach to, so they are marked by `source` instead.
  user_id     uuid references auth.users(id) on delete cascade,
  source      text not null default 'app' check (source in ('app', 'offline')),
  movie_idx   integer not null,
  jumps       smallint check (jumps  between 1 and 5),
  gore        smallint check (gore   between 1 and 5),
  dread       smallint check (dread  between 1 and 5),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- One vote per person per film, enforced in the database. Front-end checks
  -- are convenience; this is the part that actually stops vote stuffing.
  -- A plain UNIQUE works for imported rows too: Postgres treats NULLs as
  -- distinct, so any number of offline rows (user_id is null) coexist. A
  -- partial index would break upserts — ON CONFLICT cannot target one.
  unique (user_id, movie_idx),
  constraint app_rating_has_user check (source <> 'app' or user_id is not null),
  -- a row with nothing rated is meaningless; keep the table clean
  constraint at_least_one_score check (jumps is not null or gore is not null or dread is not null)
);

alter table public.user_ratings enable row level security;

-- A user may only ever touch their own row, and only while authenticated.
create policy "read own rating" on public.user_ratings
  for select using (auth.uid() = user_id);
create policy "insert own rating" on public.user_ratings
  for insert with check (auth.uid() = user_id);
create policy "update own rating" on public.user_ratings
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "delete own rating" on public.user_ratings
  for delete using (auth.uid() = user_id);

create index if not exists idx_user_ratings_movie on public.user_ratings(movie_idx);

create or replace function public.touch_updated_at() returns trigger
  language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists trg_user_ratings_touch on public.user_ratings;
create trigger trg_user_ratings_touch before update on public.user_ratings
  for each row execute function public.touch_updated_at();

-- ─────────────────────────────────────────────────────────────
-- Public aggregate.
-- RLS above hides individual rows from everyone but their owner, so the
-- averages come from a view. A view runs with its owner's rights unless
-- security_invoker is on, which is what lets anonymous visitors read the
-- totals without ever seeing who voted for what.
-- ─────────────────────────────────────────────────────────────
create or replace view public.movie_rating_stats as
  select
    movie_idx,
    round(avg(jumps)::numeric, 1) as jumps_avg,
    round(avg(gore )::numeric, 1) as gore_avg,
    round(avg(dread)::numeric, 1) as dread_avg,
    count(*)::int                 as votes,
    count(*) filter (where source = 'offline')::int as offline_votes
  from public.user_ratings
  group by movie_idx;

grant select on public.movie_rating_stats to anon, authenticated;

-- Sanity check after running:
--   select * from public.movie_rating_stats order by votes desc limit 5;

-- ─────────────────────────────────────────────────────────────
-- MIGRATION: if you already ran the first version of this file, the partial
-- index it created cannot be targeted by ON CONFLICT, so every upsert fails
-- with "no unique or exclusion constraint matching". Run this once:
--
--   drop index if exists public.uniq_user_movie;
--   alter table public.user_ratings
--     add constraint user_ratings_user_id_movie_idx_key unique (user_id, movie_idx);
-- ─────────────────────────────────────────────────────────────
