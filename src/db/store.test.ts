import { describe, it, expect } from "vitest";
import { InMemoryStore } from "./store.js";

describe("InMemoryStore scores", () => {
  it("orders by points descending", async () => {
    const store = new InMemoryStore();
    await store.addScore("p1", 10);
    await store.addScore("p2", 30);
    await store.addScore("p3", 20);

    const top = await store.topScores(10);
    expect(top.map((s) => s.points)).toEqual([30, 20, 10]);
    expect(top.map((s) => s.playerId)).toEqual(["p2", "p3", "p1"]);
  });

  it("tie-breaks equal points by created_at ascending (earliest first)", async () => {
    const store = new InMemoryStore();
    const first = await store.addScore("p1", 50);
    const second = await store.addScore("p2", 50);
    const third = await store.addScore("p3", 50);

    const top = await store.topScores(10);
    expect(top.map((s) => s.id)).toEqual([first.id, second.id, third.id]);
    // created_at must be strictly increasing across insertions.
    expect(top[0].createdAt.getTime()).toBeLessThan(top[1].createdAt.getTime());
    expect(top[1].createdAt.getTime()).toBeLessThan(top[2].createdAt.getTime());
  });

  it("combines points and tie-break ordering", async () => {
    const store = new InMemoryStore();
    const a = await store.addScore("p1", 100);
    const b = await store.addScore("p2", 100); // same points, later -> after a
    await store.addScore("p3", 40);
    const d = await store.addScore("p4", 200);

    const top = await store.topScores(10);
    expect(top.map((s) => s.id)).toEqual([d.id, a.id, b.id, top[3].id]);
    expect(top.map((s) => s.points)).toEqual([200, 100, 100, 40]);
  });

  it("honours the limit", async () => {
    const store = new InMemoryStore();
    await store.addScore("p1", 1);
    await store.addScore("p2", 2);
    await store.addScore("p3", 3);

    expect(await store.topScores(2)).toHaveLength(2);
    expect((await store.topScores(2)).map((s) => s.points)).toEqual([3, 2]);
  });

  it("returns an empty array when there are no scores", async () => {
    const store = new InMemoryStore();
    expect(await store.topScores(10)).toEqual([]);
  });

  it("returns an empty array for a zero or negative limit", async () => {
    const store = new InMemoryStore();
    await store.addScore("p1", 5);
    expect(await store.topScores(0)).toEqual([]);
    expect(await store.topScores(-3)).toEqual([]);
  });

  it("does not mutate internal state when sorting", async () => {
    const store = new InMemoryStore();
    await store.addScore("p1", 10);
    await store.addScore("p2", 20);

    const first = await store.topScores(10);
    const second = await store.topScores(10);
    expect(first.map((s) => s.id)).toEqual(second.map((s) => s.id));
  });
});
