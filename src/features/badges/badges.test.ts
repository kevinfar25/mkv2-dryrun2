import { describe, it, expect } from "vitest";
import {
  computeBadges,
  CENTURY_THRESHOLD,
  HOT_STREAK_LENGTH,
  type Badge,
} from "./badges.js";

describe("computeBadges", () => {
  describe("empty input", () => {
    it("returns no badges for an empty array", () => {
      expect(computeBadges([])).toEqual([]);
    });
  });

  describe("first-blood", () => {
    it("is earned by a single score", () => {
      expect(computeBadges([1])).toContain<Badge>("first-blood");
    });

    it("is earned even by a single score of zero", () => {
      expect(computeBadges([0])).toEqual(["first-blood"]);
    });
  });

  describe("century", () => {
    it("is earned at exactly the threshold", () => {
      expect(computeBadges([CENTURY_THRESHOLD])).toContain<Badge>("century");
    });

    it("is NOT earned just below the threshold", () => {
      expect(computeBadges([CENTURY_THRESHOLD - 1])).not.toContain<Badge>(
        "century",
      );
    });

    it("is earned when any score in the history qualifies", () => {
      expect(computeBadges([5, 200, 3])).toContain<Badge>("century");
    });

    it("is NOT earned when no score qualifies", () => {
      expect(computeBadges([1, 2, 3])).not.toContain<Badge>("century");
    });
  });

  describe("hot-streak", () => {
    it("is earned by exactly HOT_STREAK_LENGTH strictly-increasing scores", () => {
      // e.g. [1, 2, 3] when HOT_STREAK_LENGTH === 3
      const scores = Array.from({ length: HOT_STREAK_LENGTH }, (_, i) => i);
      expect(computeBadges(scores)).toContain<Badge>("hot-streak");
    });

    it("is NOT earned by one fewer increasing score", () => {
      const scores = Array.from(
        { length: HOT_STREAK_LENGTH - 1 },
        (_, i) => i,
      );
      expect(computeBadges(scores)).not.toContain<Badge>("hot-streak");
    });

    it("resets the run on a non-increasing score, then earns on a later run", () => {
      // increasing pair, drop, then a full increasing run
      expect(computeBadges([1, 2, 0, 1, 2, 3])).toContain<Badge>("hot-streak");
    });

    it("resets the run and never reaches the required length", () => {
      // never three-in-a-row increasing
      expect(computeBadges([1, 2, 1, 2, 1, 2])).not.toContain<Badge>(
        "hot-streak",
      );
    });

    it("is NOT earned when scores only ever decrease or stay equal", () => {
      expect(computeBadges([5, 5, 4, 4, 3])).not.toContain<Badge>("hot-streak");
    });

    it("treats equal consecutive scores as a reset (not strictly increasing)", () => {
      expect(computeBadges([1, 2, 2, 3])).not.toContain<Badge>("hot-streak");
    });

    it("finds a streak that starts partway through the array", () => {
      expect(computeBadges([9, 8, 1, 2, 3, 4])).toContain<Badge>("hot-streak");
    });
  });

  describe("stable ordering and combinations", () => {
    it("returns badges in the documented order", () => {
      // qualifies for all three: non-empty, has >=100, has increasing run
      expect(computeBadges([50, 100, 150])).toEqual([
        "first-blood",
        "century",
        "hot-streak",
      ]);
    });

    it("returns only first-blood for a flat single-low score", () => {
      expect(computeBadges([10])).toEqual(["first-blood"]);
    });

    it("can earn century without hot-streak", () => {
      expect(computeBadges([500, 1])).toEqual(["first-blood", "century"]);
    });

    it("can earn hot-streak without century", () => {
      expect(computeBadges([1, 2, 3])).toEqual(["first-blood", "hot-streak"]);
    });
  });
});
