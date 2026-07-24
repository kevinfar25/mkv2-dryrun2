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
      // GET /leaderboard?limit= — top scores, ranked.
      // Exact raw-path match: split the origin-form target on "?" and require the
      // path part to be EXACTLY "/leaderboard" — no URL normalization, so
      // dot-segment (/x/../leaderboard), percent-encoded (/%2e%2e/leaderboard),
      // //authority, and absolute-form aliases all fall through to 404. Only the
      // query string is then parsed (for ?limit=). Consistent with /health's exact match.
      const rawTarget = req.url ?? "";
      const qIdx = rawTarget.indexOf("?");
      const rawPath = qIdx === -1 ? rawTarget : rawTarget.slice(0, qIdx);
      if (req.method === "GET" && rawPath === "/leaderboard") {
        const query = qIdx === -1 ? "" : rawTarget.slice(qIdx + 1);
        const params = new URLSearchParams(query);
        const limit = clampLimit(params.get("limit"));
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
