import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Store } from "./db/store.js";

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
      json(res, 404, { error: "not_found" });
    } catch {
      json(res, 500, { error: "internal" });
    }
  });
}
