#!/usr/bin/env node
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfig } from "./config.js";
import type { EmbeddingProvider } from "./embedding.js";
import { OllamaEmbeddingProvider } from "./embedding.js";
import { MemoryStore } from "./memory-store.js";
import { runStartupMaintenance } from "./startup-maintenance.js";

export interface DashboardOptions {
  embeddingProvider?: EmbeddingProvider;
}

export interface DashboardStatus {
  ok: boolean;
  checkedAt: string;
  database: {
    ok: boolean;
    memoryCount: number;
    eventCount: number;
    integrityCheck: string;
    fts: {
      ok: boolean;
      expectedCount: number;
      indexedCount: number;
      missingCount: number;
      orphanCount: number;
    };
    walCheckpoint: {
      busy: number;
      log: number;
      checkpointed: number;
    };
  };
  memoryStats: {
    byStatus: {
      active: number;
      superseded: number;
      forgotten: number;
    };
    byLayer: {
      core: number;
      recall: number;
      archival: number;
    };
    byProjectScope: Array<{
      projectScope: string;
      total: number;
      active: number;
      latestUpdatedAt: string | null;
    }>;
    updatedAtRange: {
      oldest: string | null;
      newest: string | null;
    };
  };
  embedding: {
    ok: boolean;
    dimensions: number;
    error: string | null;
  };
  recentMemories: Array<{
    id: number;
    layer: string;
    summary: string;
    tags: string[];
    importance: number;
    confidence: number;
    status: string;
    updatedAt: string;
  }>;
  recentEvents: Array<{
    id: number;
    memoryId: number;
    eventType: string;
    createdAt: string;
  }>;
  warnings: string[];
}

export async function buildDashboardStatus(store: MemoryStore, options: DashboardOptions = {}): Promise<DashboardStatus> {
  const counts = store.countRecords();
  const databaseHealth = store.checkDatabaseHealth();
  const memoryStats = store.getStats();
  const embedding = options.embeddingProvider
    ? await probeEmbedding(options.embeddingProvider)
    : {
        ok: false,
        dimensions: 0,
        error: "Embedding provider is not configured."
      };
  const warnings = [
    ...databaseHealth.warnings,
    ...(embedding.ok ? [] : [embedding.error ?? "Embedding provider is unavailable."])
  ];

  return {
    ok: databaseHealth.ok && embedding.ok,
    checkedAt: new Date().toISOString(),
    database: {
      ok: databaseHealth.ok,
      memoryCount: counts.memoryCount,
      eventCount: counts.eventCount,
      integrityCheck: databaseHealth.integrityCheck,
      fts: databaseHealth.fts,
      walCheckpoint: databaseHealth.walCheckpoint
    },
    memoryStats: {
      byStatus: memoryStats.byStatus,
      byLayer: memoryStats.byLayer,
      byProjectScope: memoryStats.byProjectScope.map((scope) => ({
        projectScope: scope.projectScope,
        total: scope.total,
        active: scope.active,
        latestUpdatedAt: scope.latestUpdatedAt?.toISOString() ?? null
      })),
      updatedAtRange: {
        oldest: memoryStats.updatedAtRange.oldest?.toISOString() ?? null,
        newest: memoryStats.updatedAtRange.newest?.toISOString() ?? null
      }
    },
    embedding,
    recentMemories: store.listMemories({ limit: 10 }).map((memory) => ({
      id: memory.id,
      layer: memory.layer,
      summary: memory.summary,
      tags: memory.tags,
      importance: memory.importance,
      confidence: memory.confidence,
      status: memory.status,
      updatedAt: memory.updatedAt.toISOString()
    })),
    recentEvents: store.listRecentEvents({ limit: 10 }).map((event) => ({
      id: event.id,
      memoryId: event.memoryId,
      eventType: event.eventType,
      createdAt: event.createdAt.toISOString()
    })),
    warnings
  };
}

export function createDashboardServer(store: MemoryStore, options: DashboardOptions = {}): http.Server {
  return http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (request.method !== "GET") {
        sendText(response, 405, "Method Not Allowed");
        return;
      }

      if (url.pathname === "/api/status") {
        sendJson(response, 200, await buildDashboardStatus(store, options));
        return;
      }

      if (url.pathname === "/" || url.pathname === "/index.html") {
        sendHtml(response, 200, renderDashboardHtml());
        return;
      }

      sendText(response, 404, "Not Found");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendJson(response, 500, { ok: false, error: message });
    }
  });
}

async function probeEmbedding(provider: EmbeddingProvider): Promise<DashboardStatus["embedding"]> {
  try {
    const vector = await provider.embed("codex memory sidecar dashboard health check");
    return {
      ok: true,
      dimensions: vector.length,
      error: null
    };
  } catch (error) {
    return {
      ok: false,
      dimensions: 0,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function renderDashboardHtml(): string {
  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Codex Memory Sidecar</title>
  <style>
    :root {
      color-scheme: light dark;
      font-family: Arial, sans-serif;
      background: #f7f4ef;
      color: #1f2933;
    }
    body {
      margin: 0;
      min-height: 100vh;
    }
    main {
      width: min(980px, calc(100% - 32px));
      margin: 0 auto;
      padding: 32px 0;
    }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      margin-bottom: 24px;
    }
    h1 {
      font-size: 28px;
      margin: 0;
      letter-spacing: 0;
    }
    button {
      border: 1px solid #9aa5b1;
      border-radius: 6px;
      padding: 8px 12px;
      background: #ffffff;
      color: #1f2933;
      cursor: pointer;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
      gap: 12px;
    }
    .panel {
      border: 1px solid #d2d6dc;
      border-radius: 8px;
      padding: 16px;
      background: #ffffff;
    }
    .label {
      color: #52606d;
      font-size: 13px;
      margin: 0 0 8px;
    }
    .value {
      font-size: 26px;
      font-weight: 700;
      margin: 0;
      overflow-wrap: anywhere;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 12px;
      background: #ffffff;
      border: 1px solid #d2d6dc;
      border-radius: 8px;
      overflow: hidden;
    }
    .summary {
      max-width: 420px;
      overflow-wrap: anywhere;
    }
    .tags {
      color: #52606d;
      font-size: 13px;
      overflow-wrap: anywhere;
    }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 12px;
      margin-top: 12px;
    }
    .stats-list {
      margin: 0;
      padding: 0;
      list-style: none;
      font-size: 14px;
    }
    .stats-list li {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      padding: 6px 0;
      border-bottom: 1px solid #e4e7eb;
    }
    th, td {
      border-bottom: 1px solid #e4e7eb;
      padding: 10px;
      text-align: left;
      font-size: 14px;
    }
    th {
      color: #52606d;
      font-weight: 600;
      background: #f0f4f8;
    }
    .status-ok {
      color: #0e7c3f;
    }
    .status-warn {
      color: #b44d12;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        background: #111827;
        color: #f9fafb;
      }
      button, .panel, table {
        background: #1f2937;
        color: #f9fafb;
        border-color: #4b5563;
      }
      th {
        background: #273449;
      }
      th, td {
        border-color: #374151;
      }
      .label {
        color: #cbd5e1;
      }
      .tags {
        color: #cbd5e1;
      }
      .stats-list li {
        border-color: #374151;
      }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>Codex Memory Sidecar</h1>
      <button type="button" id="refresh">Refresh</button>
    </header>
    <section class="grid">
      <div class="panel"><p class="label">Status</p><p class="value" id="status">Loading</p></div>
      <div class="panel"><p class="label">Memories</p><p class="value" id="memories">-</p></div>
      <div class="panel"><p class="label">Events</p><p class="value" id="events">-</p></div>
      <div class="panel"><p class="label">Database</p><p class="value" id="database">-</p></div>
      <div class="panel"><p class="label">Embedding</p><p class="value" id="embedding">-</p></div>
    </section>
    <h2>Memory Stats</h2>
    <section class="stats-grid">
      <div class="panel">
        <p class="label">Status</p>
        <ul class="stats-list" id="status-stats"></ul>
      </div>
      <div class="panel">
        <p class="label">Layer</p>
        <ul class="stats-list" id="layer-stats"></ul>
      </div>
      <div class="panel">
        <p class="label">Updated</p>
        <ul class="stats-list" id="updated-stats"></ul>
      </div>
    </section>
    <h2>Project Scopes</h2>
    <table>
      <thead><tr><th>Scope</th><th>Active</th><th>Total</th><th>Latest</th></tr></thead>
      <tbody id="project-scopes"></tbody>
    </table>
    <h2>Recent Memories</h2>
    <table>
      <thead><tr><th>ID</th><th>Layer</th><th>Summary</th><th>Tags</th><th>Updated</th></tr></thead>
      <tbody id="recent-memories"></tbody>
    </table>
    <h2>Recent Events</h2>
    <table>
      <thead><tr><th>ID</th><th>Memory</th><th>Type</th><th>Created</th></tr></thead>
      <tbody id="recent-events"></tbody>
    </table>
  </main>
  <script>
    async function refresh() {
      const response = await fetch("/api/status");
      const status = await response.json();
      document.getElementById("status").textContent = status.ok ? "OK" : "Needs attention";
      document.getElementById("status").className = status.ok ? "value status-ok" : "value status-warn";
      document.getElementById("memories").textContent = String(status.database.memoryCount);
      document.getElementById("events").textContent = String(status.database.eventCount);
      document.getElementById("database").textContent = status.database.ok
        ? "OK"
        : "FTS " + status.database.fts.missingCount + "/" + status.database.fts.orphanCount;
      document.getElementById("database").className = status.database.ok ? "value status-ok" : "value status-warn";
      document.getElementById("embedding").textContent = status.embedding.ok ? String(status.embedding.dimensions) : "Unavailable";
      document.getElementById("status-stats").innerHTML = renderStats(status.memoryStats.byStatus);
      document.getElementById("layer-stats").innerHTML = renderStats(status.memoryStats.byLayer);
      document.getElementById("updated-stats").innerHTML = renderStats({
        oldest: status.memoryStats.updatedAtRange.oldest ?? "-",
        newest: status.memoryStats.updatedAtRange.newest ?? "-"
      });
      document.getElementById("project-scopes").innerHTML = status.memoryStats.byProjectScope.map((scope) => (
        "<tr><td class=\\"summary\\">" + escapeHtml(scope.projectScope) + "</td><td>" + scope.active + "</td><td>" + scope.total + "</td><td>" + escapeHtml(scope.latestUpdatedAt ?? "-") + "</td></tr>"
      )).join("");
      document.getElementById("recent-memories").innerHTML = status.recentMemories.map((memory) => (
        "<tr><td>" + memory.id + "</td><td>" + escapeHtml(memory.layer) + "</td><td class=\\"summary\\">" + escapeHtml(memory.summary) + "</td><td class=\\"tags\\">" + escapeHtml(memory.tags.join(", ")) + "</td><td>" + escapeHtml(memory.updatedAt) + "</td></tr>"
      )).join("");
      document.getElementById("recent-events").innerHTML = status.recentEvents.map((event) => (
        "<tr><td>" + event.id + "</td><td>" + event.memoryId + "</td><td>" + event.eventType + "</td><td>" + event.createdAt + "</td></tr>"
      )).join("");
    }
    function renderStats(values) {
      return Object.entries(values).map(([key, value]) => (
        "<li><span>" + escapeHtml(key) + "</span><strong>" + escapeHtml(value) + "</strong></li>"
      )).join("");
    }
    function escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, (char) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "\\"": "&quot;",
        "'": "&#39;"
      }[char]));
    }
    document.getElementById("refresh").addEventListener("click", refresh);
    void refresh();
  </script>
</body>
</html>`;
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(JSON.stringify(body, null, 2));
}

function sendHtml(response: ServerResponse, statusCode: number, body: string): void {
  response.writeHead(statusCode, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(body);
}

function sendText(response: ServerResponse, statusCode: number, body: string): void {
  response.writeHead(statusCode, {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(body);
}

async function main(): Promise<void> {
  const config = loadConfig();
  const store = new MemoryStore(config.databasePath);
  const startup = await runStartupMaintenance(store, config);
  for (const warning of startup.warnings) {
    console.error(`codex-memory-sidecar dashboard startup warning: ${warning}`);
  }
  const port = Number(process.env.CODEX_MEMORY_DASHBOARD_PORT ?? 3737);
  const server = createDashboardServer(store, {
    embeddingProvider: new OllamaEmbeddingProvider({
      baseUrl: config.ollamaBaseUrl,
      model: config.embeddingModel
    })
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(`Codex Memory Sidecar dashboard: http://127.0.0.1:${port}`);
  });

  process.on("SIGINT", () => {
    server.close(() => {
      store.close();
      process.exit(0);
    });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main();
}
