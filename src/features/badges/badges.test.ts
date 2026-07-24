import { describe, it, expect } from "vitest";
import {
  computeBadges,
  CENTURY_MIN_SCORE,
  HOT_STREAK_MIN_SCORE,
  HOT_STREAK_MIN_COUNT,
  type BadgeId,
} from "./badges.js";

const ids = (scores: number[]): BadgeId[] =>
  computeBadges(scores).map((b) => b.id);

describe("computeBadges", () => {
  it("awards nothing for an empty array", () => {
    expect(computeBadges([])).toEqual([]);
  });

  it("awards only first-blood for a single low score", () => {
    expect(ids([1])).toEqual(["first-blood"]);
  });

  it("awards first-blood at exactly one score", () => {
    expect(ids([0])).toEqual(["first-blood"]);
  });

  describe("century (>= 100)", () => {
    it("does not award just below the boundary", () => {
      expect(ids([CENTURY_MIN_SCORE - 1])).toEqual(["first-blood"]);
    });

    it("awards at exactly the boundary", () => {
      expect(ids([CENTURY_MIN_SCORE])).toEqual(["first-blood", "century"]);
    });

    it("awards above the boundary", () => {
      expect(ids([CENTURY_MIN_SCORE + 500])).toEqual([
        "first-blood",
        "century",
      ]);
    });

    it("awards when any single score qualifies", () => {
      expect(ids([1, 2, CENTURY_MIN_SCORE])).toContain("century");
    });
  });

  describe("hot-streak (>= 3 scores each >= 50)", () => {
    it("does not award with too few qualifying scores", () => {
      const scores = Array(HOT_STREAK_MIN_COUNT - 1).fill(HOT_STREAK_MIN_SCORE);
      expect(ids(scores)).not.toContain("hot-streak");
    });

    it("awards at exactly the count/score boundary", () => {
      const scores = Array(HOT_STREAK_MIN_COUNT).fill(HOT_STREAK_MIN_SCORE);
      expect(ids(scores)).toContain("hot-streak");
    });

    it("does not count scores just below the score threshold", () => {
      const scores = Array(HOT_STREAK_MIN_COUNT).fill(HOT_STREAK_MIN_SCORE - 1);
      expect(ids(scores)).not.toContain("hot-streak");
    });

    it("counts qualifying scores anywhere (no run required)", () => {
      // 50, 1, 50, 1, 50 => three qualifying scores, not contiguous.
      expect(ids([50, 1, 50, 1, 50])).toContain("hot-streak");
    });

    it("awards with more than the minimum qualifying scores", () => {
      expect(ids([50, 60, 70, 80])).toContain("hot-streak");
    });
  });

  it("awards all badges when every threshold is met", () => {
    expect(ids([100, 60, 55, 51])).toEqual([
      "first-blood",
      "century",
      "hot-streak",
    ]);
  });

  it("returns badges in deterministic declaration order", () => {
    // Same multiset, different input order => identical output order.
    expect(ids([51, 100, 55, 60])).toEqual(ids([60, 55, 100, 51]));
  });

  it("includes a human label for each badge", () => {
    for (const badge of computeBadges([100, 50, 50, 50])) {
      expect(badge.label.length).toBeGreaterThan(0);
    }
  });

  it("does not mutate the input array", () => {
    const input = [100, 50, 50, 50];
    const copy = [...input];
    computeBadges(input);
    expect(input).toEqual(copy);
  });

  it("handles negative scores (still first-blood only)", () => {
    expect(ids([-5])).toEqual(["first-blood"]);
  });
});
