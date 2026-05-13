#!/usr/bin/env node
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfig } from "./config.js";
import type { EmbeddingProvider } from "./embedding.js";
import { OllamaEmbeddingProvider } from "./embedding.js";
import { MemoryStore } from "./memory-store.js";

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
  };
  embedding: {
    ok: boolean;
    dimensions: number;
    error: string | null;
  };
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
  const embedding = options.embeddingProvider
    ? await probeEmbedding(options.embeddingProvider)
    : {
        ok: false,
        dimensions: 0,
        error: "Embedding provider is not configured."
      };
  const warnings = embedding.ok ? [] : [embedding.error ?? "Embedding provider is unavailable."];

  return {
    ok: embedding.ok,
    checkedAt: new Date().toISOString(),
    database: {
      ok: true,
      memoryCount: counts.memoryCount,
      eventCount: counts.eventCount
    },
    embedding,
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
      <div class="panel"><p class="label">Embedding</p><p class="value" id="embedding">-</p></div>
    </section>
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
      document.getElementById("embedding").textContent = status.embedding.ok ? String(status.embedding.dimensions) : "Unavailable";
      document.getElementById("recent-events").innerHTML = status.recentEvents.map((event) => (
        "<tr><td>" + event.id + "</td><td>" + event.memoryId + "</td><td>" + event.eventType + "</td><td>" + event.createdAt + "</td></tr>"
      )).join("");
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
