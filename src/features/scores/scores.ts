import { z } from "zod";
import { INT32_MIN, INT32_MAX } from "../../db/store.js";

// Validation for POST /scores request bodies. Mirrors the store's `addScore`
// contract so the HTTP layer rejects bad input BEFORE hitting persistence:
//   - playerId: a non-empty string (uuids from PgStore are strings; the
//     in-memory store uses `p1`-style ids — both are non-empty strings, so we
//     require a non-empty string rather than a strict uuid to keep the two
//     stores interchangeable). We do NOT `.trim()` it: ids are EXACT/opaque to
//     the store, so " p1 " must reach the store unchanged (and 400 as an
//     unknown_player) rather than be silently rewritten to "p1".
//   - points: an integer within the store's accepted int32 range
//     [INT32_MIN, INT32_MAX] — identical bound to assertValidPoints, so a body
//     that passes this schema will never trip the store's own guard.
// `strictObject` so an unknown key (e.g. a smuggled `admin: true`) is REJECTED
// rather than silently dropped — the HTTP layer must 400 such a body, not 201.
export const scoreInputSchema = z.strictObject({
  playerId: z.string().min(1),
  points: z.number().int().min(INT32_MIN).max(INT32_MAX),
});

export type ScoreInput = z.infer<typeof scoreInputSchema>;
