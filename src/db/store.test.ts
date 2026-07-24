import { describe, it, expect } from "vitest";
import { InMemoryStore } from "./store.js";

describe("InMemoryStore.topScores", () => {
  it("orders by points DESC", async () => {
    const store = new InMemoryStore();
    const p = await store.addPlayer("alice");
    await store.addScore(p.id, 10);
    await store.addScore(p.id, 30);
    await store.addScore(p.id, 20);

    const top = await store.topScores(10);
    expect(top.map((s) => s.points)).toEqual([30, 20, 10]);
  });

  it("tie-breaks equal points by created_at ASC (older first)", async () => {
    const store = new InMemoryStore();
    const p = await store.addPlayer("bob");
    const first = await store.addScore(p.id, 50);
    const second = await store.addScore(p.id, 50);
    const third = await store.addScore(p.id, 50);

    const top = await store.topScores(10);
    expect(top.map((s) => s.id)).toEqual([first.id, second.id, third.id]);
    for (let i = 1; i < top.length; i++) {
      expect(top[i - 1].createdAt.getTime()).toBeLessThan(
        top[i].createdAt.getTime(),
      );
    }
  });

  it("respects the limit", async () => {
    const store = new InMemoryStore();
    const p = await store.addPlayer("carol");
    for (const pts of [5, 15, 25, 35]) await store.addScore(p.id, pts);

    const top = await store.topScores(2);
    expect(top.map((s) => s.points)).toEqual([35, 25]);
  });

  it("returns empty when there are no scores", async () => {
    const store = new InMemoryStore();
    expect(await store.topScores(10)).toEqual([]);
  });
});
