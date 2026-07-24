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
// places, half-away-from-zero, computed with EXACT integer (BigInt) arithmetic.
// The naive `Math.round((sum / count) * 100) / 100` is float-wrong (e.g. 199×1 +
// 2 must average 1.01 but returns 1) and Math.round biases half toward +Infinity
// so negatives don't round symmetrically. We instead round `sum*100/count` to the
// nearest integer via exact integer quotient/remainder, ties going away from zero
// (so 1.005 -> 1.01 and -1.005 -> -1.01), then divide by 100. We accumulate the
// sum and do the rounding in BigInt so precision holds even when `sum*100` exceeds
// Number.MAX_SAFE_INTEGER (reachable with tens of thousands of near-int32 scores).
// The rounded result (≈ average*100) is back within safe-integer range.
export function computeStats(points: number[]): PlayerStats {
  if (points.length === 0) {
    return { best: null, count: 0, average: null };
  }
  const count = points.length;
  // `best` and `sum` via a single plain loop — NO spread. `Math.max(...points)`
  // throws RangeError (call-stack overflow) on very large arrays, and a BigInt
  // sum keeps precision beyond Number.MAX_SAFE_INTEGER.
  let best = points[0];
  let sum = 0n;
  for (const p of points) {
    if (p > best) best = p;
    sum += BigInt(p);
  }
  const average = Number(roundHalfAwayFromZero(sum * 100n, BigInt(count))) / 100;
  return { best, count, average };
}

// Integer division `numerator / denominator` (denominator > 0) rounded to the
// nearest integer with ties broken AWAY FROM ZERO. BigInt division truncates
// toward zero and `%` yields a remainder with the numerator's sign, so positive
// and negative numerators round symmetrically with no floating-point error.
function roundHalfAwayFromZero(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator; // same sign as numerator
  const absRemainder = remainder < 0n ? -remainder : remainder;
  if (absRemainder * 2n >= denominator) {
    return quotient + (numerator >= 0n ? 1n : -1n);
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
