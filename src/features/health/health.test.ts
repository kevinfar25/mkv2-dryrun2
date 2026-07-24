import { describe, it, expect } from "vitest";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { InMemoryStore } from "../../db/store.js";
import { createApp } from "../../server.js";

async function boot() {
  const app = createApp(new InMemoryStore());
  app.listen(0);
  await once(app, "listening");
  const { port } = app.address() as AddressInfo;
  return { app, port };
}

describe("health", () => {
  it("returns ok", async () => {
    const { app, port } = await boot();
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      const body = (await res.json()) as { status: string };
      expect(res.status).toBe(200);
      expect(body.status).toBe("ok");
    } finally {
      app.close();
    }
  });

  it("404s an unknown route", async () => {
    const { app, port } = await boot();
    try {
      const res = await fetch(`http://127.0.0.1:${port}/nope`);
      expect(res.status).toBe(404);
    } finally {
      app.close();
    }
  });
});
