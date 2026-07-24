import type { Store, Score } from "../../db/store.js";

// HTTP-layer clamp for the `?limit=` query param. The store method is robust
// (normalizeLimit tolerates anything), but the API must not let a client ask
// for an unbounded / absurd number of rows: parse the raw string, and clamp to
// [1, LIMIT_MAX] with a sensible default when absent or unparseable.
export const LIMIT_DEFAULT = 10;
export const LIMIT_MAX = 100;

// Parse a raw query-string value into the effective store limit. Anything that
// isn't a finite positive integer (absent, empty, NaN, negative, zero, float,
// huge) collapses to a safe value: absent/invalid -> default; too-large -> cap;
// too-small (<=0) -> 1. Always returns a finite int in [1, LIMIT_MAX].
export function clampLimit(raw: string | null | undefined): number {
  // Trim first so whitespace-only values ("%20") are treated as absent rather
  // than coerced to 0 by Number(" ") -> 0.
  const text = raw?.trim();
  if (!text) return LIMIT_DEFAULT;
  const n = Number(text);
  if (!Number.isFinite(n)) return LIMIT_DEFAULT;
  const i = Math.trunc(n);
  if (i < 1) return 1;
  if (i > LIMIT_MAX) return LIMIT_MAX;
  return i;
}

export type LeaderboardRow = {
  id: string;
  playerId: string;
  points: number;
  createdAt: string;
};

export type LeaderboardResponse = {
  limit: number;
  scores: LeaderboardRow[];
};

// Fetch the top `limit` scores (already clamped) and shape them for JSON.
export async function getLeaderboard(
  store: Store,
  limit: number,
): Promise<LeaderboardResponse> {
  const scores = await store.topScores(limit);
  return {
    limit,
    scores: scores.map((s: Score) => ({
      id: s.id,
      playerId: s.playerId,
      points: s.points,
      createdAt: s.createdAt.toISOString(),
    })),
  };
}
