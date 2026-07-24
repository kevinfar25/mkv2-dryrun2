import { describe, it, expect } from "vitest";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { InMemoryStore } from "../../db/store.js";
import { createApp } from "../../server.js";
import { scoreInputSchema } from "./scores.js";
import { INT32_MIN, INT32_MAX } from "../../db/store.js";

async function boot(store: InMemoryStore) {
  const app = createApp(store);
  app.listen(0);
  await once(app, "listening");
  const { port } = app.address() as AddressInfo;
  return { app, port };
}

// POST a raw string body (so we can send malformed JSON that fetch would not
// serialize from an object). Returns status + parsed-or-raw body.
async function post(port: number, body: string) {
  const res = await fetch(`http://127.0.0.1:${port}/scores`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
  const text = await res.text();
  let json: unknown = undefined;
  try {
    json = JSON.parse(text);
  } catch {
    /* leave undefined */
  }
  return { status: res.status, json: json as any, text };
}

describe("scoreInputSchema (unit)", () => {
  it("accepts a valid body", () => {
    expect(scoreInputSchema.safeParse({ playerId: "p1", points: 42 }).success).toBe(true);
  });

  it("accepts the int32 boundaries", () => {
    expect(scoreInputSchema.safeParse({ playerId: "p1", points: INT32_MIN }).success).toBe(true);
    expect(scoreInputSchema.safeParse({ playerId: "p1", points: INT32_MAX }).success).toBe(true);
    // Negative points inside int32 are legal.
    expect(scoreInputSchema.safeParse({ playerId: "p1", points: -5 }).success).toBe(true);
  });

  it("rejects missing/empty playerId", () => {
    expect(scoreInputSchema.safeParse({ points: 1 }).success).toBe(false);
    expect(scoreInputSchema.safeParse({ playerId: "", points: 1 }).success).toBe(false);
    expect(scoreInputSchema.safeParse({ playerId: "   ", points: 1 }).success).toBe(false);
  });

  it("rejects non-integer / out-of-range points", () => {
    expect(scoreInputSchema.safeParse({ playerId: "p1", points: 1.5 }).success).toBe(false);
    expect(scoreInputSchema.safeParse({ playerId: "p1", points: NaN }).success).toBe(false);
    expect(scoreInputSchema.safeParse({ playerId: "p1", points: Infinity }).success).toBe(false);
    expect(scoreInputSchema.safeParse({ playerId: "p1", points: INT32_MAX + 1 }).success).toBe(false);
    expect(scoreInputSchema.safeParse({ playerId: "p1", points: INT32_MIN - 1 }).success).toBe(false);
  });

  it("rejects wrong types", () => {
    expect(scoreInputSchema.safeParse({ playerId: 1, points: 1 }).success).toBe(false);
    expect(scoreInputSchema.safeParse({ playerId: "p1", points: "5" }).success).toBe(false);
    expect(scoreInputSchema.safeParse(null).success).toBe(false);
    expect(scoreInputSchema.safeParse([]).success).toBe(false);
  });
});

describe("POST /scores (HTTP, against InMemoryStore)", () => {
  it("persists a valid score and returns 201 with the created row", async () => {
    const store = new InMemoryStore();
    const player = await store.addPlayer("alice");
    const { app, port } = await boot(store);
    try {
      const res = await post(port, JSON.stringify({ playerId: player.id, points: 77 }));
      expect(res.status).toBe(201);
      expect(res.json.playerId).toBe(player.id);
      expect(res.json.points).toBe(77);
      expect(typeof res.json.id).toBe("string");
      expect(() => new Date(res.json.createdAt).toISOString()).not.toThrow();

      // Confirm persistence by reading back FROM THE STORE (P3 owns no read route).
      const rows = await store.topScores();
      expect(rows.map((r) => r.points)).toEqual([77]);
      expect(rows[0].playerId).toBe(player.id);
    } finally {
      app.close();
    }
  });

  it("returns 400 for missing/empty playerId", async () => {
    const store = new InMemoryStore();
    await store.addPlayer("alice");
    const { app, port } = await boot(store);
    try {
      for (const body of [
        JSON.stringify({ points: 1 }),
        JSON.stringify({ playerId: "", points: 1 }),
        JSON.stringify({ playerId: "   ", points: 1 }),
      ]) {
        const res = await post(port, body);
        expect(res.status).toBe(400);
        expect(res.json.error).toBeDefined();
      }
    } finally {
      app.close();
    }
  });

  it("returns 400 for non-integer / out-of-range / negative-type points", async () => {
    const store = new InMemoryStore();
    await store.addPlayer("alice");
    const { app, port } = await boot(store);
    try {
      for (const body of [
        JSON.stringify({ playerId: "p1", points: 1.5 }),
        JSON.stringify({ playerId: "p1", points: INT32_MAX + 1 }),
        JSON.stringify({ playerId: "p1", points: INT32_MIN - 1 }),
        '{"playerId":"p1","points":1e100}',
      ]) {
        const res = await post(port, body);
        expect(res.status).toBe(400);
        expect(res.json.error).toBeDefined();
      }
    } finally {
      app.close();
    }
  });

  it("returns 400 for wrong types", async () => {
    const store = new InMemoryStore();
    await store.addPlayer("alice");
    const { app, port } = await boot(store);
    try {
      for (const body of [
        JSON.stringify({ playerId: 1, points: 1 }),
        JSON.stringify({ playerId: "p1", points: "5" }),
        JSON.stringify(null),
        JSON.stringify([]),
      ]) {
        const res = await post(port, body);
        expect(res.status).toBe(400);
      }
    } finally {
      app.close();
    }
  });

  it("returns 400 for malformed JSON", async () => {
    const store = new InMemoryStore();
    const { app, port } = await boot(store);
    try {
      const res = await post(port, "{ not json");
      expect(res.status).toBe(400);
      expect(res.json.error).toBe("invalid_json");
    } finally {
      app.close();
    }
  });

  it("returns 400 for an unknown player (FK contract)", async () => {
    const store = new InMemoryStore();
    const { app, port } = await boot(store);
    try {
      const res = await post(port, JSON.stringify({ playerId: "nope", points: 1 }));
      expect(res.status).toBe(400);
      expect(res.json.error).toBe("unknown_player");
    } finally {
      app.close();
    }
  });
});
