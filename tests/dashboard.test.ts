import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { buildDashboardStatus, createDashboardServer } from "../src/dashboard.js";
import { MemoryStore } from "../src/memory-store.js";

describe("dashboard", () => {
  let tempDir: string;
  let store: MemoryStore;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), "codex-memory-sidecar-dashboard-"));
    store = new MemoryStore(path.join(tempDir, "memory.sqlite"));
  });

  afterEach(() => {
    store.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("buildDashboardStatus returns health and event metadata without memory content or payloads", async () => {
    const created = store.createMemory({
      content: "Dashboard must not expose memory contents.",
      layer: "core",
      tags: ["dashboard"],
      sourceType: "manual",
      sourceRef: "test"
    });
    store.forgetMemory({ memoryId: created.id, reason: "hide payload details" });

    const status = await buildDashboardStatus(store, {
      embeddingProvider: { embed: vi.fn(async () => [0.1, 0.2]) }
    });

    expect(status.ok).toBe(true);
    expect(status.database.memoryCount).toBe(1);
    expect(status.database.eventCount).toBe(2);
    expect(status.embedding.dimensions).toBe(2);
    expect(status.recentEvents[0]).toMatchObject({
      memoryId: created.id,
      eventType: "forgotten"
    });
    expect(JSON.stringify(status)).not.toContain("Dashboard must not expose memory contents.");
    expect(JSON.stringify(status)).not.toContain("hide payload details");
  });

  test("serves HTML and JSON status over HTTP", async () => {
    const server = createDashboardServer(store, {
      embeddingProvider: { embed: vi.fn(async () => [0.1, 0.2]) }
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Expected TCP server address.");
      }
      const baseUrl = `http://127.0.0.1:${address.port}`;

      const page = await fetch(baseUrl);
      expect(page.headers.get("content-type")).toContain("text/html");
      expect(await page.text()).toContain("Codex Memory Sidecar");

      const response = await fetch(`${baseUrl}/api/status`);
      expect(response.headers.get("content-type")).toContain("application/json");
      await expect(response.json()).resolves.toMatchObject({
        ok: true,
        database: {
          ok: true
        }
      });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
});
