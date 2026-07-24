#!/usr/bin/env node
// Apply pending migrations (by version prefix) to DATABASE_URL, in order.
// Records applied versions in schema_migrations, transactional per file.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL required");
  process.exit(2);
}

const dir = join(process.cwd(), "supabase", "migrations");
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

const client = new pg.Client({ connectionString: url });
await client.connect();
await client.query(
  `create table if not exists schema_migrations (
     version text primary key,
     applied_at timestamptz not null default now()
   )`,
);

const { rows } = await client.query("select version from schema_migrations");
const applied = new Set(rows.map((r) => r.version));

for (const f of files) {
  const version = f.match(/^(\d+)_/)[1];
  if (applied.has(version)) {
    console.log(`= skip ${f}`);
    continue;
  }
  const sql = readFileSync(join(dir, f), "utf8");
  console.log(`+ apply ${f}`);
  await client.query("begin");
  try {
    await client.query(sql);
    await client.query(
      "insert into schema_migrations(version) values($1) on conflict do nothing",
      [version],
    );
    await client.query("commit");
  } catch (e) {
    await client.query("rollback");
    console.error(`✗ ${f}: ${e.message}`);
    await client.end();
    process.exit(1);
  }
}

await client.end();
console.log("migrations up to date");
