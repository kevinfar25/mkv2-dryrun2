import { createApp } from "./server.js";
import { InMemoryStore, PgStore, type Store } from "./db/store.js";

const port = Number(process.env.PORT ?? 3000);

// DATABASE_URL present -> talk to a real Postgres (wave DB or prod). Absent -> in-memory.
const store: Store = process.env.DATABASE_URL
  ? new PgStore(process.env.DATABASE_URL)
  : new InMemoryStore();

createApp(store).listen(port, () => {
  console.log(`mkv2-dryrun listening on :${port}`);
});
