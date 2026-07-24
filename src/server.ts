import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Store } from "./db/store.js";
import { clampLimit, getLeaderboard } from "./features/leaderboard/leaderboard.js";
import { scoreInputSchema } from "./features/scores/scores.js";

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

// Read the full request body as UTF-8 text, bounded so a client can't stream an
// unbounded payload into memory.
const MAX_BODY_BYTES = 1_000_000;
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("payload too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
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
      // POST /scores — validate a { playerId, points } body and persist. Invalid
      // JSON or a body that fails the schema returns 400 (never 500); an unknown
      // player (rejected by the store's FK contract) is also a client error.
      if (req.method === "POST" && url?.pathname === "/scores") {
        let parsed: unknown;
        try {
          parsed = JSON.parse(await readBody(req));
        } catch {
          json(res, 400, { error: "invalid_json" });
          return;
        }
        const result = scoreInputSchema.safeParse(parsed);
        if (!result.success) {
          json(res, 400, { error: "invalid_body", details: result.error.issues });
          return;
        }
        const { playerId, points } = result.data;
        try {
          const score = await store.addScore(playerId, points);
          json(res, 201, {
            id: score.id,
            playerId: score.playerId,
            points: score.points,
            createdAt: score.createdAt.toISOString(),
          });
        } catch (err) {
          // The store rejects unknown players (FK contract) — a client error.
          if (err instanceof Error && err.message.startsWith("unknown player")) {
            json(res, 400, { error: "unknown_player" });
            return;
          }
          throw err;
        }
        return;
      }
      json(res, 404, { error: "not_found" });
    } catch {
      json(res, 500, { error: "internal" });
    }
  });
}
