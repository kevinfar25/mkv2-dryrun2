import { describe, it, expect } from "vitest";
import { InMemoryStore } from "./store.js";

// Helper: create N players and return their ids, so scores reference real
// players (mirrors the PgStore FK contract).
async function makePlayers(store: InMemoryStore, count: number): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const p = await store.addPlayer(`player-${i}`);
    ids.push(p.id);
  }
  return ids;
}

describe("InMemoryStore scores", () => {
  it("orders by points descending", async () => {
    const store = new InMemoryStore();
    const [a, b, c] = await makePlayers(store, 3);
    await store.addScore(a, 10);
    await store.addScore(b, 30);
    await store.addScore(c, 20);

    const top = await store.topScores(10);
    expect(top.map((s) => s.points)).toEqual([30, 20, 10]);
    expect(top.map((s) => s.playerId)).toEqual([b, c, a]);
  });

  it("tie-breaks equal points by created_at ascending (earliest first)", async () => {
    const store = new InMemoryStore();
    const [a, b, c] = await makePlayers(store, 3);
    const first = await store.addScore(a, 50);
    const second = await store.addScore(b, 50);
    const third = await store.addScore(c, 50);

    const top = await store.topScores(10);
    expect(top.map((s) => s.id)).toEqual([first.id, second.id, third.id]);
    // created_at must be strictly increasing across insertions.
    expect(top[0].createdAt.getTime()).toBeLessThan(top[1].createdAt.getTime());
    expect(top[1].createdAt.getTime()).toBeLessThan(top[2].createdAt.getTime());
  });

  it("combines points and tie-break ordering", async () => {
    const store = new InMemoryStore();
    const [p1, p2, p3, p4] = await makePlayers(store, 4);
    const a = await store.addScore(p1, 100);
    const b = await store.addScore(p2, 100); // same points, later -> after a
    await store.addScore(p3, 40);
    const d = await store.addScore(p4, 200);

    const top = await store.topScores(10);
    expect(top.map((s) => s.id)).toEqual([d.id, a.id, b.id, top[3].id]);
    expect(top.map((s) => s.points)).toEqual([200, 100, 100, 40]);
  });

  it("honours the limit", async () => {
    const store = new InMemoryStore();
    const [a, b, c] = await makePlayers(store, 3);
    await store.addScore(a, 1);
    await store.addScore(b, 2);
    await store.addScore(c, 3);

    expect(await store.topScores(2)).toHaveLength(2);
    expect((await store.topScores(2)).map((s) => s.points)).toEqual([3, 2]);
  });

  it("returns an empty array when there are no scores", async () => {
    const store = new InMemoryStore();
    expect(await store.topScores(10)).toEqual([]);
  });

  it("returns an empty array for a zero or negative limit", async () => {
    const store = new InMemoryStore();
    const [a] = await makePlayers(store, 1);
    await store.addScore(a, 5);
    expect(await store.topScores(0)).toEqual([]);
    expect(await store.topScores(-3)).toEqual([]);
  });

  it("returns all rows for undefined/non-finite limits (documented contract)", async () => {
    const store = new InMemoryStore();
    const [a, b, c] = await makePlayers(store, 3);
    await store.addScore(a, 1);
    await store.addScore(b, 2);
    await store.addScore(c, 3);

    // undefined / NaN / Infinity all mean "no limit" -> all rows.
    expect(await store.topScores(undefined as unknown as number)).toHaveLength(3);
    expect(await store.topScores(NaN)).toHaveLength(3);
    expect(await store.topScores(Infinity)).toHaveLength(3);
  });

  it("truncates fractional limits", async () => {
    const store = new InMemoryStore();
    const [a, b, c] = await makePlayers(store, 3);
    await store.addScore(a, 1);
    await store.addScore(b, 2);
    await store.addScore(c, 3);

    expect(await store.topScores(2.9)).toHaveLength(2);
  });

  it("rejects addScore for an unknown player", async () => {
    const store = new InMemoryStore();
    // No player created with this id -> must reject (PgStore FK parity).
    await expect(store.addScore("does-not-exist", 10)).rejects.toThrow(
      /unknown player/,
    );
  });

  it("rejects non-integer / NaN / Infinity points", async () => {
    const store = new InMemoryStore();
    const [a] = await makePlayers(store, 1);
    await expect(store.addScore(a, NaN)).rejects.toThrow(/invalid points/);
    await expect(store.addScore(a, Infinity)).rejects.toThrow(/invalid points/);
    await expect(store.addScore(a, 3.5)).rejects.toThrow(/invalid points/);
  });

  it("does not mutate internal state when sorting", async () => {
    const store = new InMemoryStore();
    const [a, b] = await makePlayers(store, 2);
    await store.addScore(a, 10);
    await store.addScore(b, 20);

    const first = await store.topScores(10);
    const second = await store.topScores(10);
    expect(first.map((s) => s.id)).toEqual(second.map((s) => s.id));
  });
});
