-- Scores foundation for mkv2-dryrun (expand-only: CREATE TABLE).
-- Old code ignores this table; new code reads/writes it. Safe under expand/contract.

create table if not exists scores (
  id         uuid primary key default gen_random_uuid(),
  player_id  uuid not null references players(id),
  points     int not null,
  created_at timestamptz not null default now()
);
