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
      // Only origin-form targets (starting with "/") are normalized: a
      // slash-less target like `GET leaderboard HTTP/1.1` does NOT throw on
      // parse — it normalizes to pathname "/leaderboard" and would wrongly
      // match. Guarding on the leading slash makes /leaderboard consistent
      // with /health's exact match, so a slash-less or missing target leaves
      // url=null and falls through to 404 rather than a spurious 200.
      let url: URL | null = null;
      if (req.url && req.url.startsWith("/")) {
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
