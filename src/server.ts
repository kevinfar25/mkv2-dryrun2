import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Store } from "./db/store.js";
import { clampLimit, getLeaderboard } from "./features/leaderboard/leaderboard.js";

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

/**
 * The HTTP surface. Baseline exposes GET /health only; feature phases add routes.
 * The Store is injected so tests can run hermetically against InMemoryStore.
 */
export function createApp(store: Store) {
  return createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      if (req.method === "GET" && req.url === "/health") {
        const ok = await store.health();
        json(res, ok ? 200 : 503, { status: ok ? "ok" : "degraded" });
        return;
      }
      // GET /leaderboard?limit= — top scores, ranked. Parse against a dummy
      // base so a relative req.url yields a URL we can read query params from.
      // Only single-slash origin-form targets are eligible: req.url must start
      // with exactly ONE "/" (not "//"). An authority-relative target like
      // `//evil.com/leaderboard` also starts with "/", but parses with
      // host=evil.com and pathname="/leaderboard" — it would wrongly match the
      // route. Absolute-form (`http://localhost/leaderboard`, no leading
      // slash) and slash-less/missing targets are likewise rejected. All of
      // these leave url=null and fall through to 404 (path-confusion defense),
      // keeping /leaderboard consistent with /health's exact match.
      let url: URL | null = null;
      if (req.url && /^\/(?!\/)/.test(req.url)) {
        try {
          url = new URL(req.url, "http://localhost");
        } catch {
          url = null;
        }
      }
      if (req.method === "GET" && url?.pathname === "/leaderboard") {
        const limit = clampLimit(url.searchParams.get("limit"));
        const body = await getLeaderboard(store, limit);
        json(res, 200, body);
        return;
      }
      json(res, 404, { error: "not_found" });
    } catch {
      json(res, 500, { error: "internal" });
    }
  });
}
