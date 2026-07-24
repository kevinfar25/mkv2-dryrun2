/**
 * Badge computation — a PURE, deterministic module.
 *
 * `computeBadges(scores)` inspects a list of numeric scores and awards badges.
 * It has no side effects, reads no clock/DB, and always returns badges in a
 * fixed, deterministic order (the order they are declared in `BADGE_RULES`).
 *
 * Documented thresholds:
 *  - 'first-blood': awarded when there is at least one score (scores.length >= 1).
 *  - 'century':     awarded when any single score is >= 100.
 *  - 'hot-streak':  awarded when there are at least 3 scores each >= 50
 *                   (a *run* is not required — any 3 qualifying scores anywhere
 *                   in the list count). HOT_STREAK_MIN_COUNT/HOT_STREAK_MIN_SCORE
 *                   below make the threshold explicit and testable.
 */

export type BadgeId = "first-blood" | "century" | "hot-streak";

export interface Badge {
  id: BadgeId;
  label: string;
}

/** A score at or above this counts toward a hot streak. */
export const HOT_STREAK_MIN_SCORE = 50;
/** This many qualifying scores are required for a hot streak. */
export const HOT_STREAK_MIN_COUNT = 3;
/** A single score at or above this earns the century badge. */
export const CENTURY_MIN_SCORE = 100;

interface BadgeRule {
  id: BadgeId;
  label: string;
  earned: (scores: number[]) => boolean;
}

// Declaration order here defines the deterministic output order.
const BADGE_RULES: readonly BadgeRule[] = [
  {
    id: "first-blood",
    label: "First Blood",
    earned: (scores) => scores.length >= 1,
  },
  {
    id: "century",
    label: "Century",
    earned: (scores) => scores.some((s) => s >= CENTURY_MIN_SCORE),
  },
  {
    id: "hot-streak",
    label: "Hot Streak",
    earned: (scores) =>
      scores.filter((s) => s >= HOT_STREAK_MIN_SCORE).length >=
      HOT_STREAK_MIN_COUNT,
  },
];

/**
 * Compute the badges earned by `scores`.
 *
 * Pure: the input array is not mutated and the result depends only on `scores`.
 * Deterministic: badges are returned in `BADGE_RULES` declaration order.
 */
export function computeBadges(scores: number[]): Badge[] {
  return BADGE_RULES.filter((rule) => rule.earned(scores)).map(
    ({ id, label }) => ({ id, label }),
  );
}
