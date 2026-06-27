import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type http from "node:http";
import net from "node:net";
import path from "node:path";

import type { MemorySidecarConfig } from "./config.js";
import {
  createDashboardServer,
  DASHBOARD_BUILD_FINGERPRINT,
  DASHBOARD_SCHEMA_VERSION,
  openDashboardUrl,
} from "./dashboard.js";
import { OllamaEmbeddingProvider } from "./embedding.js";
import type { MemoryStore } from "./memory-store.js";

export interface DashboardCompanionOptions {
  store: MemoryStore;
  config: MemorySidecarConfig;
  env?: Record<string, string | undefined>;
  port?: number;
  fetch?: typeof globalThis.fetch;
  opener?: Parameters<typeof openDashboardUrl>[1];
  processControl?: DashboardProcessControl;
}

export interface DashboardCompanionResult {
  started: boolean;
  url: string | null;
  warnings: string[];
  close: () => Promise<void>;
}

interface DashboardProcessControl {
  isAlive?: (pid: number) => boolean;
  inspectCommandLine?: (pid: number) => string | null | Promise<string | null>;
  terminate?: (pid: number) => boolean | Promise<boolean>;
}

interface DashboardOpenMarker {
  url?: string;
  schemaVersion?: string;
  buildFingerprint?: string;
  pid?: number;
  openedAt?: string;
  repoRoot?: string;
  databasePath?: string;
}

type ExistingDashboardProbe =
  | { kind: "reusable"; url: string }
  | { kind: "stale"; url: string; warning: string }
  | { kind: "unresponsive"; url: string; warning: string }
  | { kind: "foreign"; url: string; warning: string };

export function shouldStartDashboardWithMcp(value: string | undefined): boolean {
  if (value === undefined) {
    return true;
  }
  const normalized = value.trim().toLowerCase();
  return !["false", "0", "off", "no"].includes(normalized);
}

export async function startDashboardCompanion(
  options: DashboardCompanionOptions,
): Promise<DashboardCompanionResult> {
  const env = options.env ?? process.env;
  if (!shouldStartDashboardWithMcp(env.CODEX_MEMORY_DASHBOARD_ON_MCP_START)) {
    return {
      started: false,
      url: null,
      warnings: [],
      close: async () => undefined,
    };
  }

  const port = options.port ?? Number(env.CODEX_MEMORY_DASHBOARD_PORT ?? 3737);
  const openMarkerPath = path.join(
    path.dirname(options.config.databasePath),
    ".dashboard-opened.json",
  );
  const embeddingProvider =
    options.config.embeddingMode === "off"
      ? undefined
      : new OllamaEmbeddingProvider({
          baseUrl: options.config.ollamaBaseUrl,
          model: options.config.embeddingModel,
          fetch: options.fetch,
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
            fetch: options.fetch,
          },
    ollamaRequired: options.config.embeddingMode === "ollama",
  });

  return await listenDashboardServer(
    server,
    port,
    env,
    openMarkerPath,
    options.opener,
    options.fetch,
    options.processControl,
    options.config.databasePath,
  );
}

async function listenDashboardServer(
  server: http.Server,
  port: number,
  env: Record<string, string | undefined>,
  openMarkerPath: string,
  opener: Parameters<typeof openDashboardUrl>[1],
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
  processControl?: DashboardProcessControl,
  databasePath?: string,
): Promise<DashboardCompanionResult> {
  return await new Promise((resolve) => {
    const warnings: string[] = [];
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
      resolve({
        ...result,
        warnings: [...warnings, ...result.warnings],
      });
    };
    let fallbackReason: string | null = null;
    const onError = (error: NodeJS.ErrnoException) => {
      void (async () => {
        const existing =
          error.code === "EADDRINUSE" ? await findExistingSidecarDashboard(port, fetchImpl) : null;
        if (existing?.kind === "reusable") {
          console.error(
            `codex-memory-sidecar dashboard companion reused existing dashboard: ${existing.url}`,
          );
          openDashboardForMcp(
            existing.url,
            env.CODEX_MEMORY_DASHBOARD_OPEN,
            openMarkerPath,
            opener,
            databasePath,
          );
          finish({
            started: false,
            url: existing.url,
            warnings: [`Dashboard companion reused existing sidecar dashboard: ${existing.url}`],
            close,
          });
          return;
        }

        if (error.code === "EADDRINUSE") {
          const recovery = await recoverDashboardPortConflict({
            port,
            existing,
            openMarkerPath,
            processControl,
            databasePath,
          });
          if (recovery.retrySamePort) {
            warnings.push(recovery.warning);
            server.once("error", onError);
            server.listen(port, "127.0.0.1");
            return;
          }
          if (recovery.useFallbackPort) {
            fallbackReason = recovery.warning;
            server.once("error", onError);
            server.listen(0, "127.0.0.1");
            return;
          }
        }

        finish({
          started: false,
          url: null,
          warnings: [
            getProbeWarning(existing) ?? `Dashboard companion did not start: ${error.message}`,
          ],
          close,
        });
      })();
    };

    server.once("error", onError);
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      const actualPort = address && typeof address !== "string" ? address.port : port;
      const url = `http://127.0.0.1:${actualPort}`;
      if (fallbackReason) {
        warnings.push(`${fallbackReason} 退避先: ${url}`);
      }
      console.error(`codex-memory-sidecar dashboard companion: ${url}`);
      openDashboardForMcp(
        url,
        env.CODEX_MEMORY_DASHBOARD_OPEN,
        openMarkerPath,
        opener,
        databasePath,
      );
      finish({
        started: true,
        url,
        warnings: [],
        close,
      });
    });
  });
}

function openDashboardForMcp(
  url: string,
  value: string | undefined,
  markerPath: string,
  opener: Parameters<typeof openDashboardUrl>[1],
  databasePath?: string,
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
    rememberDashboardOpened(markerPath, url, databasePath);
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
    const marker = readDashboardOpenMarker(markerPath);
    return (
      marker !== null &&
      marker.url === url &&
      marker.schemaVersion === DASHBOARD_SCHEMA_VERSION &&
      marker.buildFingerprint === DASHBOARD_BUILD_FINGERPRINT &&
      typeof marker.pid === "number" &&
      isProcessAlive(marker.pid)
    );
  } catch {
    return false;
  }
}

function rememberDashboardOpened(markerPath: string, url: string, databasePath?: string): void {
  try {
    mkdirSync(path.dirname(markerPath), { recursive: true });
    writeFileSync(
      markerPath,
      JSON.stringify(
        {
          url,
          schemaVersion: DASHBOARD_SCHEMA_VERSION,
          buildFingerprint: DASHBOARD_BUILD_FINGERPRINT,
          pid: process.pid,
          openedAt: new Date().toISOString(),
          repoRoot: process.cwd(),
          databasePath,
        },
        null,
        2,
      ),
    );
  } catch {
    // Browser auto-open is a convenience; marker write failures should not affect MCP startup.
  }
}

async function findExistingSidecarDashboard(
  port: number,
  fetchImpl: typeof globalThis.fetch,
): Promise<ExistingDashboardProbe> {
  const url = `http://127.0.0.1:${port}`;
  try {
    const response = await fetchWithTimeout(fetchImpl, `${url}/api/status`, 1500);
    if (!response.ok) {
      return {
        kind: "foreign",
        url,
        warning: `既存のプロセス (${url}) は sidecar dashboard status を返しません。安全のため別ポートへ退避します。`,
      };
    }
    const status = (await response.json()) as unknown;
    if (!isRecord(status) || !isRecord(status.database) || !isRecord(status.embedding)) {
      return {
        kind: "foreign",
        url,
        warning: `既存のプロセス (${url}) は sidecar dashboard ではない可能性があります。安全のため別ポートへ退避します。`,
      };
    }
    const schemaVersion = isRecord(status.dashboard) ? status.dashboard.schemaVersion : null;
    const buildFingerprint = isRecord(status.dashboard) ? status.dashboard.buildFingerprint : null;
    if (
      schemaVersion !== DASHBOARD_SCHEMA_VERSION ||
      buildFingerprint !== DASHBOARD_BUILD_FINGERPRINT
    ) {
      return {
        kind: "stale",
        url,
        warning: `既存の Dashboard (${url}) は stale、または別ビルドの可能性があります。`,
      };
    }
    return { kind: "reusable", url };
  } catch {
    return {
      kind: "unresponsive",
      url,
      warning: `既存の Dashboard (${url}) は応答しません。`,
    };
  }
}

async function recoverDashboardPortConflict(input: {
  port: number;
  existing: ExistingDashboardProbe | null;
  openMarkerPath: string;
  processControl?: DashboardProcessControl;
  databasePath?: string;
}): Promise<{
  retrySamePort: boolean;
  useFallbackPort: boolean;
  warning: string;
}> {
  const url = `http://127.0.0.1:${input.port}`;
  const marker = readDashboardOpenMarker(input.openMarkerPath);
  const pid = marker?.url === url && typeof marker.pid === "number" ? marker.pid : null;
  const existingWarning =
    getProbeWarning(input.existing) ??
    `既存のプロセスが ${url} を使用中です。安全のため新しい Dashboard を別ポートへ起動します。`;
  if (
    pid !== null &&
    pid !== process.pid &&
    isDashboardProcessAlive(pid, input.processControl) &&
    (await isSafeToStopDashboardProcess(pid, marker, input.databasePath, input.processControl))
  ) {
    const terminated = await terminateDashboardProcess(pid, input.processControl);
    if (terminated && (await waitForPortAvailability(input.port, 3000))) {
      return {
        retrySamePort: true,
        useFallbackPort: false,
        warning: `stale Dashboard owner process (${pid}) を停止し、既定ポートを再利用します。`,
      };
    }
  }

  return {
    retrySamePort: false,
    useFallbackPort: true,
    warning: `${existingWarning} 停止対象を安全に特定できなかったため、別ポートへ退避します。`,
  };
}

function readDashboardOpenMarker(markerPath: string): DashboardOpenMarker | null {
  try {
    const marker = JSON.parse(readFileSync(markerPath, "utf8")) as unknown;
    return isRecord(marker) ? (marker as DashboardOpenMarker) : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getProbeWarning(existing: ExistingDashboardProbe | null): string | null {
  if (!existing || existing.kind === "reusable") {
    return null;
  }
  return existing.warning;
}

async function fetchWithTimeout(
  fetchImpl: typeof globalThis.fetch,
  url: string,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fetchImpl(url, { signal: controller.signal }),
      new Promise<Response>((_, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new Error(`Dashboard status probe timed out: ${url}`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function isDashboardProcessAlive(pid: number, processControl?: DashboardProcessControl): boolean {
  if (processControl?.isAlive) {
    return processControl.isAlive(pid);
  }
  return isProcessAlive(pid);
}

async function isSafeToStopDashboardProcess(
  pid: number,
  marker: DashboardOpenMarker | null,
  databasePath: string | undefined,
  processControl?: DashboardProcessControl,
): Promise<boolean> {
  const commandLine = await inspectDashboardProcessCommandLine(pid, processControl);
  if (!commandLine) {
    return false;
  }
  const normalized = normalizeForMatch(commandLine);
  const repoRoot = normalizeForMatch(marker?.repoRoot ?? process.cwd());
  const configuredDatabasePath = databasePath ? normalizeForMatch(databasePath) : null;
  const markerDatabasePath = marker?.databasePath ? normalizeForMatch(marker.databasePath) : null;
  const expectedEntrypoint = normalizeForMatch(path.join(process.cwd(), "dist", "src", "index.js"));

  return (
    normalized.includes(expectedEntrypoint) ||
    normalized.includes(repoRoot) ||
    (configuredDatabasePath !== null && normalized.includes(configuredDatabasePath)) ||
    (markerDatabasePath !== null && normalized.includes(markerDatabasePath))
  );
}

async function inspectDashboardProcessCommandLine(
  pid: number,
  processControl?: DashboardProcessControl,
): Promise<string | null> {
  if (processControl?.inspectCommandLine) {
    return await processControl.inspectCommandLine(pid);
  }

  try {
    if (process.platform === "win32") {
      const result = spawnSync(
        "powershell",
        [
          "-NoProfile",
          "-Command",
          `(Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}").CommandLine`,
        ],
        {
          encoding: "utf8",
          windowsHide: true,
        },
      );
      return result.status === 0 ? result.stdout.trim() || null : null;
    }

    const result = spawnSync("ps", ["-p", String(pid), "-o", "command="], {
      encoding: "utf8",
      windowsHide: true,
    });
    return result.status === 0 ? result.stdout.trim() || null : null;
  } catch {
    return null;
  }
}

async function terminateDashboardProcess(
  pid: number,
  processControl?: DashboardProcessControl,
): Promise<boolean> {
  if (processControl?.terminate) {
    return await processControl.terminate(pid);
  }

  try {
    if (process.platform === "win32") {
      const result = spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
        encoding: "utf8",
        windowsHide: true,
      });
      return result.status === 0;
    }
    process.kill(pid, "SIGTERM");
    return true;
  } catch {
    return false;
  }
}

async function waitForPortAvailability(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await canBindPort(port)) {
      return true;
    }
    await sleep(100);
  }
  return false;
}

async function canBindPort(port: number): Promise<boolean> {
  return await new Promise((resolve) => {
    const tester = net.createServer();
    tester.once("error", () => {
      resolve(false);
    });
    tester.listen(port, "127.0.0.1", () => {
      tester.close((error) => {
        resolve(!error);
      });
    });
  });
}

function sleep(timeoutMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, timeoutMs));
}

function normalizeForMatch(value: string): string {
  return value.replace(/\\/g, "/").toLowerCase();
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !isNodeErrno(error, "ESRCH");
  }
}

function isNodeErrno(error: unknown, code: string): boolean {
  return isRecord(error) && error.code === code;
}
