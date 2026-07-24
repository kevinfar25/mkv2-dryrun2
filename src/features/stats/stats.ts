import type { Store } from "../../db/store.js";

// Aggregate stats for a single player, computed from that player's points.
export type PlayerStats = {
  best: number | null;
  count: number;
  average: number | null;
};

// Compute best score, count, and average from a player's points.
//
// Empty case is explicit: a player with NO scores has no best and no average,
// so both are `null` (not 0 — 0 would be indistinguishable from a real zero
// score and would misreport an average). count is 0.
//
// `average` rounding: the mean of the (integer) points, rounded to two decimal
// places (round-half-up via Math.round on the scaled value). Points are int32,
// count >= 1 here, so the intermediate sum stays well within safe-integer range.
export function computeStats(points: number[]): PlayerStats {
  if (points.length === 0) {
    return { best: null, count: 0, average: null };
  }
  const count = points.length;
  const best = Math.max(...points);
  const sum = points.reduce((acc, p) => acc + p, 0);
  const average = Math.round((sum / count) * 100) / 100;
  return { best, count, average };
}

// Fetch a player's points from the store and reduce them to aggregate stats.
export async function getPlayerStats(
  store: Store,
  playerId: string,
): Promise<PlayerStats> {
  const points = await store.scoresForPlayer(playerId);
  return computeStats(points);
}
