-- Seasons for mkv2-dryrun (expand-only).
-- Adds a seasons table and a NULLABLE season_id on scores. Old code ignores both;
-- new code filters scores by season ONLY when a season_id is supplied, so the
-- pre-migration schema and post-migration schema both work. Safe under
-- expand/contract: nullable column, no drop/rename/narrowing.

create table if not exists seasons (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  starts_at  timestamptz not null,
  ends_at    timestamptz not null
);

alter table scores add column if not exists season_id uuid null references seasons(id);
