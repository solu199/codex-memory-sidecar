import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  buildDashboardMemoryDetail,
  buildDashboardStatus,
  createDashboardServer,
  DASHBOARD_BUILD_FINGERPRINT,
  isAllowedDashboardHostHeader,
  openDashboardUrl,
  probeOllamaStatus,
  shouldOpenDashboardBrowser,
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
      projectScope: "alpha",
    });
    const forgotten = store.createMemory({
      content: "Dashboard must not expose memory contents.",
      layer: "core",
      tags: ["dashboard-hidden"],
      sourceType: "manual",
      sourceRef: "test",
    });
    store.forgetMemory({ memoryId: forgotten.id, reason: "hide payload details" });

    const status = await buildDashboardStatus(store, {
      embeddingProvider: { embed: vi.fn(async () => [0.1, 0.2]) },
    });

    expect(status.ok).toBe(true);
    expect(status.database.memoryCount).toBe(2);
    expect(status.database.eventCount).toBe(3);
    expect(status.database.integrityCheck).toBe("ok");
    expect(status.database.fts).toMatchObject({
      ok: true,
      expectedCount: 1,
      indexedCount: 1,
    });
    expect(status.database.walCheckpoint.busy).toBe(0);
    expect(status.memoryStats).toMatchObject({
      byStatus: {
        active: 1,
        superseded: 0,
        forgotten: 1,
      },
      byLayer: {
        core: 2,
        recall: 0,
        archival: 0,
      },
      byProjectScope: [
        expect.objectContaining({
          projectScope: "alpha",
          active: 1,
          total: 1,
        }),
        expect.objectContaining({
          projectScope: "global",
          active: 0,
          total: 1,
        }),
      ],
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
        sourceRef: "test",
      }),
    ]);
    expect(status.recentEvents[0]).toMatchObject({
      memoryId: forgotten.id,
      eventType: "forgotten",
    });
    expect(JSON.stringify(status)).not.toContain("Dashboard must not expose memory contents.");
    expect(JSON.stringify(status)).not.toContain("Visible memory body should stay hidden.");
    expect(JSON.stringify(status)).not.toContain("hide payload details");
  });

  test("buildDashboardMemoryDetail exposes metadata by default and content only on explicit request", () => {
    const created = store.createMemory({
      content: "Detailed dashboard body should require an explicit reveal.",
      summary: "Detailed dashboard summary",
      layer: "recall",
      tags: ["dashboard", "detail"],
      sourceType: "github-pr",
      sourceRef: "pr:#118",
      projectScope: "alpha",
      importance: 0.8,
      confidence: 0.9,
    });

    const metadataOnly = buildDashboardMemoryDetail(store, created.id);
    expect(metadataOnly).toMatchObject({
      ok: true,
      memory: {
        id: created.id,
        summary: "Detailed dashboard summary",
        contentIncluded: false,
        contentAvailable: true,
        sourceType: "github-pr",
        sourceRef: "pr:#118",
        sourceUrl: "https://github.com/solu199/codex-memory-sidecar/pull/118",
      },
    });
    expect(JSON.stringify(metadataOnly)).not.toContain("explicit reveal");

    const withContent = buildDashboardMemoryDetail(store, created.id, { includeContent: true });
    expect(withContent).toMatchObject({
      ok: true,
      memory: {
        id: created.id,
        contentIncluded: true,
        content: "Detailed dashboard body should require an explicit reveal.",
      },
    });
  });

  test("buildDashboardStatus reports maintenance guidance for repairable index warnings", async () => {
    const created = store.createMemory({
      content: "Dashboard should explain repairable index warnings.",
      layer: "recall",
      tags: ["dashboard", "repair"],
      sourceType: "manual",
      sourceRef: "test",
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
      embeddingProvider: { embed: vi.fn(async () => [0.1, 0.2]) },
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
        tools: ["backup_memory", "repair_memory_index", "health_check"],
      }),
    ]);
  });

  test("buildDashboardStatus includes directive memory contents for inspection", async () => {
    store.createDirective({
      content: "Directive memory should be visible on the dashboard.",
      scope: "global",
      rationale: "User needs to audit strong memory.",
      tags: ["dashboard"],
      sourceType: "manual",
      sourceRef: "AGENTS-memory-protocol.md",
    });
    const disabled = store.createDirective({
      content: "Disabled directive memory should stay inspectable.",
      scope: "project",
      projectScope: "alpha",
      rationale: "User should be able to confirm disabled directives.",
      tags: ["dashboard"],
      sourceType: "manual",
      sourceRef: "test",
    });
    store.disableDirective({
      directiveId: disabled.id,
      reason: "Dashboard disabled visibility test.",
    });

    const status = await buildDashboardStatus(store, {
      embeddingProvider: { embed: vi.fn(async () => [0.1, 0.2]) },
    });

    expect(status.directives).toEqual([
      expect.objectContaining({
        scope: "global",
        projectScope: "global",
        content: "Directive memory should be visible on the dashboard.",
        rationale: "User needs to audit strong memory.",
        status: "active",
      }),
    ]);
    expect(status.disabledDirectives).toEqual([
      expect.objectContaining({
        id: disabled.id,
        scope: "project",
        projectScope: "alpha",
        content: "Disabled directive memory should stay inspectable.",
        status: "disabled",
      }),
    ]);
  });

  test("buildDashboardStatus reports backup retention totals without deleting backups", async () => {
    const backupDir = path.join(tempDir, "backups");
    mkdirSync(backupDir, { recursive: true });
    const oldestBackup = path.join(backupDir, "memory-20260514-010000-000.sqlite");

    for (let index = 0; index < 11; index += 1) {
      const backupPath = path.join(
        backupDir,
        `memory-20260514-${String(index + 1).padStart(2, "0")}0000-000.sqlite`,
      );
      writeFileSync(backupPath, `backup-${index}`);
    }

    const status = await buildDashboardStatus(store, {
      embeddingProvider: { embed: vi.fn(async () => [0.1, 0.2]) },
    });

    expect(status.maintenance.backupRetention).toMatchObject({
      backupDir,
      keepCount: 10,
      backupCount: 11,
      keptCount: 10,
      prunableCount: 1,
      prunableSizeBytes: 8,
    });
    expect(status.maintenance.backupRetention.latestBackup?.backupPath).toContain(
      "memory-20260514-110000-000.sqlite",
    );
    expect(status.maintenance.backupRetention.prunable).toEqual([
      expect.objectContaining({
        backupPath: oldestBackup,
        sizeBytes: 8,
      }),
    ]);
  });

  test("buildDashboardStatus reports memory freshness and update candidates from workspace activity", async () => {
    store.createMemory({
      content: "Old memory before recent repository work.",
      summary: "Old saved memory",
      layer: "recall",
      tags: ["freshness"],
      sourceType: "manual",
      sourceRef: "memory:freshness",
      projectScope: "alpha",
    });

    const status = await buildDashboardStatus(store, {
      embeddingProvider: { embed: vi.fn(async () => [0.1, 0.2]) },
      now: new Date("2026-06-20T03:20:00Z"),
      workspaceActivity: {
        commits: [
          {
            hash: "92e5fcb1234567890",
            subject: "Ollama表示と手動MCP例を改善",
            committedAt: new Date("2026-06-20T03:00:20Z"),
          },
        ],
      },
    });

    expect(status.memoryFreshness).toMatchObject({
      status: "stale",
      latestMemoryUpdatedAt: expect.any(String),
      latestWorkspaceActivityAt: "2026-06-20T03:00:20.000Z",
      candidateCount: 1,
    });
    expect(status.memoryUpdateCandidates).toEqual([
      expect.objectContaining({
        kind: "commit",
        sourceRef: "git:92e5fcb",
        suggestedTool: "propose_memory_update",
      }),
    ]);
    expect(status.autoMemoryCuration).toMatchObject({
      mode: "safe",
      evaluatedCount: 1,
      reviewCount: 1,
      autoWriteEligibleCount: 0,
      skippedCount: 0,
    });
    expect(status.warningActions).toContainEqual(
      expect.objectContaining({
        title: "メモリ更新が古い可能性があります",
        tools: ["propose_memory_update", "write_memory"],
      }),
    );
  });

  test("buildDashboardStatus reports auto memory curation safe eligibility without writing", async () => {
    store.createMemory({
      content: "Old memory before recent repository work.",
      summary: "Old saved memory",
      layer: "recall",
      tags: ["freshness"],
      sourceType: "manual",
      sourceRef: "memory:freshness",
      projectScope: "alpha",
    });

    const status = await buildDashboardStatus(store, {
      embeddingProvider: { embed: vi.fn(async () => [0.1, 0.2]) },
      autoMemoryWrite: "safe",
      now: new Date("2026-06-20T03:20:00Z"),
      workspaceActivity: {
        pullRequests: [
          {
            number: 79,
            title: "メモリ鮮度と保存候補を表示",
            mergedAt: new Date("2026-06-20T03:00:20Z"),
            authorLogin: "solu199",
            externalAuthor: false,
          },
        ],
      },
    });

    expect(status.autoMemoryCuration).toMatchObject({
      mode: "safe",
      evaluatedCount: 1,
      autoWriteEligibleCount: 1,
      note: expect.stringContaining("start_memory_session"),
    });
    expect(status.database.memoryCount).toBe(1);
  });

  test("serves HTML and JSON status over HTTP", async () => {
    const server = createDashboardServer(store, {
      embeddingProvider: { embed: vi.fn(async () => [0.1, 0.2]) },
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
      expect(html).toContain("app-shell");
      expect(html).toContain("app-nav");
      expect(html).toContain("view-observatory");
      expect(html).toContain("view-health");
      expect(html).toContain("view-memories");
      expect(html).toContain("view-directives");
      expect(html).toContain("view-maintenance");
      expect(html).toContain("view-events");
      expect(html).toContain("view-settings");
      expect(html).toContain('data-view-target="observatory"');
      expect(html).toContain("Auto Memory Curation");
      expect(html).toContain("Memory Observatory");
      expect(html).toContain("observatory-3d.bundle.js");
      expect(html).toContain('id="graph"');
      expect(html).toContain('id="tabLive"');
      expect(html).toContain('id="tabReplay"');
      expect(html).toContain('id="tabExplore"');
      expect(html).toContain('id="searchBox"');
      expect(html).toContain('id="showSim"');
      expect(html).toContain('id="showHebb"');
      expect(html).toContain('id="autoRotate"');
      expect(html).toContain('id="lowPowerMode"');
      expect(html).toContain('id="fogOn"');
      expect(html).toContain('id="memory-detail"');
      expect(html).toContain('id="memory-detail-title"');
      expect(html).toContain('id="memory-detail-content"');
      expect(html).toContain("data-memory-detail-id");
      expect(html).toContain("/api/graph");
      expect(html).toContain("/api/memories/");
      expect(html).toContain("function openMemoryDetail");
      expect(html).toContain("openMemoryDetail(node.id");
      expect(html).toContain("function isObservatoryRenderable");
      expect(html).toContain("function scheduleNextObservatoryFrame");
      expect(html).toContain("document.hidden");
      expect(html).toContain("cancelAnimationFrame(animationFrame)");
      expect(html).toContain("function shouldShowNodeLabel");
      expect(html).toContain("state.hover === node");
      expect(html).not.toContain("score > 0.45 ? 1 : 0");
      expect(html).toContain('id="autoRotate">');
      expect(html).toContain('id="lowPowerMode" checked>');
      expect(html).toContain(".app-view:not(#view-observatory).active");
      expect(html).toContain("max-width: 1160px");
      expect(html).toContain('class="table-wrap"');
      expect(html).toContain("overflow-x: auto");
      expect(html).toContain("メモリ統計");
      expect(html).toContain("Directive Memory");
      expect(html).toContain("無効化済み Directive Memory");
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
        dashboard: {
          schemaVersion: expect.any(String),
          buildFingerprint: DASHBOARD_BUILD_FINGERPRINT,
        },
        database: {
          ok: true,
        },
        memoryStats: {
          byStatus: {
            active: 0,
          },
          byProjectScope: [],
        },
        recentMemories: [],
        autoMemoryCuration: {
          mode: "safe",
        },
      });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  test("serves memory detail over HTTP with explicit content reveal", async () => {
    const created = store.createMemory({
      content: "HTTP detail body should not be returned until explicitly requested.",
      summary: "HTTP detail summary",
      layer: "recall",
      tags: ["dashboard", "detail"],
      sourceType: "git-commit",
      sourceRef: "git:abc1234",
      projectScope: "alpha",
    });
    const server = createDashboardServer(store, {
      embeddingProvider: { embed: vi.fn(async () => [0.1, 0.2]) },
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Expected TCP server address.");
      }
      const baseUrl = `http://127.0.0.1:${address.port}`;

      const metadataResponse = await fetch(`${baseUrl}/api/memories/${created.id}`);
      const metadata = await metadataResponse.json();
      expect(metadataResponse.status).toBe(200);
      expect(metadata).toMatchObject({
        ok: true,
        memory: {
          id: created.id,
          summary: "HTTP detail summary",
          contentIncluded: false,
          contentAvailable: true,
          sourceRef: "git:abc1234",
        },
      });
      expect(JSON.stringify(metadata)).not.toContain("explicitly requested");

      const contentResponse = await fetch(
        `${baseUrl}/api/memories/${created.id}?includeContent=true`,
      );
      const content = await contentResponse.json();
      expect(contentResponse.status).toBe(200);
      expect(content).toMatchObject({
        ok: true,
        memory: {
          id: created.id,
          contentIncluded: true,
          content: "HTTP detail body should not be returned until explicitly requested.",
        },
      });

      const missingResponse = await fetch(`${baseUrl}/api/memories/999999`);
      await expect(missingResponse.json()).resolves.toEqual({
        ok: false,
        error: "Memory 999999 was not found.",
      });
      expect(missingResponse.status).toBe(404);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  test("serves vendored 3D observatory runtime over HTTP", async () => {
    const server = createDashboardServer(store);

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Expected TCP server address.");
      }
      const baseUrl = `http://127.0.0.1:${address.port}`;

      const response = await fetch(`${baseUrl}/assets/observatory-3d.bundle.js`);
      const source = await response.text();

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/javascript");
      expect(source).toContain("window.ForceGraph3D");
      expect(source).toContain("window.THREE");
      expect(source).toContain("window.UnrealBloomPass");
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  test("serves vendored 3D observatory runtime when launched outside the repo cwd", async () => {
    const originalCwd = process.cwd();
    const externalCwd = mkdtempSync(path.join(os.tmpdir(), "codex-memory-sidecar-cwd-"));
    const server = createDashboardServer(store);

    process.chdir(externalCwd);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Expected TCP server address.");
      }
      const baseUrl = `http://127.0.0.1:${address.port}`;

      const response = await fetch(`${baseUrl}/assets/observatory-3d.bundle.js`);
      const source = await response.text();

      expect(response.status).toBe(200);
      expect(source).toContain("window.ForceGraph3D");
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      process.chdir(originalCwd);
      rmSync(externalCwd, { recursive: true, force: true });
    }
  });

  test("serves privacy-safe memory graph data over HTTP", async () => {
    store.createMemory({
      content: "Graph endpoint must not expose this memory body.",
      summary: "Graph endpoint safe summary",
      layer: "recall",
      tags: ["graph"],
      sourceType: "manual",
      sourceRef: "test:dashboard-graph",
      embedding: [1, 0, 0],
    });

    const server = createDashboardServer(store, {
      embeddingProvider: { embed: vi.fn(async () => [0.1, 0.2]) },
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Expected TCP server address.");
      }
      const baseUrl = `http://127.0.0.1:${address.port}`;

      const response = await fetch(`${baseUrl}/api/graph`);
      const graph = await response.json();

      expect(response.status).toBe(200);
      expect(graph.nodes).toEqual([
        expect.objectContaining({
          summary: "Graph endpoint safe summary",
          privacy: "summary-only",
        }),
      ]);
      expect(graph.privacy).toEqual({
        contentIncluded: false,
        eventPayloadIncluded: false,
      });
      expect(JSON.stringify(graph)).not.toContain("Graph endpoint must not expose");
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  test("allows only localhost dashboard Host headers", () => {
    expect(isAllowedDashboardHostHeader("127.0.0.1:3737")).toBe(true);
    expect(isAllowedDashboardHostHeader("localhost:3737")).toBe(true);
    expect(isAllowedDashboardHostHeader("[::1]:3737")).toBe(true);
    expect(isAllowedDashboardHostHeader("::1")).toBe(true);
    expect(isAllowedDashboardHostHeader("127.0.0.1.evil.example:3737")).toBe(false);
    expect(isAllowedDashboardHostHeader("example.com:3737")).toBe(false);
    expect(isAllowedDashboardHostHeader(undefined)).toBe(false);
  });

  test("rejects dashboard requests with non-local Host headers", async () => {
    const server = createDashboardServer(store);

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Expected TCP server address.");
      }
      const response = await new Promise<{ statusCode: number; body: string }>(
        (resolve, reject) => {
          const request = http.request(
            {
              host: "127.0.0.1",
              port: address.port,
              path: "/api/status",
              method: "GET",
              headers: {
                Host: "example.com",
              },
            },
            (incoming) => {
              let body = "";
              incoming.setEncoding("utf8");
              incoming.on("data", (chunk) => {
                body += chunk;
              });
              incoming.on("end", () => {
                resolve({ statusCode: incoming.statusCode ?? 0, body });
              });
            },
          );
          request.on("error", reject);
          request.end();
        },
      );

      expect(response.statusCode).toBe(403);
      expect(response.body).toBe("Forbidden");
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  test("renders dashboard data into the DOM after the browser script refreshes", async () => {
    store.createMemory({
      content: "Dashboard DOM test memory body must stay out of visible summary.",
      summary: "DOM rendered memory summary",
      layer: "recall",
      tags: ["dashboard", "dom"],
      sourceType: "manual",
      sourceRef: "dom-test",
      projectScope: "alpha",
    });
    store.createDirective({
      content: "DOM rendered directive content",
      scope: "global",
      rationale: "DOM rendering should expose directive memory for inspection.",
      tags: ["dashboard", "dom"],
      sourceType: "manual",
      sourceRef: "dom-test",
    });

    const server = createDashboardServer(store, {
      embeddingProvider: { embed: vi.fn(async () => [0.1, 0.2, 0.3]) },
      ollama: {
        baseUrl: "http://localhost:11434",
        embeddingModel: "embeddinggemma",
        maintenanceModel: "qwen3",
        fetch: vi.fn(
          async () =>
            new Response(
              JSON.stringify({
                models: [{ name: "embeddinggemma:latest" }, { name: "qwen3:latest" }],
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              },
            ),
        ),
      },
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Expected TCP server address.");
      }
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const html = await (await fetch(baseUrl)).text();
      const status = await (await fetch(`${baseUrl}/api/status`)).json();
      const graph = await (await fetch(`${baseUrl}/api/graph`)).json();
      const script = html.match(/<script>([\s\S]*)<\/script>/)?.[1];
      if (!script) {
        throw new Error("Dashboard script was not found.");
      }
      const elements = new Map<
        string,
        { textContent: string; innerHTML: string; className: string; listeners: string[] }
      >();
      const classLists = new Map<string, Set<string>>();
      const navButtons = [
        "observatory",
        "health",
        "memories",
        "directives",
        "maintenance",
        "events",
        "settings",
      ].map((view) => ({
        dataset: { viewTarget: view },
        listeners: [] as string[],
        classList: {
          add(className: string) {
            const classes = classLists.get(`nav-${view}`) ?? new Set<string>();
            classes.add(className);
            classLists.set(`nav-${view}`, classes);
          },
          remove(className: string) {
            classLists.get(`nav-${view}`)?.delete(className);
          },
        },
        addEventListener(eventName: string) {
          this.listeners.push(eventName);
        },
      }));
      const views = [
        "observatory",
        "health",
        "memories",
        "directives",
        "maintenance",
        "events",
        "settings",
      ].map((view) => ({
        id: `view-${view}`,
        classList: {
          add(className: string) {
            const classes = classLists.get(`view-${view}`) ?? new Set<string>();
            classes.add(className);
            classLists.set(`view-${view}`, classes);
          },
          remove(className: string) {
            classLists.get(`view-${view}`)?.delete(className);
          },
        },
      }));
      const elementFor = (id: string) => {
        const existing = elements.get(id);
        if (existing) {
          return existing;
        }
        const created = {
          textContent: "",
          innerHTML: "",
          className: "",
          listeners: [] as string[],
          addEventListener(eventName: string) {
            this.listeners.push(eventName);
          },
        };
        elements.set(id, created);
        return created;
      };
      const context = {
        fetch: vi.fn(async (url: string) => ({
          ok: true,
          json: async () => (url === "/api/graph" ? graph : status),
        })),
        document: {
          getElementById: elementFor,
          querySelectorAll(selector: string) {
            if (selector === ".nav-button") return navButtons;
            if (selector === ".app-view") return views;
            return [];
          },
        },
        window: {},
      };

      vm.runInNewContext(script, context);
      await vi.waitFor(() => {
        expect(elementFor("status").textContent).toBe("正常");
      });

      expect(elementFor("status")).toMatchObject({
        textContent: "正常",
        className: "value status-ok",
      });
      expect(context.fetch).toHaveBeenCalledWith("/api/status");
      expect(elementFor("memories").textContent).toBe("1");
      expect(elementFor("embedding").textContent).toBe("3");
      expect(elementFor("repair")).toMatchObject({
        textContent: "不要",
        className: "value status-ok",
      });
      expect(elementFor("warnings").innerHTML).toContain("現在");
      expect(elementFor("warnings").innerHTML).toContain("なし");
      expect(elementFor("memory-freshness").innerHTML).toContain("最新メモリ更新");
      expect(elementFor("memory-candidates").innerHTML).toContain("保存候補");
      expect(elementFor("ollama-status")).toMatchObject({
        textContent: "正常",
        className: "value status-ok",
      });
      expect(elementFor("ollama-configured").innerHTML).toContain("必須");
      expect(elementFor("ollama-models").innerHTML).toContain("embeddinggemma:latest");
      expect(elementFor("directives").innerHTML).toContain("DOM rendered directive content");
      expect(elementFor("recent-memories").innerHTML).toContain("DOM rendered memory summary");
      expect(elementFor("recent-memories").innerHTML).not.toContain(
        "Dashboard DOM test memory body",
      );
      expect(elementFor("refresh").listeners).toEqual(["click"]);
      expect(navButtons.map((button) => button.listeners)).toEqual([
        ["click"],
        ["click"],
        ["click"],
        ["click"],
        ["click"],
        ["click"],
        ["click"],
      ]);
      expect(elementFor("settings-dashboard").innerHTML).toContain("schema");
      expect(elementFor("forecast").innerHTML).toContain("DOM rendered memory summary");
      expect(elementFor("feed").innerHTML).toContain("作成");
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
      windowsHide: true,
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
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            models: [
              { name: "embeddinggemma:latest" },
              { name: "qwen3:latest" },
              { name: "llama3.2:latest" },
            ],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
    );

    const status = await probeOllamaStatus({
      baseUrl: "http://localhost:11434",
      embeddingModel: "embeddinggemma",
      maintenanceModel: "qwen3",
      fetch: fetchImpl,
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
      error: null,
    });
  });

  test("buildDashboardStatus includes Ollama model status and warning when a configured model is missing", async () => {
    const status = await buildDashboardStatus(store, {
      embeddingProvider: { embed: vi.fn(async () => [0.1, 0.2]) },
      ollama: {
        baseUrl: "http://localhost:11434",
        embeddingModel: "embeddinggemma",
        maintenanceModel: "qwen3",
        fetch: vi.fn(
          async () =>
            new Response(JSON.stringify({ models: [{ name: "embeddinggemma:latest" }] }), {
              status: 200,
              headers: { "content-type": "application/json" },
            }),
        ),
      },
    });

    expect(status.ok).toBe(false);
    expect(status.ollama).toMatchObject({
      ok: false,
      required: true,
      embeddingModelAvailable: true,
      maintenanceModelAvailable: false,
      modelNames: ["embeddinggemma:latest"],
    });
    expect(status.warnings).toContain("Ollama model is not available: qwen3");
    expect(status.warningActions).toContainEqual(
      expect.objectContaining({
        severity: "warning",
        title: "Ollama モデルが見つかりません",
        action: "Ollama に不足モデルを追加してください: ollama pull qwen3",
      }),
    );
  });

  test("buildDashboardStatus treats unavailable Ollama as optional when not required", async () => {
    const status = await buildDashboardStatus(store, {
      embeddingProvider: { embed: vi.fn(async () => Promise.reject(new Error("Ollama offline"))) },
      embeddingRequired: false,
      ollama: {
        baseUrl: "http://localhost:11434",
        embeddingModel: "embeddinggemma",
        maintenanceModel: "qwen3",
        fetch: vi.fn(async () => {
          throw new Error("Ollama offline");
        }),
      },
      ollamaRequired: false,
      workspaceActivity: { commits: [] },
    });

    expect(status.ok).toBe(true);
    expect(status.embedding).toMatchObject({
      ok: false,
      required: false,
      error: "Ollama offline",
    });
    expect(status.ollama).toMatchObject({
      ok: false,
      required: false,
      error: "Ollama offline",
    });
    expect(status.warnings).toEqual([]);
    expect(status.warningActions).toEqual([]);
  });

  test("renders optional Ollama mode as non-blocking in the DOM", async () => {
    const server = createDashboardServer(store, {
      embeddingProvider: { embed: vi.fn(async () => Promise.reject(new Error("Ollama offline"))) },
      embeddingRequired: false,
      ollama: {
        baseUrl: "http://localhost:11434",
        embeddingModel: "embeddinggemma",
        maintenanceModel: "qwen3",
        fetch: vi.fn(async () => {
          throw new Error("Ollama offline");
        }),
      },
      ollamaRequired: false,
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Expected TCP server address.");
      }
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const html = await (await fetch(baseUrl)).text();
      const status = await (await fetch(`${baseUrl}/api/status`)).json();
      const script = html.match(/<script>([\s\S]*)<\/script>/)?.[1];
      if (!script) {
        throw new Error("Dashboard script was not found.");
      }
      const elements = new Map<
        string,
        { textContent: string; innerHTML: string; className: string; listeners: string[] }
      >();
      const elementFor = (id: string) => {
        const existing = elements.get(id);
        if (existing) {
          return existing;
        }
        const created = {
          textContent: "",
          innerHTML: "",
          className: "",
          listeners: [] as string[],
          addEventListener(eventName: string) {
            this.listeners.push(eventName);
          },
        };
        elements.set(id, created);
        return created;
      };
      const context = {
        fetch: vi.fn(async () => ({
          json: async () => status,
        })),
        document: {
          getElementById: elementFor,
        },
      };

      vm.runInNewContext(script, context);
      await vi.waitFor(() => {
        expect(elementFor("ollama-status").textContent).toBe("任意");
      });

      expect(status.ok).toBe(true);
      expect(status.ollama.required).toBe(false);
      expect(elementFor("ollama-status")).toMatchObject({
        textContent: "任意",
        className: "value status-ok",
      });
      expect(elementFor("ollama-configured").innerHTML).toContain("任意");
      expect(elementFor("warnings").innerHTML).toContain("なし");
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
});
