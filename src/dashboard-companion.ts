import type http from "node:http";

import type { MemorySidecarConfig } from "./config.js";
import { createDashboardServer, DASHBOARD_SCHEMA_VERSION, openDashboardUrl, shouldOpenDashboardBrowser } from "./dashboard.js";
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
  const server = createDashboardServer(options.store, {
    embeddingProvider: new OllamaEmbeddingProvider({
      baseUrl: options.config.ollamaBaseUrl,
      model: options.config.embeddingModel,
      fetch: options.fetch
    }),
    ollama: {
      baseUrl: options.config.ollamaBaseUrl,
      embeddingModel: options.config.embeddingModel,
      maintenanceModel: options.config.maintenanceModel,
      fetch: options.fetch
    }
  });

  return await listenDashboardServer(server, port, env, options.opener, options.fetch);
}

async function listenDashboardServer(
  server: http.Server,
  port: number,
  env: Record<string, string | undefined>,
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
          if (shouldOpenDashboardBrowser(env.CODEX_MEMORY_DASHBOARD_OPEN)) {
            openDashboardUrl(existing.url, opener);
          }
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
      if (shouldOpenDashboardBrowser(env.CODEX_MEMORY_DASHBOARD_OPEN)) {
        openDashboardUrl(url, opener);
      }
      finish({
        started: true,
        url,
        warnings: [],
        close
      });
    });
  });
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
