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
// places, half-away-from-zero, computed with INTEGER arithmetic. The naive
// `Math.round((sum / count) * 100) / 100` is float-wrong (e.g. 199×1 + 2 must
// average 1.01 but returns 1) and Math.round biases half toward +Infinity so
// negatives don't round symmetrically. Instead we round `sum*100/count` to the
// nearest integer via exact integer quotient/remainder, ties going away from
// zero (so 1.005 -> 1.01 and -1.005 -> -1.01), then divide by 100. Points are
// int32 and count >= 1 here, so sum*100 stays within safe-integer range.
export function computeStats(points: number[]): PlayerStats {
  if (points.length === 0) {
    return { best: null, count: 0, average: null };
  }
  const count = points.length;
  const best = Math.max(...points);
  const sum = points.reduce((acc, p) => acc + p, 0);
  const average = roundHalfAwayFromZero(sum * 100, count) / 100;
  return { best, count, average };
}

// Integer division `numerator / denominator` (denominator > 0) rounded to the
// nearest integer with ties broken AWAY FROM ZERO. Uses exact integer remainder
// so there is no floating-point rounding, and treats positive and negative
// numerators symmetrically.
function roundHalfAwayFromZero(numerator: number, denominator: number): number {
  const quotient = Math.trunc(numerator / denominator);
  const remainder = numerator % denominator; // same sign as numerator
  if (Math.abs(remainder) * 2 >= denominator) {
    return quotient + (numerator >= 0 ? 1 : -1);
  }
  return quotient;
}

// Fetch a player's points from the store and reduce them to aggregate stats.
export async function getPlayerStats(
  store: Store,
  playerId: string,
): Promise<PlayerStats> {
  const points = await store.scoresForPlayer(playerId);
  return computeStats(points);
}
