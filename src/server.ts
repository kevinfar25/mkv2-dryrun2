import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Store } from "./db/store.js";
import { clampLimit, getLeaderboard } from "./features/leaderboard/leaderboard.js";
import { scoreInputSchema } from "./features/scores/scores.js";

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

// Typed error for an over-limit request body. The route maps this to a
// controlled 400 rather than letting a huge payload buffer into memory OR
// tearing the socket down (a reset the client sees as a network failure).
class BodyTooLargeError extends Error {
  constructor() {
    super("body_too_large");
    this.name = "BodyTooLargeError";
  }
}

// Read the full request body as UTF-8 text, bounded so a client can't stream an
// unbounded payload into memory. The MOMENT the byte budget is exceeded we STOP
// reading (remove the data listener + pause the stream) and reject with
// BodyTooLargeError right away — we do NOT wait for `end`. This defeats a
// slow/malicious client that streams past the limit then stalls (never sending
// `end`), which under an end-only check would keep the request open indefinitely
// (slow-drain resource exhaustion). The route maps the rejection to a 400 and then
// destroys the request to tear the connection down — teardown happens AFTER the
// 400 is written (destroying the request here would kill the shared socket before
// the response could be flushed).
const MAX_BODY_BYTES = 1_000_000;
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const onData = (c: Buffer) => {
      if (settled) return;
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        settled = true;
        chunks.length = 0; // release what we buffered.
        req.removeListener("data", onData);
        req.pause(); // stop pulling bytes; the route will destroy after the 400.
        reject(new BodyTooLargeError());
        return;
      }
      chunks.push(c);
    };
    req.on("data", onData);
    req.on("end", () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
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
      if (req.method === "POST" && rawPath === "/scores") {
        let parsed: unknown;
        try {
          parsed = JSON.parse(await readBody(req));
        } catch (err) {
          if (err instanceof BodyTooLargeError) {
            // Tear the connection down ONCE the 400 has flushed — destroying the
            // shared socket earlier would reset the response the client is meant
            // to read (the "no socket reset" invariant). Waiting for `finish`
            // guarantees the 400 is on the wire before we stop a stalled client
            // from holding the (un-drained) request open.
            res.once("finish", () => req.destroy());
            json(res, 400, { error: "body_too_large" });
            return;
          }
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
