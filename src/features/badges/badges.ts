/**
 * Pure badge computation.
 *
 * Given a chronological list of numeric scores, derive the set of earned
 * badges. This module is intentionally dependency-free: no DB, no I/O, no
 * clock — the same input always yields the same output.
 */

/** A badge a player can earn from their score history. */
export type Badge = "first-blood" | "century" | "hot-streak";

/**
 * Number of consecutive strictly-increasing scores required to earn
 * `hot-streak`. A run of `HOT_STREAK_LENGTH` scores where each is greater
 * than the one before it qualifies.
 */
export const HOT_STREAK_LENGTH = 3;

/** Minimum single score required to earn `century`. */
export const CENTURY_THRESHOLD = 100;

/**
 * Compute the badges earned for a chronological array of scores.
 *
 * Thresholds (documented, deterministic):
 * - `first-blood`: at least one score was recorded (array is non-empty).
 * - `century`:     any single score is >= {@link CENTURY_THRESHOLD} (100).
 * - `hot-streak`:  there exists a run of {@link HOT_STREAK_LENGTH} (3)
 *                  consecutive, strictly-increasing scores.
 *
 * Badges are returned in a stable order (first-blood, century, hot-streak).
 *
 * @param scores chronological scores; index 0 is the oldest.
 */
export function computeBadges(scores: number[]): Badge[] {
  const badges: Badge[] = [];

  if (scores.length === 0) {
    return badges;
  }

  // first-blood: any score at all.
  badges.push("first-blood");

  // century: at least one score meets the threshold.
  if (scores.some((s) => s >= CENTURY_THRESHOLD)) {
    badges.push("century");
  }

  // hot-streak: a run of HOT_STREAK_LENGTH strictly-increasing scores.
  let run = 1;
  let hasStreak = false;
  for (let i = 1; i < scores.length; i++) {
    if (scores[i] > scores[i - 1]) {
      run++;
      if (run >= HOT_STREAK_LENGTH) {
        hasStreak = true;
        break;
      }
    } else {
      run = 1;
    }
  }
  if (hasStreak) {
    badges.push("hot-streak");
  }

  return badges;
}
