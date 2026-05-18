import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  buildDashboardStatus,
  createDashboardServer,
  openDashboardUrl,
  probeOllamaStatus,
  shouldOpenDashboardBrowser
} from "../src/dashboard.js";
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
    const visible = store.createMemory({
      content: "Visible memory body should stay hidden.",
      summary: "Dashboard-safe summary",
      layer: "core",
      tags: ["dashboard"],
      sourceType: "manual",
      sourceRef: "test",
      projectScope: "alpha"
    });
    const forgotten = store.createMemory({
      content: "Dashboard must not expose memory contents.",
      layer: "core",
      tags: ["dashboard-hidden"],
      sourceType: "manual",
      sourceRef: "test"
    });
    store.forgetMemory({ memoryId: forgotten.id, reason: "hide payload details" });

    const status = await buildDashboardStatus(store, {
      embeddingProvider: { embed: vi.fn(async () => [0.1, 0.2]) }
    });

    expect(status.ok).toBe(true);
    expect(status.database.memoryCount).toBe(2);
    expect(status.database.eventCount).toBe(3);
    expect(status.database.integrityCheck).toBe("ok");
    expect(status.database.fts).toMatchObject({
      ok: true,
      expectedCount: 1,
      indexedCount: 1
    });
    expect(status.database.walCheckpoint.busy).toBe(0);
    expect(status.memoryStats).toMatchObject({
      byStatus: {
        active: 1,
        superseded: 0,
        forgotten: 1
      },
      byLayer: {
        core: 2,
        recall: 0,
        archival: 0
      },
      byProjectScope: [
        expect.objectContaining({
          projectScope: "alpha",
          active: 1,
          total: 1
        }),
        expect.objectContaining({
          projectScope: "global",
          active: 0,
          total: 1
        })
      ]
    });
    expect(status.embedding.dimensions).toBe(2);
    expect(status.recentMemories).toEqual([
      expect.objectContaining({
        id: visible.id,
        summary: "Dashboard-safe summary",
        layer: "core",
        status: "active",
        tags: ["dashboard"],
        projectScope: "alpha",
        sourceType: "manual",
        sourceRef: "test"
      })
    ]);
    expect(status.recentEvents[0]).toMatchObject({
      memoryId: forgotten.id,
      eventType: "forgotten"
    });
    expect(JSON.stringify(status)).not.toContain("Dashboard must not expose memory contents.");
    expect(JSON.stringify(status)).not.toContain("Visible memory body should stay hidden.");
    expect(JSON.stringify(status)).not.toContain("hide payload details");
  });

  test("buildDashboardStatus reports maintenance guidance for repairable index warnings", async () => {
    const created = store.createMemory({
      content: "Dashboard should explain repairable index warnings.",
      layer: "recall",
      tags: ["dashboard", "repair"],
      sourceType: "manual",
      sourceRef: "test"
    });
    await store.createBackup({});
    const dbPath = path.join(tempDir, "memory.sqlite");
    const { default: Database } = await import("better-sqlite3");
    const db = new Database(dbPath);
    try {
      db.prepare("DELETE FROM memories_fts WHERE rowid = ?").run(created.id);
    } finally {
      db.close();
    }

    const status = await buildDashboardStatus(store, {
      embeddingProvider: { embed: vi.fn(async () => [0.1, 0.2]) }
    });

    expect(status.ok).toBe(false);
    expect(status.maintenance.repairRecommended).toBe(true);
    expect(status.maintenance.latestBackup?.backupPath).toContain(path.join(tempDir, "backups"));
    expect(status.warnings).toContain("FTS index is missing 1 active memory row(s).");
    expect(status.warningActions).toEqual([
      expect.objectContaining({
        severity: "warning",
        title: "検索インデックスの修復が必要です",
        action: "MCP tool の repair_memory_index を実行してください。",
        tools: ["backup_memory", "repair_memory_index", "health_check"]
      })
    ]);
  });

  test("buildDashboardStatus includes directive memory contents for inspection", async () => {
    store.createDirective({
      content: "Directive memory should be visible on the dashboard.",
      scope: "global",
      rationale: "User needs to audit strong memory.",
      tags: ["dashboard"],
      sourceType: "manual",
      sourceRef: "AGENTS-memory-protocol.md"
    });

    const status = await buildDashboardStatus(store, {
      embeddingProvider: { embed: vi.fn(async () => [0.1, 0.2]) }
    });

    expect(status.directives).toEqual([
      expect.objectContaining({
        scope: "global",
        projectScope: "global",
        content: "Directive memory should be visible on the dashboard.",
        rationale: "User needs to audit strong memory.",
        status: "active"
      })
    ]);
  });

  test("buildDashboardStatus reports backup retention totals without deleting backups", async () => {
    const backupDir = path.join(tempDir, "backups");
    mkdirSync(backupDir, { recursive: true });
    const oldestBackup = path.join(backupDir, "memory-20260514-010000-000.sqlite");

    for (let index = 0; index < 11; index += 1) {
      const backupPath = path.join(backupDir, `memory-20260514-${String(index + 1).padStart(2, "0")}0000-000.sqlite`);
      writeFileSync(backupPath, `backup-${index}`);
    }

    const status = await buildDashboardStatus(store, {
      embeddingProvider: { embed: vi.fn(async () => [0.1, 0.2]) }
    });

    expect(status.maintenance.backupRetention).toMatchObject({
      backupDir,
      keepCount: 10,
      backupCount: 11,
      keptCount: 10,
      prunableCount: 1,
      prunableSizeBytes: 8
    });
    expect(status.maintenance.backupRetention.latestBackup?.backupPath).toContain("memory-20260514-110000-000.sqlite");
    expect(status.maintenance.backupRetention.prunable).toEqual([
      expect.objectContaining({
        backupPath: oldestBackup,
        sizeBytes: 8
      })
    ]);
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
      const html = await page.text();
      expect(html).toContain("Codex Memory Sidecar");
      expect(html).toContain("メモリ統計");
      expect(html).toContain("Directive Memory");
      expect(html).toContain("指示内容");
      expect(html).toContain("メンテナンス");
      expect(html).toContain("バックアップ保持");
      expect(html).toContain("警告と対応");
      expect(html).toContain("Ollama モデル");
      expect(html).toContain("プロジェクトスコープ");
      expect(html).toContain("最近のメモリ");
      expect(html).toContain("情報源");

      const response = await fetch(`${baseUrl}/api/status`);
      expect(response.headers.get("content-type")).toContain("application/json");
      await expect(response.json()).resolves.toMatchObject({
        ok: true,
        database: {
          ok: true
        },
        memoryStats: {
          byStatus: {
            active: 0
          },
          byProjectScope: []
        },
        recentMemories: []
      });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  test("shouldOpenDashboardBrowser enables auto open unless explicitly disabled", () => {
    expect(shouldOpenDashboardBrowser(undefined)).toBe(true);
    expect(shouldOpenDashboardBrowser("")).toBe(true);
    expect(shouldOpenDashboardBrowser("true")).toBe(true);
    expect(shouldOpenDashboardBrowser("1")).toBe(true);
    expect(shouldOpenDashboardBrowser("false")).toBe(false);
    expect(shouldOpenDashboardBrowser("0")).toBe(false);
    expect(shouldOpenDashboardBrowser("off")).toBe(false);
    expect(shouldOpenDashboardBrowser("NO")).toBe(false);
  });

  test("openDashboardUrl starts a detached platform browser command", () => {
    const calls: Array<{
      command: string;
      args: string[];
      options: { detached?: boolean; stdio?: string; windowsHide?: boolean };
    }> = [];
    const unref = vi.fn();
    const on = vi.fn();

    const opened = openDashboardUrl("http://127.0.0.1:3737", (command, args, options) => {
      calls.push({ command, args, options });
      return { on, unref };
    });

    expect(opened).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args).toContain("http://127.0.0.1:3737");
    expect(calls[0]?.options).toMatchObject({
      detached: true,
      stdio: "ignore",
      windowsHide: true
    });
    expect(on).toHaveBeenCalledWith("error", expect.any(Function));
    expect(unref).toHaveBeenCalledOnce();
  });

  test("openDashboardUrl reports opener failures without throwing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    try {
      const opened = openDashboardUrl("http://127.0.0.1:3737", () => {
        throw new Error("browser unavailable");
      });

      expect(opened).toBe(false);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("browser unavailable"));
    } finally {
      warn.mockRestore();
    }
  });

  test("probeOllamaStatus reports configured model availability from Ollama tags", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          models: [
            { name: "embeddinggemma:latest" },
            { name: "qwen3:latest" },
            { name: "llama3.2:latest" }
          ]
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" }
        }
      )
    );

    const status = await probeOllamaStatus({
      baseUrl: "http://localhost:11434",
      embeddingModel: "embeddinggemma",
      maintenanceModel: "qwen3",
      fetch: fetchImpl
    });

    expect(fetchImpl).toHaveBeenCalledWith("http://localhost:11434/api/tags");
    expect(status).toEqual({
      ok: true,
      baseUrl: "http://localhost:11434",
      embeddingModel: "embeddinggemma",
      maintenanceModel: "qwen3",
      embeddingModelAvailable: true,
      maintenanceModelAvailable: true,
      modelNames: ["embeddinggemma:latest", "qwen3:latest", "llama3.2:latest"],
      error: null
    });
  });

  test("buildDashboardStatus includes Ollama model status and warning when a configured model is missing", async () => {
    const status = await buildDashboardStatus(store, {
      embeddingProvider: { embed: vi.fn(async () => [0.1, 0.2]) },
      ollama: {
        baseUrl: "http://localhost:11434",
        embeddingModel: "embeddinggemma",
        maintenanceModel: "qwen3",
        fetch: vi.fn(async () =>
          new Response(JSON.stringify({ models: [{ name: "embeddinggemma:latest" }] }), {
            status: 200,
            headers: { "content-type": "application/json" }
          })
        )
      }
    });

    expect(status.ok).toBe(false);
    expect(status.ollama).toMatchObject({
      ok: false,
      embeddingModelAvailable: true,
      maintenanceModelAvailable: false,
      modelNames: ["embeddinggemma:latest"]
    });
    expect(status.warnings).toContain("Ollama model is not available: qwen3");
    expect(status.warningActions).toContainEqual(
      expect.objectContaining({
        severity: "warning",
        title: "Ollama モデルが見つかりません",
        action: "Ollama に不足モデルを追加してください: ollama pull qwen3"
      })
    );
  });
});
