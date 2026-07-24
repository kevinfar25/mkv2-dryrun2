-- Scores foundation: a scores table referencing players.
-- Expand/contract safe: additive only (new table), old code ignores it.

create table if not exists scores (
  id         uuid primary key default gen_random_uuid(),
  player_id  uuid not null references players(id),
  points     int not null,
  created_at timestamptz not null default now()
);
