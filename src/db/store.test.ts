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
    // Older-first: earlier inserts win via created_at, then id as the final key.
    expect(top.map((s) => s.id)).toEqual([first.id, second.id, third.id]);
  });

  it("breaks equal (points, created_at) deterministically by id ASC", async () => {
    const store = new InMemoryStore();
    const p = await store.addPlayer("dave");
    // Force identical points AND created_at so only the id tie-break decides.
    const a = await store.addScore(p.id, 50);
    const b = await store.addScore(p.id, 50);
    const when = new Date();
    a.createdAt = when;
    b.createdAt = when;

    const top = await store.topScores(10);
    const [firstId, secondId] = [a.id, b.id].sort();
    expect(top.map((s) => s.id)).toEqual([firstId, secondId]);
  });

  it("respects the limit", async () => {
    const store = new InMemoryStore();
    const p = await store.addPlayer("carol");
    for (const pts of [5, 15, 25, 35]) await store.addScore(p.id, pts);

    const top = await store.topScores(2);
    expect(top.map((s) => s.points)).toEqual([35, 25]);
  });

  it("clamps limit = 0 to an empty result", async () => {
    const store = new InMemoryStore();
    const p = await store.addPlayer("erin");
    await store.addScore(p.id, 5);
    expect(await store.topScores(0)).toEqual([]);
  });

  it("clamps a negative limit to 0 (no 'all but last' behaviour)", async () => {
    const store = new InMemoryStore();
    const p = await store.addPlayer("frank");
    for (const pts of [5, 15, 25]) await store.addScore(p.id, pts);
    expect(await store.topScores(-1)).toEqual([]);
  });

  it("returns all rows when limit exceeds the count", async () => {
    const store = new InMemoryStore();
    const p = await store.addPlayer("grace");
    for (const pts of [5, 15, 25]) await store.addScore(p.id, pts);

    const top = await store.topScores(100);
    expect(top.map((s) => s.points)).toEqual([25, 15, 5]);
  });

  it("returns empty when there are no scores", async () => {
    const store = new InMemoryStore();
    expect(await store.topScores(10)).toEqual([]);
  });
});

describe("InMemoryStore.addScore", () => {
  it("rejects an unknown playerId (mirrors the FK)", async () => {
    const store = new InMemoryStore();
    await expect(store.addScore("nope", 10)).rejects.toThrow();
  });
});
