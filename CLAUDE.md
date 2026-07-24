# CLAUDE.md — mkv2-dryrun2 (throwaway MK V2 dry-run sandbox)

A deliberately small TypeScript HTTP API used to exercise the Magic Kingdom V2 pipeline
end-to-end. It is NOT a real product; it exists so the fleet → jig → full-auto-deploy gates
have something faithful to run against.

## What it is

- **Stack:** TypeScript ESM (NodeNext — relative imports end in `.js`), `node:http` server
  (`src/server.ts` `createApp(store)`; see the `/health` route for the pattern), `pg` for
  Postgres, Zod for validation, Vitest for tests.
- **Injectable Store** (`src/db/store.ts`): `Store` interface with `InMemoryStore` (hermetic,
  used by unit tests + CI) and `PgStore` (runtime, talks to Postgres). New persistence goes
  through both, kept behaviourally identical (including deterministic tie-breaks).
- **API-only — there is no browser UI.** "Browser-driving" functional tests
  (`/testing:general:test-review-general`, jig B4/B5, back-gate D4) therefore drive the HTTP
  surface through a real client with end-to-end assertions on full flows (create→read→verify,
  error/clamp paths) — NOT a single curl smoke.

## Commands (from repo root)

```bash
npm ci
npm run typecheck        # tsc --noEmit
npm test                 # vitest run
npm run build            # tsc -p tsconfig.json
npm run check:migrations # migration-filename hygiene
npm run migrate          # apply pending SQL to $DATABASE_URL
PORT=<p> npm run dev     # serve a preview on <p> (tsx src/index.ts); NO secret-manager wrapping
```

There is no `doppler`/`infisical`/`vault` wrapping — `npm run dev` is already the
non-injecting dev command. There are **no external-write env keys** to neutralize.

## Deploy & CI

- **Merging a PR to `main` IS the deploy** (this is a sandbox; there is no separate deploy
  step for code). `main` is protected by the `protect-main` ruleset: PRs required,
  non-fast-forward, no deletion, and two **required status checks matched by name** —
  `typecheck · test · build` and `migration hygiene` (`.github/workflows/ci.yml`).
- **Prod is an OWNED, THROWAWAY SANDBOX — not a live customer.** So the POST-DEPLOY PROD TEST
  (back-gate D4) runs the **full** functional pass on prod, not the read-only smoke a live
  customer would require.

## Databases & migrations

- **Migrations deploy SEPARATELY from code** (a merge ships the app, not the SQL) →
  every schema change must be **expand/contract safe**: new code works on the old schema and
  old code on the new one. Migration path: `supabase/migrations/**`, named
  `YYYYMMDDHHMMSS_snake_case.sql`. Applied-versions registry: the `schema_migrations` table.
  No version prefix has collided yet.
- **"Prod" DB:** the `mkv2-prod` Docker container (`docker-compose.yml`), reachable at
  `postgres://mkv2:mkv2@127.0.0.1:5500/mkv2`. ONLY the careful installer (jig back-half)
  applies migrations here; wave agents never touch it.
- **Staging / dry-run DB:** a fresh throwaway via `scripts/wave-db.sh <label> <port>` (prints
  the `DATABASE_URL`; container auto-removes). The migration safety gate dry-runs here first.
- **Per-wave isolation:** each build phase gets its own throwaway `mkv2-wave-<label>` DB on a
  distinct port (5511, 5512, …) via the same script + its own worktree. No RLS, no table
  grants to manage — plain Postgres owned by the `mkv2` role.

## Codex constraint

The codex companion dies with a git worktree as cwd (`failed to load configuration`).
Dispatch every Codex job (G0 / G1 / G2 / jig B2 re-review) from the **main checkout**
targeting `main...<branch>`.

## Playwright

No Playwright MCP is wired in this environment. Since the app is API-only, functional gates
drive the HTTP surface directly (real client, full-flow assertions) rather than a browser.
