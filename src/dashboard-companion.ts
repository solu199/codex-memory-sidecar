import type http from "node:http";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { MemorySidecarConfig } from "./config.js";
import { createDashboardServer, DASHBOARD_SCHEMA_VERSION, openDashboardUrl } from "./dashboard.js";
import { OllamaEmbeddingProvider } from "./embedding.js";
import type { MemoryStore } from "./memory-store.js";

export interface DashboardCompanionOptions {
  store: MemoryStore;
  config: MemorySidecarConfig;
  env?: Record<string, string | undefined>;
  port?: number;
  fetch?: typeof globalThis.fetch;
  opener?: Parameters<typeof openDashboardUrl>[1];
}

export interface DashboardCompanionResult {
  started: boolean;
  url: string | null;
  warnings: string[];
  close: () => Promise<void>;
}

export function shouldStartDashboardWithMcp(value: string | undefined): boolean {
  if (value === undefined) {
    return true;
  }
  const normalized = value.trim().toLowerCase();
  return !["false", "0", "off", "no"].includes(normalized);
}

export async function startDashboardCompanion(options: DashboardCompanionOptions): Promise<DashboardCompanionResult> {
  const env = options.env ?? process.env;
  if (!shouldStartDashboardWithMcp(env.CODEX_MEMORY_DASHBOARD_ON_MCP_START)) {
    return {
      started: false,
      url: null,
      warnings: [],
      close: async () => undefined
    };
  }

  const port = options.port ?? Number(env.CODEX_MEMORY_DASHBOARD_PORT ?? 3737);
  const openMarkerPath = path.join(path.dirname(options.config.databasePath), ".dashboard-opened.json");
  const embeddingProvider =
    options.config.embeddingMode === "off"
      ? undefined
      : new OllamaEmbeddingProvider({
          baseUrl: options.config.ollamaBaseUrl,
          model: options.config.embeddingModel,
          fetch: options.fetch
        });
  const server = createDashboardServer(options.store, {
    embeddingProvider,
    embeddingRequired: options.config.embeddingMode === "ollama",
    autoMemoryWrite: options.config.memoryAutoWrite,
    ollama:
      options.config.embeddingMode === "off"
        ? undefined
        : {
            baseUrl: options.config.ollamaBaseUrl,
            embeddingModel: options.config.embeddingModel,
            maintenanceModel: options.config.maintenanceModel,
            fetch: options.fetch
          },
    ollamaRequired: options.config.embeddingMode === "ollama"
  });

  return await listenDashboardServer(server, port, env, openMarkerPath, options.opener, options.fetch);
}

async function listenDashboardServer(
  server: http.Server,
  port: number,
  env: Record<string, string | undefined>,
  openMarkerPath: string,
  opener: Parameters<typeof openDashboardUrl>[1],
  fetchImpl: typeof globalThis.fetch = globalThis.fetch
): Promise<DashboardCompanionResult> {
  return await new Promise((resolve) => {
    const close = async () => {
      if (!server.listening) {
        return;
      }
      await new Promise<void>((closeResolve, closeReject) => {
        server.close((error) => (error ? closeReject(error) : closeResolve()));
      });
    };
    const finish = (result: DashboardCompanionResult) => {
      server.off("error", onError);
      resolve(result);
    };
    const onError = (error: NodeJS.ErrnoException) => {
      void (async () => {
        const existing = error.code === "EADDRINUSE" ? await findExistingSidecarDashboard(port, fetchImpl) : null;
        if (existing?.reusable) {
          console.error(`codex-memory-sidecar dashboard companion reused existing dashboard: ${existing.url}`);
          openDashboardForMcp(existing.url, env.CODEX_MEMORY_DASHBOARD_OPEN, openMarkerPath, opener);
          finish({
            started: false,
            url: existing.url,
            warnings: [`Dashboard companion reused existing sidecar dashboard: ${existing.url}`],
            close
          });
          return;
        }

        if (existing?.warning) {
          console.error(`codex-memory-sidecar dashboard companion stale dashboard warning: ${existing.warning}`);
          finish({
            started: false,
            url: null,
            warnings: [existing.warning],
            close
          });
          return;
        }

        finish({
          started: false,
          url: null,
          warnings: [`Dashboard companion did not start: ${error.message}`],
          close
        });
      })();
    };

    server.once("error", onError);
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      const actualPort = address && typeof address !== "string" ? address.port : port;
      const url = `http://127.0.0.1:${actualPort}`;
      console.error(`codex-memory-sidecar dashboard companion: ${url}`);
      openDashboardForMcp(url, env.CODEX_MEMORY_DASHBOARD_OPEN, openMarkerPath, opener);
      finish({
        started: true,
        url,
        warnings: [],
        close
      });
    });
  });
}

function openDashboardForMcp(
  url: string,
  value: string | undefined,
  markerPath: string,
  opener: Parameters<typeof openDashboardUrl>[1]
): boolean {
  const mode = resolveDashboardOpenMode(value);
  if (mode === "never") {
    return false;
  }
  if (mode === "once" && wasDashboardAlreadyOpened(markerPath, url)) {
    return false;
  }
  const opened = openDashboardUrl(url, opener);
  if (opened) {
    rememberDashboardOpened(markerPath, url);
  }
  return opened;
}

function resolveDashboardOpenMode(value: string | undefined): "once" | "always" | "never" {
  if (value === undefined || value.trim() === "") {
    return "once";
  }
  const normalized = value.trim().toLowerCase();
  if (["false", "0", "off", "no", "never"].includes(normalized)) {
    return "never";
  }
  if (["true", "1", "yes", "always"].includes(normalized)) {
    return "always";
  }
  return "once";
}

function wasDashboardAlreadyOpened(markerPath: string, url: string): boolean {
  try {
    const marker = JSON.parse(readFileSync(markerPath, "utf8")) as unknown;
    return isRecord(marker) && marker.url === url && marker.schemaVersion === DASHBOARD_SCHEMA_VERSION;
  } catch {
    return false;
  }
}

function rememberDashboardOpened(markerPath: string, url: string): void {
  try {
    mkdirSync(path.dirname(markerPath), { recursive: true });
    writeFileSync(
      markerPath,
      JSON.stringify(
        {
          url,
          schemaVersion: DASHBOARD_SCHEMA_VERSION,
          openedAt: new Date().toISOString()
        },
        null,
        2
      )
    );
  } catch {
    // Browser auto-open is a convenience; marker write failures should not affect MCP startup.
  }
}

async function findExistingSidecarDashboard(
  port: number,
  fetchImpl: typeof globalThis.fetch
): Promise<{ reusable: true; url: string } | { reusable: false; url: string; warning: string } | null> {
  const url = `http://127.0.0.1:${port}`;
  try {
    const response = await fetchImpl(`${url}/api/status`);
    if (!response.ok) {
      return null;
    }
    const status = (await response.json()) as unknown;
    if (!isRecord(status) || !isRecord(status.database) || !isRecord(status.embedding)) {
      return null;
    }
    const schemaVersion = isRecord(status.dashboard) ? status.dashboard.schemaVersion : null;
    if (schemaVersion !== DASHBOARD_SCHEMA_VERSION) {
      return {
        reusable: false,
        url,
        warning: `既存の Dashboard (${url}) は stale、または別ビルドの可能性があります。古い Dashboard プロセスを停止してから MCP server を再起動してください。`
      };
    }
    return { reusable: true, url };
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
