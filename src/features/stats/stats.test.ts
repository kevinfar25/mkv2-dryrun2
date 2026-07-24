import { describe, it, expect } from "vitest";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { InMemoryStore } from "../../db/store.js";
import { createApp } from "../../server.js";
import { computeStats } from "./stats.js";

async function boot(store: InMemoryStore) {
  const app = createApp(store);
  app.listen(0);
  await once(app, "listening");
  const { port } = app.address() as AddressInfo;
  return { app, port };
}

async function getStats(port: number, id: string) {
  const res = await fetch(`http://127.0.0.1:${port}/players/${id}/stats`);
  const text = await res.text();
  let json: unknown = undefined;
  try {
    json = JSON.parse(text);
  } catch {
    /* leave undefined */
  }
  return { status: res.status, json: json as any, text };
}

describe("computeStats (unit)", () => {
  it("computes best, count, and average for a non-empty set", () => {
    expect(computeStats([10, 30, 20])).toEqual({ best: 30, count: 3, average: 20 });
  });

  it("rounds the average to two decimals (round-half-up)", () => {
    // (1 + 2) / 2 = 1.5
    expect(computeStats([1, 2]).average).toBe(1.5);
    // (1 + 2 + 2) / 3 = 1.6666... -> 1.67
    expect(computeStats([1, 2, 2]).average).toBe(1.67);
    // (1 + 1 + 4) / 3 = 2 exactly
    expect(computeStats([1, 1, 4]).average).toBe(2);
  });

  it("handles a single score", () => {
    expect(computeStats([42])).toEqual({ best: 42, count: 1, average: 42 });
  });

  it("handles negative points", () => {
    expect(computeStats([-5, -1, -3])).toEqual({ best: -1, count: 3, average: -3 });
  });

  it("rounds with integer arithmetic, not float (199×1 + 2 -> 1.01)", () => {
    // sum = 201, count = 200, mean = 1.005 -> 1.01 (half away from zero).
    // The float form Math.round((201/200)*100)/100 wrongly yields 1.
    const points = [...Array(199).fill(1), 2];
    expect(computeStats(points).average).toBe(1.01);
  });

  it("rounds negatives symmetrically (199×-1 + -2 -> -1.01)", () => {
    // sum = -201, count = 200, mean = -1.005 -> -1.01. Math.round would bias
    // toward +Infinity and give -1.00 here.
    const points = [...Array(199).fill(-1), -2];
    expect(computeStats(points).average).toBe(-1.01);
  });

  it("returns nulls for the empty case", () => {
    expect(computeStats([])).toEqual({ best: null, count: 0, average: null });
  });

  it("computes best over a very large array without a stack overflow", () => {
    // `Math.max(...points)` throws RangeError (Maximum call stack size exceeded)
    // for arrays this large; a plain loop must not.
    const n = 500_000;
    const points = new Array<number>(n);
    for (let i = 0; i < n; i++) points[i] = i;
    let stats!: ReturnType<typeof computeStats>;
    expect(() => {
      stats = computeStats(points);
    }).not.toThrow();
    expect(stats.best).toBe(n - 1);
    expect(stats.count).toBe(n);
  });

  it("keeps the average exact when sum*100 exceeds Number.MAX_SAFE_INTEGER", () => {
    // 100k scores of 2_000_000_000 (near int32 max). sum = 2e14, sum*100 = 2e16,
    // which is > Number.MAX_SAFE_INTEGER (~9.007e15) — float arithmetic drifts,
    // BigInt does not. The exact mean is 2_000_000_000.
    const n = 100_000;
    const v = 2_000_000_000;
    const points = new Array<number>(n).fill(v);
    expect(computeStats(points).average).toBe(v);

    // Same scale but with a fractional mean that must round half-away-from-zero:
    // add one extra unit so sum = n*v + 1, mean = v + 1/n = 2_000_000_000.00001
    // -> rounds to 2_000_000_000 (2dp). Perturb by 5 units so the 2dp digit moves.
    const points2 = new Array<number>(n).fill(v);
    points2[0] = v + n / 200; // adds 0.005 to the mean -> +0.01 after rounding
    expect(computeStats(points2).average).toBe(v + 0.01);
  });
});

describe("GET /players/:id/stats (HTTP, against InMemoryStore)", () => {
  it("returns correct aggregates for a known player with scores", async () => {
    const store = new InMemoryStore();
    const player = await store.addPlayer("alice");
    await store.addScore(player.id, 10);
    await store.addScore(player.id, 30);
    await store.addScore(player.id, 20);
    const { app, port } = await boot(store);
    try {
      const res = await getStats(port, player.id);
      expect(res.status).toBe(200);
      expect(res.json).toEqual({ best: 30, count: 3, average: 20 });
    } finally {
      app.close();
    }
  });

  it("only counts the requested player's scores", async () => {
    const store = new InMemoryStore();
    const alice = await store.addPlayer("alice");
    const bob = await store.addPlayer("bob");
    await store.addScore(alice.id, 100);
    await store.addScore(bob.id, 1);
    await store.addScore(bob.id, 3);
    const { app, port } = await boot(store);
    try {
      const res = await getStats(port, bob.id);
      expect(res.status).toBe(200);
      expect(res.json).toEqual({ best: 3, count: 2, average: 2 });
    } finally {
      app.close();
    }
  });

  it("returns nulls for a known player with no scores (empty case, not 404)", async () => {
    const store = new InMemoryStore();
    const player = await store.addPlayer("newbie");
    const { app, port } = await boot(store);
    try {
      const res = await getStats(port, player.id);
      expect(res.status).toBe(200);
      expect(res.json).toEqual({ best: null, count: 0, average: null });
    } finally {
      app.close();
    }
  });

  it("returns 404 not_found for an unknown player id", async () => {
    const store = new InMemoryStore();
    const { app, port } = await boot(store);
    try {
      const res = await getStats(port, "does-not-exist");
      expect(res.status).toBe(404);
      expect(res.json.error).toBe("not_found");
    } finally {
      app.close();
    }
  });
});
