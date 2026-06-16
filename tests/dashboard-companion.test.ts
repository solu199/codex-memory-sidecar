import os from "node:os";
import path from "node:path";
import http from "node:http";

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  startDashboardCompanion,
  shouldStartDashboardWithMcp,
} from "../src/dashboard-companion.js";
import { DASHBOARD_SCHEMA_VERSION } from "../src/dashboard.js";
import { MemoryStore } from "../src/memory-store.js";
import type { MemorySidecarConfig } from "../src/config.js";

describe("dashboard companion", () => {
  let tempDir: string;
  let store: MemoryStore;
  let config: MemorySidecarConfig;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), "codex-memory-sidecar-dashboard-companion-"));
    store = new MemoryStore(path.join(tempDir, "memory.sqlite"));
    config = {
      memoryAutoWrite: "off",
      embeddingMode: "auto",
      ollamaBaseUrl: "http://localhost:11434",
      embeddingModel: "embeddinggemma",
      maintenanceModel: "qwen3",
      databasePath: path.join(tempDir, "memory.sqlite"),
      defaultSearchLimit: 8,
      consolidationDryRun: true,
      startupIntegrityCheck: true,
      startupFtsSanityCheck: true,
      startupWalCheckpoint: true,
      autoBackupOnStartup: false,
    };
  });

  afterEach(() => {
    store.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("shouldStartDashboardWithMcp enables companion dashboard unless explicitly disabled", () => {
    expect(shouldStartDashboardWithMcp(undefined)).toBe(true);
    expect(shouldStartDashboardWithMcp("true")).toBe(true);
    expect(shouldStartDashboardWithMcp("false")).toBe(false);
    expect(shouldStartDashboardWithMcp("0")).toBe(false);
    expect(shouldStartDashboardWithMcp("off")).toBe(false);
    expect(shouldStartDashboardWithMcp("NO")).toBe(false);
  });

  test("startDashboardCompanion serves dashboard status and opens the browser once", async () => {
    const opener = vi.fn(() => ({ on: vi.fn(), unref: vi.fn() }));
    const result = await startDashboardCompanion({
      store,
      config,
      port: 0,
      opener,
      fetch: vi.fn(async (url) => {
        if (String(url).endsWith("/api/tags")) {
          return new Response(
            JSON.stringify({
              models: [{ name: "embeddinggemma:latest" }, { name: "qwen3:latest" }],
            }),
          );
        }
        return new Response(JSON.stringify({ embeddings: [[0.1, 0.2]] }));
      }),
    });

    expect(result.started).toBe(true);
    expect(result.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(opener).toHaveBeenCalledOnce();

    try {
      const response = await fetch(`${result.url}/api/status`);
      await expect(response.json()).resolves.toMatchObject({
        ok: true,
        ollama: {
          ok: true,
          embeddingModelAvailable: true,
          maintenanceModelAvailable: true,
        },
      });
    } finally {
      await result.close();
    }
  });

  test("startDashboardCompanion can be disabled for MCP startup", async () => {
    const result = await startDashboardCompanion({
      store,
      config,
      env: { CODEX_MEMORY_DASHBOARD_ON_MCP_START: "false" },
    });

    expect(result.started).toBe(false);
    expect(result.url).toBeNull();
    expect(result.warnings).toEqual([]);
    await result.close();
  });

  test("startDashboardCompanion does not reopen an already opened dashboard by default", async () => {
    const existing = await startDashboardCompanion({
      store,
      config,
      port: 0,
      opener: vi.fn(() => ({ on: vi.fn(), unref: vi.fn() })),
      fetch: vi.fn(async (url) => {
        if (String(url).endsWith("/api/tags")) {
          return new Response(
            JSON.stringify({
              models: [{ name: "embeddinggemma:latest" }, { name: "qwen3:latest" }],
            }),
          );
        }
        return new Response(JSON.stringify({ embeddings: [[0.1, 0.2]] }));
      }),
    });
    if (!existing.url) {
      throw new Error("Expected existing dashboard URL.");
    }
    const port = Number(new URL(existing.url).port);
    const opener = vi.fn(() => ({ on: vi.fn(), unref: vi.fn() }));

    try {
      const result = await startDashboardCompanion({
        store,
        config,
        port,
        opener,
      });

      expect(result.started).toBe(false);
      expect(result.url).toBe(existing.url);
      expect(result.warnings).toEqual([
        `Dashboard companion reused existing sidecar dashboard: ${existing.url}`,
      ]);
      expect(opener).not.toHaveBeenCalled();
      await result.close();
    } finally {
      await existing.close();
    }
  });

  test("startDashboardCompanion reopens when the old open marker has no live process", async () => {
    const markerPath = path.join(path.dirname(config.databasePath), ".dashboard-opened.json");
    writeFileSync(
      markerPath,
      JSON.stringify({
        url: "http://127.0.0.1:12345",
        schemaVersion: DASHBOARD_SCHEMA_VERSION,
        openedAt: new Date().toISOString(),
      }),
    );
    const opener = vi.fn(() => ({ on: vi.fn(), unref: vi.fn() }));

    const result = await startDashboardCompanion({
      store,
      config,
      port: 0,
      opener,
      fetch: vi.fn(async (url) => {
        if (String(url).endsWith("/api/tags")) {
          return new Response(
            JSON.stringify({
              models: [{ name: "embeddinggemma:latest" }, { name: "qwen3:latest" }],
            }),
          );
        }
        return new Response(JSON.stringify({ embeddings: [[0.1, 0.2]] }));
      }),
    });

    try {
      expect(result.started).toBe(true);
      expect(opener).toHaveBeenCalledOnce();
    } finally {
      await result.close();
    }
  });

  test("startDashboardCompanion can always reopen an existing dashboard when requested", async () => {
    const existing = await startDashboardCompanion({
      store,
      config,
      port: 0,
      opener: vi.fn(() => ({ on: vi.fn(), unref: vi.fn() })),
      fetch: vi.fn(async (url) => {
        if (String(url).endsWith("/api/tags")) {
          return new Response(
            JSON.stringify({
              models: [{ name: "embeddinggemma:latest" }, { name: "qwen3:latest" }],
            }),
          );
        }
        return new Response(JSON.stringify({ embeddings: [[0.1, 0.2]] }));
      }),
    });
    if (!existing.url) {
      throw new Error("Expected existing dashboard URL.");
    }
    const port = Number(new URL(existing.url).port);
    const opener = vi.fn(() => ({ on: vi.fn(), unref: vi.fn() }));

    try {
      const result = await startDashboardCompanion({
        store,
        config,
        port,
        opener,
        env: { CODEX_MEMORY_DASHBOARD_OPEN: "always" },
      });

      expect(result.started).toBe(false);
      expect(result.url).toBe(existing.url);
      expect(opener).toHaveBeenCalledOnce();
      await result.close();
    } finally {
      await existing.close();
    }
  });

  test("startDashboardCompanion warns instead of reusing a stale dashboard build", async () => {
    const staleServer = http.createServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          ok: true,
          database: { ok: true },
          embedding: { ok: true },
        }),
      );
    });
    await new Promise<void>((resolve) => staleServer.listen(0, "127.0.0.1", resolve));
    const address = staleServer.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected stale dashboard TCP address.");
    }
    const port = address.port;
    const opener = vi.fn(() => ({ on: vi.fn(), unref: vi.fn() }));

    try {
      const result = await startDashboardCompanion({
        store,
        config,
        port,
        opener,
      });

      expect(result.started).toBe(false);
      expect(result.url).toBeNull();
      expect(result.warnings[0]).toContain("stale");
      expect(result.warnings[0]).toContain(`http://127.0.0.1:${port}`);
      expect(opener).not.toHaveBeenCalled();
      await result.close();
    } finally {
      await new Promise<void>((resolve, reject) => {
        staleServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  test("startDashboardCompanion does not hang when an existing dashboard port never responds", async () => {
    const blockingServer = http.createServer((_request, _response) => {
      // Keep the socket open to emulate a stale or wedged local dashboard process.
    });
    await new Promise<void>((resolve) => blockingServer.listen(0, "127.0.0.1", resolve));
    const address = blockingServer.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected blocking server TCP address.");
    }

    try {
      const result = await startDashboardCompanion({
        store,
        config,
        port: address.port,
      });

      expect(result.started).toBe(false);
      expect(result.url).toBeNull();
      expect(result.warnings[0]).toContain("Dashboard companion did not start");
      await result.close();
    } finally {
      await new Promise<void>((resolve, reject) => {
        blockingServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
  }, 7000);
});
