import { describe, it, expect } from "vitest";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { InMemoryStore } from "../../db/store.js";
import { createApp } from "../../server.js";
import {
  clampLimit,
  getLeaderboard,
  LIMIT_DEFAULT,
  LIMIT_MAX,
} from "./leaderboard.js";

// Seed a store with `points` values, one player per score so FK contract holds.
// Returns the store. All scores share created_at (InMemoryStore CLOCK_MS), so
// equal-points rows fall through to the id (insertion-order) tie-break.
async function seed(points: number[]): Promise<InMemoryStore> {
  const store = new InMemoryStore();
  for (const p of points) {
    const player = await store.addPlayer(`player-${p}`);
    await store.addScore(player.id, p);
  }
  return store;
}

async function boot(store: InMemoryStore) {
  const app = createApp(store);
  app.listen(0);
  await once(app, "listening");
  const { port } = app.address() as AddressInfo;
  return { app, port };
}

type Body = {
  limit: number;
  scores: { id: string; playerId: string; points: number; createdAt: string }[];
};

describe("clampLimit", () => {
  it("defaults when absent/empty/unparseable", () => {
    expect(clampLimit(null)).toBe(LIMIT_DEFAULT);
    expect(clampLimit(undefined)).toBe(LIMIT_DEFAULT);
    expect(clampLimit("")).toBe(LIMIT_DEFAULT);
    expect(clampLimit("abc")).toBe(LIMIT_DEFAULT);
    expect(clampLimit("NaN")).toBe(LIMIT_DEFAULT);
  });

  it("clamps zero and negatives up to 1", () => {
    expect(clampLimit("0")).toBe(1);
    expect(clampLimit("-5")).toBe(1);
    expect(clampLimit("-1e9")).toBe(1);
  });

  it("caps huge values at LIMIT_MAX", () => {
    expect(clampLimit("1000")).toBe(LIMIT_MAX);
    expect(clampLimit("1e100")).toBe(LIMIT_MAX);
    expect(clampLimit(String(Number.MAX_SAFE_INTEGER))).toBe(LIMIT_MAX);
  });

  it("truncates floats and preserves in-range integers", () => {
    expect(clampLimit("5")).toBe(5);
    expect(clampLimit("5.9")).toBe(5);
    expect(clampLimit("100")).toBe(100);
  });
});

describe("getLeaderboard (unit, against InMemoryStore)", () => {
  it("orders by points desc", async () => {
    const store = await seed([10, 30, 20]);
    const { scores } = await getLeaderboard(store, 10);
    expect(scores.map((s) => s.points)).toEqual([30, 20, 10]);
  });

  it("tie-breaks equal points by created_at then id (insertion order)", async () => {
    const store = await seed([50, 50, 50]);
    const { scores } = await getLeaderboard(store, 10);
    // All equal points + equal created_at -> stable id order s1,s2,s3.
    expect(scores.map((s) => s.id)).toEqual(["s1", "s2", "s3"]);
  });

  it("honors the limit", async () => {
    const store = await seed([1, 2, 3, 4, 5]);
    const { scores, limit } = await getLeaderboard(store, 2);
    expect(limit).toBe(2);
    expect(scores.map((s) => s.points)).toEqual([5, 4]);
  });

  it("serializes createdAt as an ISO string", async () => {
    const store = await seed([7]);
    const { scores } = await getLeaderboard(store, 10);
    expect(typeof scores[0].createdAt).toBe("string");
    expect(() => new Date(scores[0].createdAt).toISOString()).not.toThrow();
  });
});

describe("GET /leaderboard (HTTP)", () => {
  it("returns ranked scores", async () => {
    const { app, port } = await boot(await seed([10, 30, 20]));
    try {
      const res = await fetch(`http://127.0.0.1:${port}/leaderboard`);
      const body = (await res.json()) as Body;
      expect(res.status).toBe(200);
      expect(body.scores.map((s) => s.points)).toEqual([30, 20, 10]);
    } finally {
      app.close();
    }
  });

  it("honors ?limit=", async () => {
    const { app, port } = await boot(await seed([1, 2, 3, 4, 5]));
    try {
      const res = await fetch(`http://127.0.0.1:${port}/leaderboard?limit=2`);
      const body = (await res.json()) as Body;
      expect(body.limit).toBe(2);
      expect(body.scores.map((s) => s.points)).toEqual([5, 4]);
    } finally {
      app.close();
    }
  });

  it("clamps a huge ?limit= to LIMIT_MAX", async () => {
    const { app, port } = await boot(await seed([1, 2, 3]));
    try {
      const res = await fetch(`http://127.0.0.1:${port}/leaderboard?limit=999999`);
      const body = (await res.json()) as Body;
      expect(body.limit).toBe(LIMIT_MAX);
      // Only 3 rows exist, all returned, ranked.
      expect(body.scores.map((s) => s.points)).toEqual([3, 2, 1]);
    } finally {
      app.close();
    }
  });

  it("clamps zero/negative ?limit= up to 1", async () => {
    const { app, port } = await boot(await seed([1, 2, 3]));
    try {
      for (const q of ["limit=0", "limit=-4"]) {
        const res = await fetch(`http://127.0.0.1:${port}/leaderboard?${q}`);
        const body = (await res.json()) as Body;
        expect(body.limit).toBe(1);
        expect(body.scores.map((s) => s.points)).toEqual([3]);
      }
    } finally {
      app.close();
    }
  });

  it("defaults when ?limit= is absent", async () => {
    const { app, port } = await boot(await seed([1, 2, 3]));
    try {
      const res = await fetch(`http://127.0.0.1:${port}/leaderboard`);
      const body = (await res.json()) as Body;
      expect(body.limit).toBe(LIMIT_DEFAULT);
    } finally {
      app.close();
    }
  });
});
