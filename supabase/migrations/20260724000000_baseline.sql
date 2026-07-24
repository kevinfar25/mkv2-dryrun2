-- Baseline schema for mkv2-dryrun.
-- Applied to the prod container and to each wave DB before a phase builds.

create table if not exists schema_migrations (
  version    text primary key,
  applied_at timestamptz not null default now()
);

create table if not exists players (
  id   uuid primary key default gen_random_uuid(),
  name text not null
);
