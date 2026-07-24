# mkv2-dryrun

A throwaway **Leaderboard API** sandbox whose only job is to dry-run **Magic Kingdom V2**
end-to-end without touching any real project.

It is deliberately shaped like a real product so MK V2's gates have something real to fire
against: feature slices, a CI with blocking checks, and SQL migrations.

## Stack

- TypeScript + `node:http` + `pg`, tested with Vitest
- Persistence seam (`src/db/store.ts`): `InMemoryStore` for hermetic CI/tests, `PgStore`
  for runtime / switch-on / prod-test against a real Postgres
- CI (`.github/workflows/ci.yml`): **typecheck · test · build** and **migration hygiene**
  (filename format + duplicate-prefix), both blocking
- Migrations in `supabase/migrations/`, applied by `scripts/migrate.mjs`

## DB topology (for the dry run)

| Tier | Container | Port | Who writes |
|---|---|---|---|
| 🔴 production | `mkv2-prod` (`docker compose up -d`) | 5500 | **only** the careful installer |
| 🟡 wave (per phase) | `mkv2-wave-<p>` (`scripts/wave-db.sh <p> <port>`) | 5511+ | that phase's fleet agent only |

Prod = baseline schema. Each wave DB = baseline + that phase's own migration. Prod advances
one branch at a time as the merge-train installs.

## Commands

```bash
npm install
npm run typecheck && npm test && npm run build   # what CI runs
docker compose up -d                             # start prod DB
DATABASE_URL=postgres://mkv2:mkv2@127.0.0.1:5500/mkv2 npm run migrate
scripts/wave-db.sh p1 5511                        # a throwaway wave DB
```
