#!/usr/bin/env node
// Migration hygiene: filename format + duplicate version-prefix check.
// Mirrors tradegames CI so MK V2's migration gate has a real check to read.
import { readdirSync } from "node:fs";
import { join } from "node:path";

const dir = join(process.cwd(), "supabase", "migrations");
const files = readdirSync(dir).filter((f) => f.endsWith(".sql"));
const format = /^\d{8}(\d{6})?_[a-z0-9_]+\.sql$/;
const prefixes = new Map();
let bad = 0;

for (const f of files) {
  if (!format.test(f)) {
    console.error(`✗ bad filename: ${f}`);
    bad++;
    continue;
  }
  const prefix = f.match(/^(\d+)_/)[1];
  if (prefixes.has(prefix)) {
    console.error(`✗ duplicate version prefix ${prefix}: ${prefixes.get(prefix)} + ${f}`);
    bad++;
  } else {
    prefixes.set(prefix, f);
  }
}

if (bad > 0) {
  console.error(`migration hygiene: ${bad} problem(s)`);
  process.exit(1);
}
console.log(`migration hygiene: ${files.length} file(s) OK`);
