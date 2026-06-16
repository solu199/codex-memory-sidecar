#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import http, { type ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildAutoCurationResult,
  type AutoMemoryWriteMode,
  type AutoCurationEvaluation,
} from "./auto-curation.js";
import { loadConfig } from "./config.js";
import type { EmbeddingProvider } from "./embedding.js";
import { OllamaEmbeddingProvider } from "./embedding.js";
import { buildMemoryGraph } from "./memory-graph.js";
import {
  buildMemoryFreshness,
  collectWorkspaceActivity,
  type MemoryFreshness,
  type MemoryUpdateCandidate,
  type WorkspaceActivity,
} from "./memory-freshness.js";
import { MemoryStore } from "./memory-store.js";
import { runStartupMaintenance } from "./startup-maintenance.js";

export const DASHBOARD_SCHEMA_VERSION = "2026-06-13-dashboard-status-v3";
export const DASHBOARD_BUILD_FINGERPRINT = createHash("sha256")
  .update(readFileSync(fileURLToPath(import.meta.url)))
  .digest("hex")
  .slice(0, 16);

export interface DashboardOptions {
  embeddingProvider?: EmbeddingProvider;
  embeddingRequired?: boolean;
  ollama?: OllamaStatusOptions;
  ollamaRequired?: boolean;
  autoMemoryWrite?: AutoMemoryWriteMode;
  workspaceActivity?: WorkspaceActivity;
  now?: Date;
}

export interface OllamaStatusOptions {
  baseUrl: string;
  embeddingModel: string;
  maintenanceModel: string;
  fetch?: typeof globalThis.fetch;
}

type DashboardBrowserProcess = {
  on?: (event: "error", listener: (error: Error) => void) => unknown;
  unref?: () => void;
};

type DashboardBrowserOpener = (
  command: string,
  args: string[],
  options: {
    detached: boolean;
    stdio: "ignore";
    windowsHide: boolean;
  },
) => DashboardBrowserProcess;

export interface DashboardStatus {
  ok: boolean;
  checkedAt: string;
  dashboard: {
    schemaVersion: string;
    buildFingerprint: string;
  };
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
  maintenance: {
    repairRecommended: boolean;
    latestBackup: {
      backupPath: string;
      sizeBytes: number;
      mtime: string;
    } | null;
    backupRetention: {
      backupDir: string;
      keepCount: number;
      backupCount: number;
      keptCount: number;
      prunableCount: number;
      prunableSizeBytes: number;
      latestBackup: {
        backupPath: string;
        sizeBytes: number;
        mtime: string;
      } | null;
      prunable: Array<{
        backupPath: string;
        sizeBytes: number;
        mtime: string;
      }>;
    };
  };
  embedding: {
    ok: boolean;
    dimensions: number;
    error: string | null;
    required: boolean;
  };
  ollama: {
    ok: boolean;
    required: boolean;
    baseUrl: string;
    embeddingModel: string;
    maintenanceModel: string;
    embeddingModelAvailable: boolean;
    maintenanceModelAvailable: boolean;
    modelNames: string[];
    error: string | null;
  } | null;
  directives: Array<{
    id: number;
    scope: string;
    projectScope: string;
    content: string;
    rationale: string;
    tags: string[];
    sourceType: string;
    sourceRef: string;
    priority: number;
    status: string;
    updatedAt: string;
  }>;
  disabledDirectives: Array<{
    id: number;
    scope: string;
    projectScope: string;
    content: string;
    rationale: string;
    tags: string[];
    sourceType: string;
    sourceRef: string;
    priority: number;
    status: string;
    updatedAt: string;
  }>;
  recentMemories: Array<{
    id: number;
    layer: string;
    summary: string;
    tags: string[];
    projectScope: string;
    sourceType: string;
    sourceRef: string;
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
  memoryFreshness: MemoryFreshness;
  memoryUpdateCandidates: MemoryUpdateCandidate[];
  autoMemoryCuration: {
    mode: AutoMemoryWriteMode;
    threshold: number;
    evaluatedAt: string;
    evaluatedCount: number;
    reviewCount: number;
    autoWriteEligibleCount: number;
    skippedCount: number;
    evaluations: AutoCurationEvaluation[];
    note: string;
  };
  warnings: string[];
  warningActions: Array<{
    severity: "warning" | "error";
    title: string;
    message: string;
    action: string;
    tools: string[];
  }>;
}

export async function buildDashboardStatus(
  store: MemoryStore,
  options: DashboardOptions = {},
): Promise<DashboardStatus> {
  const embeddingRequired = options.embeddingRequired ?? true;
  const ollamaRequired = options.ollamaRequired ?? true;
  const counts = store.countRecords();
  const databaseHealth = store.checkDatabaseHealth();
  const memoryStats = store.getStats();
  const memoryFreshnessReport = buildMemoryFreshness({
    latestMemoryUpdatedAt: memoryStats.updatedAtRange.newest,
    memoryCount: counts.memoryCount,
    activity: options.workspaceActivity ?? collectWorkspaceActivity(process.cwd()),
    now: options.now,
  });
  const autoMemoryCuration = buildAutoCurationResult({
    mode: options.autoMemoryWrite ?? "safe",
    candidates: memoryFreshnessReport.candidates,
    existingMemories: store.listMemories({ limit: 500 }),
    now: options.now,
  });
  const backupRetention = store.planBackupRetention();
  const latestBackup = backupRetention.backups[0] ?? null;
  const embedding = options.embeddingProvider
    ? await probeEmbedding(options.embeddingProvider, embeddingRequired)
    : {
        ok: !embeddingRequired,
        dimensions: 0,
        error: embeddingRequired ? "Embedding provider is not configured." : null,
        required: embeddingRequired,
      };
  const ollama = options.ollama
    ? { ...(await probeOllamaStatus(options.ollama)), required: ollamaRequired }
    : null;
  const warnings = [
    ...databaseHealth.warnings,
    ...(embedding.ok || !embeddingRequired
      ? []
      : [embedding.error ?? "Embedding provider is unavailable."]),
    ...ollamaWarnings(ollama, ollamaRequired),
  ];
  const warningActions = buildWarningActions({
    warnings,
    repairRecommended:
      !databaseHealth.ok && (databaseHealth.integrityCheck !== "ok" || !databaseHealth.fts.ok),
    ollama,
    ollamaRequired,
    memoryFreshness: memoryFreshnessReport.freshness,
  });

  return {
    ok:
      databaseHealth.ok &&
      (embedding.ok || !embeddingRequired) &&
      (!ollama || ollama.ok || !ollamaRequired),
    checkedAt: new Date().toISOString(),
    dashboard: {
      schemaVersion: DASHBOARD_SCHEMA_VERSION,
      buildFingerprint: DASHBOARD_BUILD_FINGERPRINT,
    },
    database: {
      ok: databaseHealth.ok,
      memoryCount: counts.memoryCount,
      eventCount: counts.eventCount,
      integrityCheck: databaseHealth.integrityCheck,
      fts: databaseHealth.fts,
      walCheckpoint: databaseHealth.walCheckpoint,
    },
    memoryStats: {
      byStatus: memoryStats.byStatus,
      byLayer: memoryStats.byLayer,
      byProjectScope: memoryStats.byProjectScope.map((scope) => ({
        projectScope: scope.projectScope,
        total: scope.total,
        active: scope.active,
        latestUpdatedAt: scope.latestUpdatedAt?.toISOString() ?? null,
      })),
      updatedAtRange: {
        oldest: memoryStats.updatedAtRange.oldest?.toISOString() ?? null,
        newest: memoryStats.updatedAtRange.newest?.toISOString() ?? null,
      },
    },
    maintenance: {
      repairRecommended:
        !databaseHealth.ok && (databaseHealth.integrityCheck !== "ok" || !databaseHealth.fts.ok),
      latestBackup: latestBackup ? serializeDashboardBackup(latestBackup) : null,
      backupRetention: {
        backupDir: backupRetention.backupDir,
        keepCount: backupRetention.keepCount,
        backupCount: backupRetention.backups.length,
        keptCount: backupRetention.kept.length,
        prunableCount: backupRetention.prunable.length,
        prunableSizeBytes: backupRetention.prunable.reduce(
          (total, backup) => total + backup.sizeBytes,
          0,
        ),
        latestBackup: latestBackup ? serializeDashboardBackup(latestBackup) : null,
        prunable: backupRetention.prunable.map(serializeDashboardBackup),
      },
    },
    embedding,
    ollama,
    directives: serializeDashboardDirectives([
      ...store.listDirectives({ includeGlobal: false, includeProject: true, limit: 50 }),
      ...store.listDirectives({ includeGlobal: true, includeProject: false, limit: 50 }),
    ]),
    disabledDirectives: serializeDashboardDirectives(
      [
        ...store.listDirectives({
          includeGlobal: false,
          includeProject: true,
          includeDisabled: true,
          limit: 100,
        }),
        ...store.listDirectives({
          includeGlobal: true,
          includeProject: false,
          includeDisabled: true,
          limit: 100,
        }),
      ].filter((directive) => directive.status !== "active"),
    ),
    recentMemories: store.listMemories({ limit: 10 }).map((memory) => ({
      id: memory.id,
      layer: memory.layer,
      summary: memory.summary,
      tags: memory.tags,
      projectScope: memory.projectScope,
      sourceType: memory.sourceType,
      sourceRef: memory.sourceRef,
      importance: memory.importance,
      confidence: memory.confidence,
      status: memory.status,
      updatedAt: memory.updatedAt.toISOString(),
    })),
    recentEvents: store.listRecentEvents({ limit: 10 }).map((event) => ({
      id: event.id,
      memoryId: event.memoryId,
      eventType: event.eventType,
      createdAt: event.createdAt.toISOString(),
    })),
    memoryFreshness: memoryFreshnessReport.freshness,
    memoryUpdateCandidates: autoMemoryCuration.reviewCandidates.map(
      (evaluation) => evaluation.candidate,
    ),
    autoMemoryCuration: {
      mode: autoMemoryCuration.mode,
      threshold: autoMemoryCuration.threshold,
      evaluatedAt: autoMemoryCuration.evaluatedAt,
      evaluatedCount: autoMemoryCuration.evaluated.length,
      reviewCount: autoMemoryCuration.reviewCandidates.length,
      autoWriteEligibleCount: autoMemoryCuration.autoWriteCandidates.length,
      skippedCount: autoMemoryCuration.skippedCandidates.length,
      evaluations: autoMemoryCuration.evaluated,
      note: "Dashboard は評価結果だけを表示します。safe mode の自動保存は start_memory_session の実行時に行います。",
    },
    warnings,
    warningActions,
  };
}

function serializeDashboardBackup(
  backup: ReturnType<MemoryStore["planBackupRetention"]>["backups"][number],
) {
  return {
    backupPath: backup.backupPath,
    sizeBytes: backup.sizeBytes,
    mtime: backup.mtime.toISOString(),
  };
}

function serializeDashboardDirectives(
  directives: ReturnType<MemoryStore["listDirectives"]>,
): DashboardStatus["directives"] {
  return directives.map((directive) => ({
    id: directive.id,
    scope: directive.scope,
    projectScope: directive.projectScope,
    content: directive.content,
    rationale: directive.rationale,
    tags: directive.tags,
    sourceType: directive.sourceType,
    sourceRef: directive.sourceRef,
    priority: directive.priority,
    status: directive.status,
    updatedAt: directive.updatedAt.toISOString(),
  }));
}

export function createDashboardServer(
  store: MemoryStore,
  options: DashboardOptions = {},
): http.Server {
  return http.createServer(async (request, response) => {
    try {
      if (!isAllowedDashboardHostHeader(request.headers.host)) {
        sendText(response, 403, "Forbidden");
        return;
      }

      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (request.method !== "GET") {
        sendText(response, 405, "Method Not Allowed");
        return;
      }

      if (url.pathname === "/api/status") {
        sendJson(response, 200, await buildDashboardStatus(store, options));
        return;
      }

      if (url.pathname === "/api/graph") {
        sendJson(response, 200, buildMemoryGraph(store));
        return;
      }

      if (url.pathname === "/assets/observatory-3d.bundle.js") {
        sendJavaScript(
          response,
          200,
          readFileSync(path.join(process.cwd(), "vendor", "observatory-3d.bundle.js"), "utf8"),
        );
        return;
      }

      if (url.pathname === "/favicon.ico") {
        response.writeHead(204, { "cache-control": "public, max-age=86400" });
        response.end();
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

export function isAllowedDashboardHostHeader(hostHeader: string | undefined): boolean {
  if (!hostHeader) {
    return false;
  }
  const value = hostHeader.trim().toLowerCase();
  if (!value) {
    return false;
  }
  if (value === "::1") {
    return true;
  }
  if (value.startsWith("[")) {
    const closingBracket = value.indexOf("]");
    if (closingBracket === -1) {
      return false;
    }
    const hostname = value.slice(1, closingBracket);
    const suffix = value.slice(closingBracket + 1);
    return hostname === "::1" && (suffix === "" || /^:\d+$/.test(suffix));
  }
  const [hostname, ...rest] = value.split(":");
  const hasValidPort = rest.length === 0 || (rest.length === 1 && /^\d+$/.test(rest[0] ?? ""));
  return hasValidPort && (hostname === "127.0.0.1" || hostname === "localhost");
}

export function shouldOpenDashboardBrowser(value: string | undefined): boolean {
  if (value === undefined) {
    return true;
  }
  const normalized = value.trim().toLowerCase();
  return !["false", "0", "off", "no"].includes(normalized);
}

export function openDashboardUrl(url: string, opener: DashboardBrowserOpener = spawn): boolean {
  const command =
    process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];

  try {
    const child = opener(command, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.on?.("error", (error) => {
      console.warn(`codex-memory-sidecar dashboard browser open failed: ${error.message}`);
    });
    child.unref?.();
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`codex-memory-sidecar dashboard browser open failed: ${message}`);
    return false;
  }
}

export async function probeOllamaStatus(
  options: OllamaStatusOptions,
): Promise<Omit<NonNullable<DashboardStatus["ollama"]>, "required">> {
  const baseUrl = options.baseUrl.replace(/\/$/, "");
  const fetchImpl = options.fetch ?? globalThis.fetch;

  try {
    const response = await fetchImpl(`${baseUrl}/api/tags`);
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Ollama tags request failed (${response.status}): ${body}`);
    }

    const json = (await response.json()) as unknown;
    const modelNames = readOllamaModelNames(json);
    const embeddingModelAvailable = hasOllamaModel(modelNames, options.embeddingModel);
    const maintenanceModelAvailable = hasOllamaModel(modelNames, options.maintenanceModel);

    return {
      ok: embeddingModelAvailable && maintenanceModelAvailable,
      baseUrl,
      embeddingModel: options.embeddingModel,
      maintenanceModel: options.maintenanceModel,
      embeddingModelAvailable,
      maintenanceModelAvailable,
      modelNames,
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      baseUrl,
      embeddingModel: options.embeddingModel,
      maintenanceModel: options.maintenanceModel,
      embeddingModelAvailable: false,
      maintenanceModelAvailable: false,
      modelNames: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function ollamaWarnings(ollama: DashboardStatus["ollama"], required: boolean): string[] {
  if (!ollama) {
    return [];
  }
  if (!required) {
    return [];
  }
  if (ollama.error) {
    return [`Ollama model status unavailable: ${ollama.error}`];
  }
  const warnings: string[] = [];
  if (!ollama.embeddingModelAvailable) {
    warnings.push(`Ollama model is not available: ${ollama.embeddingModel}`);
  }
  if (!ollama.maintenanceModelAvailable) {
    warnings.push(`Ollama model is not available: ${ollama.maintenanceModel}`);
  }
  return warnings;
}

function buildWarningActions(options: {
  warnings: string[];
  repairRecommended: boolean;
  ollama: DashboardStatus["ollama"];
  ollamaRequired: boolean;
  memoryFreshness: MemoryFreshness;
}): DashboardStatus["warningActions"] {
  const actions: DashboardStatus["warningActions"] = [];

  if (
    (options.memoryFreshness.status === "stale" || options.memoryFreshness.status === "empty") &&
    options.memoryFreshness.candidateCount > 0
  ) {
    actions.push({
      severity: "warning",
      title: "メモリ更新が古い可能性があります",
      message: options.memoryFreshness.message,
      action: options.memoryFreshness.recommendedAction,
      tools: ["propose_memory_update", "write_memory"],
    });
  }

  if (
    options.repairRecommended ||
    options.warnings.some(
      (warning) => warning.includes("FTS index is missing") || warning.includes("FTS index has"),
    )
  ) {
    actions.push({
      severity: "warning",
      title: "検索インデックスの修復が必要です",
      message: "全文検索インデックスとメモリDBの内容に差分があります。",
      action: "MCP tool の repair_memory_index を実行してください。",
      tools: ["backup_memory", "repair_memory_index", "health_check"],
    });
  }

  if (
    options.warnings.some(
      (warning) =>
        warning.includes("Embedding provider") || warning.includes("Embedding unavailable"),
    )
  ) {
    actions.push({
      severity: "warning",
      title: "Embedding が利用できません",
      message: "検索の意味ベクトル処理が使えないため、検索品質が下がる可能性があります。",
      action: "Ollama アプリの起動状態と embedding model のインストール状態を確認してください。",
      tools: ["health_check"],
    });
  }

  if (options.ollamaRequired && options.ollama?.error) {
    actions.push({
      severity: "warning",
      title: "Ollama に接続できません",
      message: options.ollama.error,
      action: "Ollama アプリを起動し、OLLAMA_BASE_URL の endpoint が正しいか確認してください。",
      tools: ["health_check"],
    });
  }

  if (options.ollamaRequired && options.ollama && !options.ollama.error) {
    const missingModels = [
      ...(options.ollama.embeddingModelAvailable ? [] : [options.ollama.embeddingModel]),
      ...(options.ollama.maintenanceModelAvailable ? [] : [options.ollama.maintenanceModel]),
    ];
    for (const model of missingModels) {
      actions.push({
        severity: "warning",
        title: "Ollama モデルが見つかりません",
        message: `設定済みモデル ${model} が Ollama のモデル一覧にありません。`,
        action: `Ollama に不足モデルを追加してください: ollama pull ${model}`,
        tools: ["health_check"],
      });
    }
  }

  if (options.warnings.length > 0 && actions.length === 0) {
    actions.push({
      severity: "warning",
      title: "確認が必要な警告があります",
      message: options.warnings.join(" / "),
      action:
        "README と health_check の結果を確認し、必要ならバックアップを作成してから対応してください。",
      tools: ["health_check", "backup_memory"],
    });
  }

  return actions;
}

function readOllamaModelNames(json: unknown): string[] {
  if (!isRecord(json) || !Array.isArray(json.models)) {
    return [];
  }

  return json.models.flatMap((model) => {
    if (!isRecord(model) || typeof model.name !== "string") {
      return [];
    }
    return [model.name];
  });
}

function hasOllamaModel(modelNames: string[], configuredModel: string): boolean {
  return modelNames.some(
    (name) =>
      name === configuredModel ||
      name === `${configuredModel}:latest` ||
      name.split(":")[0] === configuredModel,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function probeEmbedding(
  provider: EmbeddingProvider,
  required: boolean,
): Promise<DashboardStatus["embedding"]> {
  try {
    const vector = await provider.embed("codex memory sidecar dashboard health check");
    return {
      ok: true,
      dimensions: vector.length,
      error: null,
      required,
    };
  } catch (error) {
    return {
      ok: false,
      dimensions: 0,
      error: error instanceof Error ? error.message : String(error),
      required,
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
  <script src="/assets/observatory-3d.bundle.js"></script>
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
      min-height: 100vh;
    }
    .app-shell {
      display: grid;
      grid-template-columns: 220px minmax(0, 1fr);
      min-height: 100vh;
      background:
        radial-gradient(circle at 50% 20%, rgba(37, 99, 235, 0.1), transparent 34%),
        #f7f4ef;
    }
    .app-nav {
      border-right: 1px solid #d2d6dc;
      background: #ffffff;
      padding: 20px 14px;
      position: sticky;
      top: 0;
      height: 100vh;
      box-sizing: border-box;
    }
    .brand {
      font-weight: 800;
      line-height: 1.2;
      margin-bottom: 20px;
    }
    .nav-button {
      width: 100%;
      display: block;
      text-align: left;
      margin-bottom: 8px;
      border-color: transparent;
      background: transparent;
    }
    .nav-button.active {
      background: #e7eefc;
      border-color: #b9c9e9;
      color: #1d4ed8;
    }
    .app-content {
      padding: 24px;
      min-width: 0;
    }
    .app-inspector {
      border-left: 1px solid #d2d6dc;
      background: #ffffff;
      padding: 20px 14px;
      position: sticky;
      top: 0;
      height: 100vh;
      box-sizing: border-box;
      overflow: auto;
    }
    .app-view {
      display: none;
    }
    .app-view.active {
      display: block;
    }
    .hero-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      margin-bottom: 16px;
    }
    .mode-row {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 6px;
      margin-bottom: 12px;
    }
    .mode-button.active {
      background: #1d4ed8;
      color: #ffffff;
      border-color: #1d4ed8;
    }
    .field {
      width: 100%;
      box-sizing: border-box;
      border: 1px solid #9aa5b1;
      border-radius: 6px;
      padding: 8px 10px;
      margin-bottom: 12px;
      background: #ffffff;
      color: #1f2933;
    }
    .toggle-list label {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 0;
      font-size: 14px;
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
    .observatory {
      position: relative;
      min-height: calc(100vh - 112px);
    }
    .graph-canvas {
      width: 100%;
      height: calc(100vh - 150px);
      min-height: 520px;
      display: block;
      border: 1px solid #1f2f4d;
      border-radius: 8px;
      background: #0f172a;
    }
    .action-list li {
      display: block;
    }
    .action-title {
      display: block;
      font-weight: 700;
      margin-bottom: 4px;
    }
    .action-body {
      display: block;
      color: #52606d;
      line-height: 1.5;
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
    #view-observatory {
      height: calc(100vh - 48px);
      min-height: 640px;
    }
    .observatory-prototype {
      --obs-bg: #070b14;
      --obs-panel: rgba(13, 19, 34, 0.92);
      --obs-line: rgba(120, 150, 210, 0.18);
      --obs-text: #c8d4ee;
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 640px;
      background: #070b14;
      color: var(--obs-text);
      border: 1px solid var(--obs-line);
      border-radius: 8px;
      overflow: hidden;
      font-family: "Segoe UI", "Hiragino Sans", "Yu Gothic UI", sans-serif;
    }
    .observatory-prototype header {
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 10px 16px;
      border-bottom: 1px solid var(--obs-line);
      background: var(--obs-panel);
      margin: 0;
      z-index: 5;
    }
    .observatory-prototype h1 {
      font-size: 15px;
      margin: 0;
      font-weight: 600;
      letter-spacing: 0.06em;
      color: #dce6ff;
    }
    .observatory-prototype h1 .sub {
      color: #6f81a8;
      font-weight: 400;
      font-size: 11px;
      margin-left: 8px;
    }
    .observatory-mode-drawer {
      position: relative;
    }
    .observatory-mode-drawer summary {
      list-style: none;
      background: transparent;
      color: #9fb1d8;
      border: 1px solid var(--obs-line);
      border-radius: 6px;
      padding: 5px 12px;
      cursor: pointer;
      font-size: 12px;
      user-select: none;
    }
    .observatory-mode-drawer summary::-webkit-details-marker {
      display: none;
    }
    .observatory-mode-drawer summary::after {
      content: " +";
      color: #5d83d6;
    }
    .observatory-mode-drawer[open] summary::after {
      content: " -";
    }
    .observatory-mode-panel {
      position: absolute;
      top: calc(100% + 8px);
      right: 0;
      z-index: 10;
      display: grid;
      grid-template-columns: repeat(3, minmax(64px, 1fr));
      gap: 6px;
      width: 280px;
      padding: 10px;
      border: 1px solid var(--obs-line);
      border-radius: 8px;
      background: rgba(9, 14, 26, 0.96);
      box-shadow: 0 16px 38px rgba(0, 0, 0, 0.34);
    }
    .observatory-tabs {
      display: contents;
    }
    .observatory-mode-panel .ctrl {
      grid-column: 1 / -1;
    }
    .observatory-tabs button,
    .observatory-prototype button.ctrl {
      background: transparent;
      color: #8fa1c7;
      border: 1px solid var(--obs-line);
      border-radius: 6px;
      padding: 5px 14px;
      cursor: pointer;
      font-size: 12px;
    }
    .observatory-tabs button.active,
    .observatory-prototype button.ctrl:hover {
      background: #1d2c4f;
      color: #dce6ff;
      border-color: #3a518f;
    }
    .observatory-prototype .spacer {
      flex: 1;
    }
    #searchBox {
      background: #0d1426;
      border: 1px solid var(--obs-line);
      color: var(--obs-text);
      border-radius: 6px;
      padding: 6px 10px;
      font-size: 12px;
      width: 230px;
    }
    .observatory-main {
      flex: 1;
      display: flex;
      min-height: 0;
    }
    #graph {
      flex: 1;
      min-width: 0;
      position: relative;
      background: #070b14;
    }
    #loading {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #586994;
      font-size: 13px;
      letter-spacing: 0.2em;
    }
    .observatory-prototype aside {
      flex: 0 0 300px;
      width: 300px;
      border-left: 1px solid var(--obs-line);
      background: rgba(9, 14, 26, 0.97);
      box-shadow: inset 1px 0 0 rgba(121, 168, 255, 0.08);
      padding: 12px 14px;
      overflow-y: auto;
      font-size: 12px;
    }
    .observatory-prototype aside h2 {
      font-size: 11px;
      letter-spacing: 0.12em;
      color: #6f81a8;
      margin: 14px 0 6px;
      text-transform: uppercase;
    }
    .observatory-prototype aside h2:first-child {
      margin-top: 0;
    }
    #feed {
      list-style: none;
      margin: 0;
      padding: 0;
      max-height: 190px;
      overflow-y: auto;
    }
    #feed li {
      padding: 4px 6px;
      border-left: 2px solid #506da8;
      margin-bottom: 4px;
      background: rgba(20, 30, 56, 0.74);
      border-radius: 0 4px 4px 0;
      line-height: 1.5;
    }
    #feed li .q {
      color: #e8eeff;
      font-weight: 600;
    }
    #feed li .meta {
      color: #6f81a8;
      font-size: 10px;
    }
    .fc {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 5px;
    }
    .fc .nm {
      width: 130px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: #9fb1d8;
    }
    .fc .bar {
      flex: 1;
      height: 6px;
      background: #16213d;
      border-radius: 3px;
      overflow: hidden;
    }
    .fc .bar i {
      display: block;
      height: 100%;
      background: linear-gradient(90deg, #3b5db8, #79a8ff);
    }
    .fc .pc {
      width: 34px;
      text-align: right;
      color: #8fa1c7;
      font-variant-numeric: tabular-nums;
    }
    #legend div {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 4px;
      cursor: pointer;
    }
    #legend div.off {
      opacity: 0.35;
    }
    #legend i {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      display: inline-block;
    }
    #stats {
      color: #8fa1c7;
      line-height: 1.8;
    }
    label.opt {
      display: flex;
      gap: 6px;
      align-items: center;
      color: #8fa1c7;
      cursor: pointer;
      margin-bottom: 5px;
    }
    #timeline {
      display: none;
      align-items: center;
      gap: 12px;
      padding: 8px 16px;
      border-top: 1px solid var(--obs-line);
      background: var(--obs-panel);
    }
    #timeline.show {
      display: flex;
    }
    #scrub {
      flex: 1;
      accent-color: #5d83d6;
    }
    #timeLabel {
      font-variant-numeric: tabular-nums;
      color: #9fb1d8;
      font-size: 12px;
      width: 110px;
    }
    #replaySpeed {
      background: #0d1426;
      color: var(--obs-text);
      border: 1px solid var(--obs-line);
      border-radius: 6px;
      padding: 4px 6px;
      font-size: 12px;
    }
    #tooltip {
      position: fixed;
      pointer-events: none;
      display: none;
      z-index: 20;
      background: rgba(10, 16, 32, 0.95);
      border: 1px solid #33518f;
      border-radius: 8px;
      padding: 10px 12px;
      max-width: 320px;
      color: #dce6ff;
      font-size: 12px;
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
      line-height: 1.5;
    }
    #tooltip .t {
      color: #8fa1c7;
    }
    #tooltip .reveal {
      color: #f5d78f;
    }
    .observatory-prototype .hint {
      color: #6f81a8;
      line-height: 1.5;
      margin-top: 10px;
    }
    .app-shell {
      grid-template-columns: 136px minmax(0, 1fr);
      background:
        radial-gradient(circle at 74% 45%, rgba(235, 151, 35, 0.12), transparent 20%),
        radial-gradient(circle at 40% 50%, rgba(17, 148, 190, 0.12), transparent 28%),
        linear-gradient(135deg, #05090f 0%, #071019 46%, #020509 100%);
      color: #edf3ff;
    }
    .app-nav {
      display: flex;
      flex-direction: column;
      border-right: 1px solid rgba(238, 160, 48, 0.18);
      background: linear-gradient(180deg, rgba(10, 19, 27, 0.98), rgba(5, 10, 16, 0.98));
      padding: 20px 12px;
      color: #d7e4f7;
      box-shadow: inset -1px 0 0 rgba(255, 255, 255, 0.04);
    }
    .brand {
      color: #f3f7ff;
      font-size: 14px;
      letter-spacing: 0;
      margin-bottom: 28px;
    }
    .nav-button {
      color: #b9c6dc;
      border: 1px solid transparent;
      border-radius: 6px;
      padding: 9px 10px;
      font-size: 12px;
      margin-bottom: 9px;
      background: transparent;
    }
    .nav-button:hover {
      color: #fff6df;
      border-color: rgba(238, 160, 48, 0.24);
      background: rgba(238, 160, 48, 0.08);
    }
    .nav-button.active {
      color: #ffd894;
      border-color: rgba(238, 160, 48, 0.72);
      background: linear-gradient(90deg, rgba(238, 160, 48, 0.22), rgba(238, 160, 48, 0.04));
      box-shadow: inset 3px 0 0 #ee9b24, 0 0 22px rgba(238, 155, 36, 0.10);
    }
    #refresh {
      margin-top: auto;
      width: 58px;
      border-color: rgba(238, 160, 48, 0.52);
      color: #ffc56b;
      background: rgba(238, 160, 48, 0.07);
      font-size: 12px;
    }
    .app-content {
      padding: 14px 14px 14px 0;
    }
    #view-observatory {
      height: calc(100vh - 28px);
      min-height: 650px;
    }
    .observatory-prototype {
      --obs-bg: #060b12;
      --obs-panel: rgba(8, 14, 22, 0.86);
      --obs-line: rgba(238, 160, 48, 0.22);
      --obs-text: #dbe7fb;
      border-color: rgba(238, 160, 48, 0.34);
      border-radius: 8px;
      background:
        radial-gradient(circle at 42% 48%, rgba(21, 132, 176, 0.13), transparent 25%),
        radial-gradient(circle at 70% 50%, rgba(238, 160, 48, 0.11), transparent 24%),
        #060b12;
      box-shadow: 0 24px 80px rgba(0, 0, 0, 0.42);
    }
    .observatory-prototype header {
      min-height: 48px;
      padding: 8px 14px;
      border-bottom-color: rgba(238, 160, 48, 0.18);
      background: rgba(5, 10, 16, 0.86);
      backdrop-filter: blur(10px);
    }
    .observatory-prototype h1 {
      color: #f3f7ff;
      font-size: 14px;
      font-weight: 700;
      letter-spacing: 0;
    }
    .observatory-prototype h1 .sub {
      color: #7f8fa8;
      font-size: 10px;
      letter-spacing: 0;
    }
    #searchBox {
      width: 248px;
      border-color: rgba(95, 127, 170, 0.42);
      background: rgba(8, 14, 22, 0.76);
      color: #dbe7fb;
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03);
    }
    .observatory-mode-drawer summary,
    .observatory-tabs button,
    .observatory-prototype button.ctrl,
    #replaySpeed {
      border-color: rgba(238, 160, 48, 0.25);
      color: #d3ddf0;
      background: rgba(8, 14, 22, 0.64);
    }
    .observatory-mode-drawer summary:hover,
    .observatory-tabs button.active,
    .observatory-prototype button.ctrl:hover {
      color: #ffd891;
      border-color: rgba(238, 160, 48, 0.72);
      background: linear-gradient(90deg, rgba(238, 160, 48, 0.22), rgba(238, 160, 48, 0.06));
    }
    .observatory-mode-drawer summary::after {
      color: #ee9b24;
    }
    .observatory-mode-panel {
      border-color: rgba(238, 160, 48, 0.28);
      background: rgba(5, 10, 16, 0.97);
    }
    #graph {
      background:
        radial-gradient(circle at 50% 55%, rgba(22, 150, 190, 0.16), transparent 21%),
        radial-gradient(circle at 72% 54%, rgba(238, 160, 48, 0.12), transparent 24%),
        linear-gradient(rgba(64, 95, 125, 0.10) 1px, transparent 1px),
        linear-gradient(90deg, rgba(64, 95, 125, 0.10) 1px, transparent 1px),
        #07101a;
      background-size: auto, auto, 24px 24px, 24px 24px, auto;
      overflow: hidden;
    }
    #graph::before,
    #graph::after {
      content: "";
      position: absolute;
      pointer-events: none;
      z-index: 3;
    }
    #graph::before {
      inset: 0;
      background:
        radial-gradient(circle at 52% 56%, rgba(22, 150, 190, 0.18), transparent 24%),
        radial-gradient(circle at 73% 56%, rgba(238, 160, 48, 0.12), transparent 22%),
        linear-gradient(rgba(64, 95, 125, 0.12) 1px, transparent 1px),
        linear-gradient(90deg, rgba(64, 95, 125, 0.12) 1px, transparent 1px);
      background-size: auto, auto, 26px 26px, 26px 26px;
      opacity: 0.52;
      mix-blend-mode: screen;
    }
    #graph::after {
      left: 50%;
      top: 56%;
      width: 620px;
      height: 238px;
      border: 1px solid rgba(21, 150, 190, 0.18);
      border-radius: 50%;
      transform: translate(-50%, -50%);
      box-shadow:
        0 0 0 86px rgba(238, 160, 48, 0.016),
        inset 0 0 30px rgba(22, 150, 190, 0.08);
    }
    #graph canvas {
      position: relative;
      z-index: 2;
    }
    #graph-statusbar {
      position: absolute;
      left: 12px;
      bottom: 12px;
      z-index: 4;
      display: flex;
      gap: 8px;
      align-items: center;
      max-width: calc(100% - 24px);
      overflow: hidden;
    }
    #graph-statusbar span {
      border: 1px solid rgba(238, 160, 48, 0.18);
      border-radius: 5px;
      background: rgba(4, 8, 14, 0.72);
      color: #aebbd3;
      padding: 6px 9px;
      font-size: 11px;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    #graph-statusbar span:first-child {
      color: #ffd891;
      border-color: rgba(238, 160, 48, 0.45);
    }
    .observatory-prototype aside {
      flex-basis: 300px;
      width: 300px;
      border-left-color: rgba(238, 160, 48, 0.24);
      background: rgba(4, 8, 14, 0.88);
      backdrop-filter: blur(12px);
      box-shadow: inset 1px 0 0 rgba(255, 255, 255, 0.04);
    }
    .observatory-prototype aside h2 {
      color: #d99532;
      letter-spacing: 0.04em;
      text-transform: none;
    }
    #feed li {
      border-left-color: rgba(238, 160, 48, 0.78);
      background: rgba(14, 22, 34, 0.86);
    }
    #feed li .q {
      color: #ffd891;
    }
    #feed li .meta {
      color: #7e8ea8;
    }
    .fc .bar {
      background: rgba(34, 50, 76, 0.82);
    }
    .fc .bar i {
      background: linear-gradient(90deg, #ee9b24, #ffd891);
      box-shadow: 0 0 14px rgba(238, 155, 36, 0.22);
    }
    #legend i {
      box-shadow: 0 0 10px currentColor;
    }
    #stats {
      color: #aebbd3;
      line-height: 1.7;
    }
    label.opt {
      color: #b9c6dc;
    }
    label.opt input {
      accent-color: #ee9b24;
    }
    #timeline {
      border-top-color: rgba(238, 160, 48, 0.20);
      background: rgba(5, 10, 16, 0.90);
    }
    .panel,
    table {
      color: #dbe7fb;
      border-color: rgba(95, 127, 170, 0.28);
      background: rgba(8, 14, 22, 0.82);
    }
    th {
      background: rgba(238, 160, 48, 0.08);
      color: #ffd891;
    }
    th, td,
    .stats-list li {
      border-color: rgba(95, 127, 170, 0.22);
    }
    .label,
    .tags,
    .action-body {
      color: #aebbd3;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        background: #111827;
        color: #f9fafb;
      }
      .app-shell {
        background:
          radial-gradient(circle at 50% 20%, rgba(96, 165, 250, 0.13), transparent 34%),
          #111827;
      }
      .app-nav, .app-inspector {
        background: #111827;
        border-color: #374151;
      }
      .nav-button.active {
        background: #1e3a8a;
        color: #dbeafe;
        border-color: #2563eb;
      }
      .field {
        background: #1f2937;
        color: #f9fafb;
        border-color: #4b5563;
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
      .graph-canvas {
        border-color: #4b5563;
      }
      .action-body {
        color: #cbd5e1;
      }
    }
    @media (prefers-color-scheme: dark) {
      .app-shell {
        grid-template-columns: 136px minmax(0, 1fr);
        background:
          radial-gradient(circle at 58% 26%, rgba(22, 150, 190, 0.18), transparent 32%),
          radial-gradient(circle at 75% 70%, rgba(238, 160, 48, 0.10), transparent 28%),
          #060a10;
      }
      .app-nav {
        background: linear-gradient(180deg, #080d14, #05080d);
        border-right-color: rgba(238, 160, 48, 0.22);
      }
      .app-inspector {
        background: rgba(4, 8, 14, 0.88);
        border-color: rgba(238, 160, 48, 0.24);
      }
      .nav-button.active {
        color: #ffd891;
        border-color: rgba(238, 160, 48, 0.72);
        background: linear-gradient(90deg, rgba(238, 160, 48, 0.22), rgba(238, 160, 48, 0.04));
      }
      button,
      .panel,
      table {
        color: #dbe7fb;
        border-color: rgba(95, 127, 170, 0.28);
        background: rgba(8, 14, 22, 0.82);
      }
    }
    @media (max-width: 760px) {
      .app-shell {
        grid-template-columns: 1fr;
      }
      .app-nav, .app-inspector {
        position: static;
        height: auto;
      }
      .app-nav {
        border-right: 0;
        border-bottom: 1px solid #d2d6dc;
      }
      .app-inspector {
        border-left: 0;
        border-top: 1px solid #d2d6dc;
      }
      .graph-canvas {
        height: 420px;
        min-height: 420px;
      }
    }
  </style>
</head>
<body>
  <main class="app-shell">
    <nav class="app-nav">
      <div class="brand">Codex Memory<br>Sidecar</div>
      <button type="button" class="nav-button active" data-view-target="observatory">観測</button>
      <button type="button" class="nav-button" data-view-target="health">状態</button>
      <button type="button" class="nav-button" data-view-target="memories">メモリ</button>
      <button type="button" class="nav-button" data-view-target="directives">Directive</button>
      <button type="button" class="nav-button" data-view-target="maintenance">メンテナンス</button>
      <button type="button" class="nav-button" data-view-target="events">イベント</button>
      <button type="button" class="nav-button" data-view-target="settings">設定</button>
      <button type="button" id="refresh">更新</button>
    </nav>
    <section class="app-content">
      <section id="view-observatory" class="app-view active">
        <div class="observatory-prototype" id="observatory-app">
          <header>
            <h1>Memory Observatory <span style="color: #79a8ff">3D</span><span class="sub">活性度=奥行き / 忘却の霧 / 回転・ズーム・ドラッグ対応</span></h1>
            <div class="spacer"></div>
            <input id="searchBox" placeholder="summary / tags / sourceRef を検索">
            <details class="observatory-mode-drawer">
              <summary>表示モード</summary>
              <div class="observatory-mode-panel">
                <div class="observatory-tabs">
                  <button id="tabLive" class="active" type="button">ライブ</button>
                  <button id="tabReplay" type="button">リプレイ</button>
                  <button id="tabExplore" type="button">探索</button>
                </div>
                <button class="ctrl" id="pauseBtn" type="button">一時停止</button>
              </div>
            </details>
          </header>
          <div class="observatory-main">
            <div id="graph"><div id="loading">LOADING 3D ENGINE...</div></div>
            <aside>
              <h2>想起フィード</h2>
              <ul id="feed"></ul>
              <h2>忘却予測 (7日後の想起率)</h2>
              <div id="forecast"></div>
              <h2>クラスタ凡例</h2>
              <div id="legend"></div>
              <h2>統計</h2>
              <div id="stats"></div>
              <h2>表示設定</h2>
              <label class="opt"><input type="checkbox" id="showTitles" checked> タイトル表示</label>
              <label class="opt"><input type="checkbox" id="showSim" checked> 類似エッジ</label>
              <label class="opt"><input type="checkbox" id="showHebb" checked> 共起エッジ</label>
              <label class="opt"><input type="checkbox" id="autoRotate" checked> 自動回転</label>
              <label class="opt"><input type="checkbox" id="fogOn" checked> 忘却の霧</label>
              <div class="hint">
                奥行き(Z軸)はACT-R風の活性度です。よく想起される記憶ほど手前に浮上し、忘れられつつある記憶は霧の奥へ沈みます。ドラッグで回転、ホイールでズーム、右ドラッグでパンできます。ノードを掴んで動かすと追従し、クリックでフォーカスします。Ctrl+ホバーで要約を表示します。
              </div>
            </aside>
          </div>
          <footer id="timeline">
            <button class="ctrl" id="replayPlay" type="button">再生</button>
            <span id="timeLabel">Day 0 00:00</span>
            <input type="range" id="scrub" min="0" max="720" step="0.25" value="0">
            <select id="replaySpeed">
              <option value="2">2時間/秒</option>
              <option value="6" selected>6時間/秒</option>
              <option value="24">24時間/秒</option>
            </select>
          </footer>
        </div>
        <div id="tooltip"></div>
      </section>
      <section id="view-health" class="app-view">
        <h1>状態</h1>
        <section class="grid">
          <div class="panel"><p class="label">状態</p><p class="value" id="status">読み込み中</p></div>
          <div class="panel"><p class="label">メモリ</p><p class="value" id="memories">-</p></div>
          <div class="panel"><p class="label">イベント</p><p class="value" id="events">-</p></div>
          <div class="panel"><p class="label">データベース</p><p class="value" id="database">-</p></div>
          <div class="panel"><p class="label">Embedding</p><p class="value" id="embedding">-</p></div>
        </section>
        <h2>Ollama モデル</h2>
        <section class="stats-grid">
          <div class="panel"><p class="label">接続</p><p class="value" id="ollama-status">-</p></div>
          <div class="panel"><p class="label">設定済みモデル</p><ul class="stats-list" id="ollama-configured"></ul></div>
          <div class="panel"><p class="label">利用可能なモデル</p><ul class="stats-list" id="ollama-models"></ul></div>
        </section>
      </section>
      <section id="view-memories" class="app-view">
        <h1>メモリ</h1>
        <h2>メモリ統計</h2>
        <section class="stats-grid">
          <div class="panel"><p class="label">状態別</p><ul class="stats-list" id="status-stats"></ul></div>
          <div class="panel"><p class="label">レイヤー別</p><ul class="stats-list" id="layer-stats"></ul></div>
          <div class="panel"><p class="label">更新日時</p><ul class="stats-list" id="updated-stats"></ul></div>
        </section>
        <h2>メモリ鮮度</h2>
        <section class="stats-grid">
          <div class="panel"><p class="label">通常メモリの追従状態</p><ul class="stats-list" id="memory-freshness"></ul></div>
          <div class="panel"><p class="label">保存候補</p><ul class="stats-list action-list" id="memory-candidates"></ul></div>
          <div class="panel"><p class="label">Auto Memory Curation</p><ul class="stats-list" id="auto-curation"></ul></div>
        </section>
        <h2>プロジェクトスコープ</h2>
        <table><thead><tr><th>スコープ</th><th>有効</th><th>合計</th><th>最新</th></tr></thead><tbody id="project-scopes"></tbody></table>
        <h2>最近のメモリ</h2>
        <table><thead><tr><th>ID</th><th>レイヤー</th><th>要約</th><th>情報源</th><th>スコープ</th><th>タグ</th><th>更新</th></tr></thead><tbody id="recent-memories"></tbody></table>
      </section>
      <section id="view-directives" class="app-view">
        <h1>Directive Memory</h1>
        <h2>Directive Memory</h2>
        <table><thead><tr><th>ID</th><th>範囲</th><th>スコープ</th><th>指示内容</th><th>理由</th><th>情報源</th><th>更新</th></tr></thead><tbody id="directives"></tbody></table>
        <h2>無効化済み Directive Memory</h2>
        <table><thead><tr><th>ID</th><th>範囲</th><th>スコープ</th><th>指示内容</th><th>理由</th><th>情報源</th><th>更新</th></tr></thead><tbody id="disabled-directives"></tbody></table>
      </section>
      <section id="view-maintenance" class="app-view">
        <h1>メンテナンス</h1>
        <section class="stats-grid">
          <div class="panel"><p class="label">インデックス修復</p><p class="value" id="repair">-</p></div>
          <div class="panel"><p class="label">最新バックアップ</p><ul class="stats-list" id="backup-stats"></ul></div>
          <div class="panel"><p class="label">バックアップ保持</p><ul class="stats-list" id="retention-stats"></ul></div>
          <div class="panel"><p class="label">警告と対応</p><ul class="stats-list action-list" id="warnings"></ul></div>
        </section>
      </section>
      <section id="view-events" class="app-view">
        <h1>イベント</h1>
        <table><thead><tr><th>ID</th><th>メモリ</th><th>種類</th><th>作成</th></tr></thead><tbody id="recent-events"></tbody></table>
      </section>
      <section id="view-settings" class="app-view">
        <h1>設定</h1>
        <section class="stats-grid">
          <div class="panel"><p class="label">Dashboard</p><ul class="stats-list" id="settings-dashboard"></ul></div>
        </section>
      </section>
    </section>
  </main>
  <script>
    function normalizeDashboardCopy() {
      if (typeof document.querySelector !== "function") return;
      const nav = document.querySelector(".app-nav");
      if (nav) {
        nav.innerHTML = [
          '<div class="brand">Codex Memory<br>Sidecar</div>',
          '<button type="button" class="nav-button active" data-view-target="observatory">観測</button>',
          '<button type="button" class="nav-button" data-view-target="health">状態</button>',
          '<button type="button" class="nav-button" data-view-target="memories">メモリ</button>',
          '<button type="button" class="nav-button" data-view-target="directives">Directive</button>',
          '<button type="button" class="nav-button" data-view-target="maintenance">保守</button>',
          '<button type="button" class="nav-button" data-view-target="events">イベント</button>',
          '<button type="button" class="nav-button" data-view-target="settings">設定</button>',
          '<button type="button" id="refresh">更新</button>'
        ].join("");
      }
      const header = document.querySelector("#observatory-app header");
      if (header) {
        header.innerHTML = [
          '<h1>Memory Observatory <span style="color: #79a8ff">3D</span><span class="sub">活性度 / 忘却の霧 / 回転・ズーム・ドラッグ対応</span></h1>',
          '<div class="spacer"></div>',
          '<input id="searchBox" placeholder="summary / tags / sourceRef を検索">',
          '<details class="observatory-mode-drawer">',
          '<summary>表示モード</summary>',
          '<div class="observatory-mode-panel">',
          '<div class="observatory-tabs">',
          '<button id="tabLive" class="active" type="button">ライブ</button>',
          '<button id="tabReplay" type="button">リプレイ</button>',
          '<button id="tabExplore" type="button">探索</button>',
          '</div>',
          '<button class="ctrl" id="pauseBtn" type="button">一時停止</button>',
          '</div>',
          '</details>'
        ].join("");
      }
      const graph = document.getElementById("graph");
      if (graph && !document.getElementById("graph-statusbar")) {
        const statusbar = document.createElement("div");
        statusbar.id = "graph-statusbar";
        graph.appendChild(statusbar);
      }
      const aside = document.querySelector("#observatory-app aside");
      if (aside) {
        aside.innerHTML = [
          '<h2>想起フィード</h2>',
          '<ul id="feed"></ul>',
          '<h2>忘却予測 (7日後の想起率)</h2>',
          '<div id="forecast"></div>',
          '<h2>クラスタ凡例</h2>',
          '<div id="legend"></div>',
          '<h2>統計</h2>',
          '<div id="stats"></div>',
          '<h2>表示設定</h2>',
          '<label class="opt"><input type="checkbox" id="showTitles" checked> タイトル表示</label>',
          '<label class="opt"><input type="checkbox" id="showSim" checked> 類似エッジ</label>',
          '<label class="opt"><input type="checkbox" id="showHebb" checked> 共起エッジ</label>',
          '<label class="opt"><input type="checkbox" id="autoRotate" checked> 自動回転</label>',
          '<label class="opt"><input type="checkbox" id="fogOn" checked> 忘却の霧</label>',
          '<div class="hint">奥行き(Z軸)はACT-R風の活性度です。よく想起される記憶ほど手前に浮かび、忘れられつつある記憶は霧の奥へ沈みます。ドラッグで回転、ホイールでズーム、右ドラッグでパンできます。</div>'
        ].join("");
      }
      const timeline = document.getElementById("timeline");
      if (timeline) {
        timeline.innerHTML = [
          '<button class="ctrl" id="replayPlay" type="button">再生</button>',
          '<span id="timeLabel">Day 0 00:00</span>',
          '<input type="range" id="scrub" min="0" max="720" step="0.25" value="0">',
          '<select id="replaySpeed">',
          '<option value="2">2時間/秒</option>',
          '<option value="6" selected>6時間/秒</option>',
          '<option value="24">24時間/秒</option>',
          '</select>'
        ].join("");
      }
      const textBySelector = {
        "#view-health h1": "状態",
        "#view-memories h1": "メモリ",
        "#view-directives h1": "Directive Memory",
        "#view-maintenance h1": "保守",
        "#view-events h1": "イベント",
        "#view-settings h1": "設定"
      };
      for (const [selector, text] of Object.entries(textBySelector)) {
        const element = document.querySelector(selector);
        if (element) element.textContent = text;
      }
    }
    normalizeDashboardCopy();
    const dashboardState = {
      activeView: "observatory",
      graph: null,
      observatory3d: null,
      mode: "live",
      search: ""
    };
    function queryAll(selector) {
      return typeof document.querySelectorAll === "function" ? document.querySelectorAll(selector) : [];
    }
    function setupNavigation() {
      for (const button of queryAll(".nav-button")) {
        button.addEventListener("click", () => {
          setActiveView(button.dataset.viewTarget);
        });
      }
    }
    function setActiveView(view) {
      if (!view) return;
      dashboardState.activeView = view;
      for (const button of queryAll(".nav-button")) {
        const active = button.dataset.viewTarget === view;
        button.classList[active ? "add" : "remove"]("active");
      }
      for (const panel of queryAll(".app-view")) {
        const active = panel.id === "view-" + view;
        panel.classList[active ? "add" : "remove"]("active");
      }
      if (view === "observatory") {
        redrawMemoryGraph();
      }
    }
    function setupObservatoryControls() {
      // The Observatory controls are wired when the 3D runtime initializes.
    }
    function setObservatoryMode(mode) {
      if (!mode) return;
      dashboardState.mode = mode;
      for (const button of queryAll(".mode-button")) {
        const active = button.dataset.mode === mode;
        button.classList[active ? "add" : "remove"]("active");
      }
      redrawMemoryGraph();
    }
    function redrawMemoryGraph() {
      if (dashboardState.graph) {
        renderMemoryGraph(dashboardState.graph);
      }
    }
    async function refresh() {
      const response = await fetch("/api/status");
      const status = await response.json();
      const graph = await fetchGraph();
      document.getElementById("status").textContent = status.ok ? "正常" : "要確認";
      document.getElementById("status").className = status.ok ? "value status-ok" : "value status-warn";
      document.getElementById("memories").textContent = String(status.database.memoryCount);
      document.getElementById("events").textContent = String(status.database.eventCount);
      document.getElementById("database").textContent = status.database.ok
        ? "OK"
        : "FTS " + status.database.fts.missingCount + "/" + status.database.fts.orphanCount;
      document.getElementById("database").className = status.database.ok ? "value status-ok" : "value status-warn";
      document.getElementById("embedding").textContent = status.embedding.ok ? String(status.embedding.dimensions) : "利用不可";
      document.getElementById("status-stats").innerHTML = renderStats({
        active: status.memoryStats.byStatus.active,
        superseded: status.memoryStats.byStatus.superseded,
        forgotten: status.memoryStats.byStatus.forgotten
      });
      document.getElementById("layer-stats").innerHTML = renderStats({
        core: status.memoryStats.byLayer.core,
        recall: status.memoryStats.byLayer.recall,
        archival: status.memoryStats.byLayer.archival
      });
      document.getElementById("updated-stats").innerHTML = renderStats({
        最古: status.memoryStats.updatedAtRange.oldest ?? "-",
        最新: status.memoryStats.updatedAtRange.newest ?? "-"
      });
      document.getElementById("memory-freshness").innerHTML = renderStats({
        状態: renderFreshnessStatus(status.memoryFreshness.status),
        最新メモリ更新: status.memoryFreshness.latestMemoryUpdatedAt ?? "-",
        最新作業: status.memoryFreshness.latestWorkspaceActivityAt ?? "-",
        更新からの日数: status.memoryFreshness.daysSinceLatestMemoryUpdate ?? "-",
        作業との差: status.memoryFreshness.daysBehindWorkspaceActivity ?? "-",
        保存候補: status.memoryFreshness.candidateCount,
        対応: status.memoryFreshness.recommendedAction
      });
      document.getElementById("memory-candidates").innerHTML = status.memoryUpdateCandidates.length
        ? renderMemoryCandidates(status.memoryUpdateCandidates)
        : renderStats({ 保存候補: "なし" });
      document.getElementById("auto-curation").innerHTML = renderStats({
        mode: status.autoMemoryCuration.mode,
        threshold: status.autoMemoryCuration.threshold,
        evaluated: status.autoMemoryCuration.evaluatedCount,
        review: status.autoMemoryCuration.reviewCount,
        safe候補: status.autoMemoryCuration.autoWriteEligibleCount,
        skip: status.autoMemoryCuration.skippedCount,
        note: status.autoMemoryCuration.note
      });
      document.getElementById("settings-dashboard").innerHTML = renderStats({
        schema: status.dashboard.schemaVersion,
        build: status.dashboard.buildFingerprint,
        "auto open": "enabled by default",
        refresh: "manual",
        privacy: "summary / metadata only"
      });
      document.getElementById("repair").textContent = status.maintenance.repairRecommended ? "推奨" : "不要";
      document.getElementById("repair").className = status.maintenance.repairRecommended ? "value status-warn" : "value status-ok";
      document.getElementById("backup-stats").innerHTML = status.maintenance.latestBackup
        ? renderStats({
            パス: status.maintenance.latestBackup.backupPath,
            サイズ: status.maintenance.latestBackup.sizeBytes,
            更新: status.maintenance.latestBackup.mtime
          })
        : renderStats({ 最新: "-" });
      document.getElementById("retention-stats").innerHTML = renderStats({
        ディレクトリ: status.maintenance.backupRetention.backupDir,
        バックアップ数: status.maintenance.backupRetention.backupCount,
        保持: status.maintenance.backupRetention.keptCount + " / " + status.maintenance.backupRetention.keepCount,
        削除候補: status.maintenance.backupRetention.prunableCount,
        削除候補バイト: status.maintenance.backupRetention.prunableSizeBytes
      });
      document.getElementById("warnings").innerHTML = status.warnings.length
        ? renderWarningActions(status.warningActions, status.warnings)
        : renderStats({ 現在: "なし" });
      document.getElementById("ollama-status").textContent = status.ollama
        ? (status.ollama.ok ? "正常" : (status.ollama.required ? "要確認" : "任意"))
        : "無効";
      document.getElementById("ollama-status").className = status.ollama && (status.ollama.ok || !status.ollama.required) ? "value status-ok" : "value status-warn";
      document.getElementById("ollama-configured").innerHTML = status.ollama
        ? renderStats({
          運用: status.ollama.required ? "必須" : "任意",
          endpoint: status.ollama.baseUrl,
          embedding: status.ollama.embeddingModel + " / " + (status.ollama.embeddingModelAvailable ? "利用可" : "不足"),
          maintenance: status.ollama.maintenanceModel + " / " + (status.ollama.maintenanceModelAvailable ? "利用可" : "不足")
        })
        : renderStats({ 状態: "無効" });
      document.getElementById("ollama-models").innerHTML = status.ollama && status.ollama.modelNames.length
        ? status.ollama.modelNames.map((name) => "<li><span>" + escapeHtml(name) + "</span></li>").join("")
        : renderStats({ models: "-" });
      renderMemoryGraph(graph);
      document.getElementById("project-scopes").innerHTML = status.memoryStats.byProjectScope.map((scope) => (
        "<tr><td class=\\"summary\\">" + escapeHtml(scope.projectScope) + "</td><td>" + scope.active + "</td><td>" + scope.total + "</td><td>" + escapeHtml(scope.latestUpdatedAt ?? "-") + "</td></tr>"
      )).join("");
      document.getElementById("directives").innerHTML = status.directives.length
        ? renderDirectiveRows(status.directives)
        : "<tr><td colspan=\\"7\\">保存済み directive memory はありません</td></tr>";
      document.getElementById("disabled-directives").innerHTML = status.disabledDirectives.length
        ? renderDirectiveRows(status.disabledDirectives)
        : "<tr><td colspan=\\"7\\">無効化済み directive memory はありません</td></tr>";
      document.getElementById("recent-memories").innerHTML = status.recentMemories.map((memory) => (
        "<tr><td>" + memory.id + "</td><td>" + escapeHtml(memory.layer) + "</td><td class=\\"summary\\">" + escapeHtml(memory.summary) + "</td><td class=\\"tags\\">" + escapeHtml(memory.sourceType + ': ' + memory.sourceRef) + "</td><td class=\\"tags\\">" + escapeHtml(memory.projectScope) + "</td><td class=\\"tags\\">" + escapeHtml(memory.tags.join(", ")) + "</td><td>" + escapeHtml(memory.updatedAt) + "</td></tr>"
      )).join("");
      document.getElementById("recent-events").innerHTML = status.recentEvents.map((event) => (
        "<tr><td>" + event.id + "</td><td>" + event.memoryId + "</td><td>" + event.eventType + "</td><td>" + event.createdAt + "</td></tr>"
      )).join("");
    }
    async function fetchGraph() {
      try {
        const response = await fetch("/api/graph");
        if (!response.ok) return null;
        return await response.json();
      } catch {
        return null;
      }
    }
    function renderMemoryGraph(graph) {
      dashboardState.graph = graph;
      if (!graph || !Array.isArray(graph.nodes)) {
        renderMemoryGraphFallback(null);
        return;
      }
      if (window.ForceGraph3D && window.THREE) {
        renderMemoryGraph3d(graph);
      } else {
        renderMemoryGraphFallback(graph);
      }
    }
    function renderMemoryGraph3d(graph) {
      if (dashboardState.observatory3d?.source === graph) {
        return;
      }
      if (dashboardState.observatory3d?.destroy) {
        dashboardState.observatory3d.destroy();
      }
      const THREE = window.THREE;
      const UnrealBloomPass = window.UnrealBloomPass;
      const container = document.getElementById("graph");
      if (!container) return;
      const loading = document.getElementById("loading");
      if (loading) loading.remove();
      const model = buildObservatoryModel(graph);
      const maxHebbianLinks = Math.max(1, (model.nodes.length * (model.nodes.length - 1)) / 2);
      const hebbianDensity =
        model.links.filter((link) => link.type === "hebb").length / maxHebbianLinks;
      const hebbianLinkStrength = hebbianDensity > 0.65 ? 0.06 : 0.22;
      const clusterAnchorStrength = hebbianDensity > 0.65 ? 0.1 : 0.05;
      const visualDensityDamping = Math.max(0.48, 1 - Math.max(0, hebbianDensity - 0.45) * 0.9);
      const denseGraph = hebbianDensity > 0.65;
      const state = {
        simH: 720,
        mode: "live",
        paused: false,
        focus: null,
        hover: null,
        clusterFilter: null,
        lastParticleT: 0,
        replayPlaying: false,
        replayLast: null,
        autoCentering: false,
        userMovedCamera: false,
        visualDensityDamping,
        lastFeedHtml: "",
        viewCenter: { x: 0, y: 0, z: 0 }
      };
      const graph3d = new window.ForceGraph3D(container, { controlType: "orbit" })
        .backgroundColor("rgba(0,0,0,0)")
        .showNavInfo(false)
        .enablePointerInteraction(true)
        .nodeThreeObject((node) => createNodeObject(node, THREE))
        .nodeVisibility((node) => memVisible(node, state))
        .linkVisibility((link) => linkVisible(link, state))
        .linkColor((link) => (link.type === "hebb" ? "#b9c8ee" : "#6376b8"))
        .linkWidth((link) =>
          link.type === "hebb"
            ? Math.min(0.82, 0.16 + Math.log1p(link.weight) * 0.26) * (denseGraph ? 0.68 : 0.86)
            : 0.12,
        )
        .linkOpacity(denseGraph ? 0.13 : 0.18)
        .linkDirectionalParticles(0)
        .linkDirectionalParticleWidth((link) => (link.type === "hebb" ? 3.2 : 2.2))
        .linkDirectionalParticleSpeed(0.075)
        .linkDirectionalParticleColor((link) => (link.type === "hebb" ? "#ffbf52" : "#22d3ee"))
        .warmupTicks(70)
        .cooldownTime(9000)
        .graphData({ nodes: model.nodes, links: model.links });
      if (!document.getElementById("graph-statusbar")) {
        const statusbar = document.createElement("div");
        statusbar.id = "graph-statusbar";
        container.appendChild(statusbar);
      }
      const resizeGraph = () => {
        graph3d.width(Math.max(320, container.clientWidth));
        graph3d.height(Math.max(320, container.clientHeight));
      };
      resizeGraph();
      const resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resizeGraph) : null;
      resizeObserver?.observe(container);
      window.addEventListener("resize", resizeGraph);
      graph3d.d3Force("center", null);
      graph3d.d3Force("charge").strength(-38);
      graph3d
        .d3Force("link")
        .distance((link) => (link.type === "hebb" ? 42 : 70))
        .strength((link) => (link.type === "hebb" ? hebbianLinkStrength : 0.02));
      graph3d.d3Force("clusterAnchor", (alpha) => {
        for (const node of model.nodes) {
          const anchor = model.clusterByKey.get(node.clusterKey);
          if (!anchor) continue;
          node.vx = (node.vx || 0) + (anchor.cx3 - (node.x || 0)) * clusterAnchorStrength * alpha;
          node.vy = (node.vy || 0) + (anchor.cy3 - (node.y || 0)) * clusterAnchorStrength * alpha;
        }
      });
      graph3d.d3Force("activationDepth", (alpha) => {
        for (const node of model.nodes) {
          const zTarget = -240 + 320 * activationScore(node);
          node.vz = (node.vz || 0) + (zTarget - (node.z || 0)) * 0.12 * alpha;
        }
      });
      const scene = graph3d.scene();
      const fog = new THREE.FogExp2(0x070b14, 0.0019);
      scene.fog = fog;
      const composer = graph3d.postProcessingComposer?.();
      if (composer && UnrealBloomPass) {
        const bloom = new UnrealBloomPass();
        bloom.strength = 0.85;
        bloom.radius = 0.6;
        bloom.threshold = 0.18;
        composer.addPass(bloom);
      }
      graph3d.cameraPosition({ x: 0, y: 18, z: 340 });
      window.setTimeout(() => {
        centerGraphView(graph3d, controls, model, state, { animateMs: 900, fit: true, userInitiated: false });
      }, 1200);
      window.setTimeout(() => {
        centerGraphView(graph3d, controls, model, state, { animateMs: 700, fit: true, userInitiated: false });
      }, 3400);
      const controls = graph3d.controls();
      controls.enableDamping = true;
      controls.dampingFactor = 0.085;
      controls.screenSpacePanning = true;
      controls.zoomToCursor = true;
      controls.autoRotate = true;
      controls.autoRotateSpeed = 0.45;
      controls.addEventListener?.("start", () => {
        if (!state.autoCentering) state.userMovedCamera = true;
      });
      let draggingNode = false;
      graph3d.onNodeDrag(() => {
        if (!draggingNode) {
          draggingNode = true;
          graph3d.d3ReheatSimulation();
        }
      });
      graph3d.onNodeDragEnd((node) => {
        draggingNode = false;
        node.fx = undefined;
        node.fy = undefined;
        node.fz = undefined;
      });
      graph3d.onNodeHover((node, event) => {
        state.hover = node || null;
        showTooltip(node, event, state);
        setCursor(node ? "pointer" : "default");
      });
      graph3d.onNodeClick((node) => {
        state.focus = state.focus === node ? null : node;
        graph3d.nodeVisibility(graph3d.nodeVisibility()).linkVisibility(graph3d.linkVisibility());
        state.viewCenter = graphPoint(node);
        controls.target.set(state.viewCenter.x, state.viewCenter.y, state.viewCenter.z);
        graph3d.cameraPosition({ x: node.x * 1.35, y: node.y * 1.35, z: (node.z || 0) + 160 }, node, 900);
        refreshObservatoryPanels(model, state);
      });
      graph3d.onBackgroundClick(() => {
        state.focus = null;
        graph3d.linkVisibility(graph3d.linkVisibility()).nodeVisibility(graph3d.nodeVisibility());
        refreshObservatoryPanels(model, state);
      });
      bindObservatoryUi(model, graph3d, controls, state);
      const interval = window.setInterval(() => refreshObservatoryPanels(model, state), 900);
      let frame = 0;
      const animate = (time) => {
        controls.autoRotate = isChecked("autoRotate") && state.mode !== "replay";
        scene.fog = isChecked("fogOn") ? fog : null;
        controls.update();
        updateReplay(time, model, graph3d, state);
        if (!state.paused && state.mode === "live" && time - state.lastParticleT > 1150) {
          state.lastParticleT = time;
          emitRecentParticle(model, graph3d, state);
        }
        if (frame++ % 5 === 0) {
          for (const node of model.nodes) updateNodeObject(node, state, graph3d);
        }
        requestAnimationFrame(animate);
      };
      requestAnimationFrame(animate);
      refreshObservatoryPanels(model, state);
      dashboardState.observatory3d = {
        source: graph,
        modelLinks: model.links,
        graph3d,
        controls,
        destroy() {
          resizeObserver?.disconnect();
          window.removeEventListener("resize", resizeGraph);
          window.clearInterval(interval);
          container.innerHTML = "";
        }
      };
    }
    function buildObservatoryModel(graph) {
      const palette = ["#4fc3f7", "#ffd54f", "#ba68c8", "#81c784", "#ef7b7b", "#4db6ac", "#f48fb1"];
      const layerLabels = { core: "Core", recall: "Recall", archival: "Archival" };
      const genericTags = new Set(["codex-memory-sidecar", "memory", "mcp", "test"]);
      const tagCounts = new Map();
      for (const node of graph.nodes ?? []) {
        for (const tag of node.tags ?? []) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
      }
      const chooseClusterKey = (node) => {
        const tags = [...(node.tags ?? [])].filter((tag) => !genericTags.has(tag));
        tags.sort((left, right) => (tagCounts.get(right) ?? 0) - (tagCounts.get(left) ?? 0) || left.localeCompare(right));
        if (tags[0]) return "tag:" + tags[0];
        if (node.sourceType) return "source:" + node.sourceType;
        return "layer:" + (node.layer ?? "recall");
      };
      const clusterKeys = [...new Set((graph.nodes ?? []).map((node) => chooseClusterKey(node)))];
      const clusters = clusterKeys.map((key, index) => {
        const angle = (index / Math.max(1, clusterKeys.length)) * Math.PI * 2 - Math.PI / 2;
        const [kind, rawLabel] = key.split(/:(.*)/s);
        return {
          key,
          label: kind === "layer" ? (layerLabels[rawLabel] ?? rawLabel) : rawLabel,
          color: palette[index % palette.length],
          cx3: Math.cos(angle) * 145,
          cy3: Math.sin(angle) * 100
        };
      });
      const clusterByKey = new Map(clusters.map((cluster) => [cluster.key, cluster]));
      const eventIndexByMemory = new Map();
      for (const [index, event] of (graph.events ?? []).entries()) {
        const eventH = eventToHour(event, index, graph.events?.length ?? 1);
        for (const memoryId of event.memoryIds ?? []) {
          const items = eventIndexByMemory.get(memoryId) ?? [];
          items.push(eventH);
          eventIndexByMemory.set(memoryId, items);
        }
      }
      const nodes = (graph.nodes ?? []).map((node, index) => {
        const cluster = clusterByKey.get(chooseClusterKey(node)) ?? clusters[0];
        const eventHours = eventIndexByMemory.get(node.id) ?? [];
        const createdH = eventHours[0] ?? index * (720 / Math.max(1, graph.nodes.length - 1));
        return {
          ...node,
          name: shortMemoryTitle(node),
          cluster,
          clusterKey: cluster.key,
          color: cluster.color,
          createdH,
          forgottenH: Infinity,
          accesses: [createdH, ...eventHours].sort((a, b) => a - b),
          x: cluster.cx3 + Math.cos(index * 2.399) * 45,
          y: cluster.cy3 + Math.sin(index * 1.711) * 38,
          z: -60 + 180 * Number(node.activation ?? 0)
        };
      });
      const nodeById = new Map(nodes.map((node) => [node.id, node]));
      const links = [];
      for (const edge of graph.edges?.similarity ?? []) {
        if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) continue;
        links.push({ source: edge.source, target: edge.target, type: "sim", weight: Number(edge.weight ?? 0.2) });
      }
      for (const edge of graph.edges?.hebbian ?? []) {
        if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) continue;
        links.push({
          source: edge.source,
          target: edge.target,
          type: "hebb",
          weight: Number(edge.weight ?? 1),
          times: [eventToHour({ createdAt: edge.latestAt, memoryIds: [] }, 0, 1)]
        });
      }
      return { graph, nodes, links, clusters, clusterByKey, nodeById };
    }
    function bindObservatoryUi(model, graph3d, controls, state) {
      const tabLive = document.getElementById("tabLive");
      const tabReplay = document.getElementById("tabReplay");
      const tabExplore = document.getElementById("tabExplore");
      const tabs = [tabLive, tabReplay, tabExplore].filter(Boolean);
      function setMode(mode) {
        state.mode = mode;
        dashboardState.mode = mode;
        for (const button of tabs) button.classList.remove("active");
        document.getElementById(mode === "live" ? "tabLive" : mode === "replay" ? "tabReplay" : "tabExplore")?.classList.add("active");
        document.getElementById("timeline")?.classList[mode === "replay" ? "add" : "remove"]("show");
        controls.autoRotate = mode !== "replay";
        graph3d.nodeVisibility(graph3d.nodeVisibility()).linkVisibility(graph3d.linkVisibility());
        refreshObservatoryPanels(model, state);
      }
      tabLive?.addEventListener("click", () => setMode("live"));
      tabReplay?.addEventListener("click", () => setMode("replay"));
      tabExplore?.addEventListener("click", () => setMode("explore"));
      document.getElementById("pauseBtn")?.addEventListener("click", (event) => {
        state.paused = !state.paused;
        event.target.textContent = state.paused ? "再開" : "一時停止";
      });
      document.getElementById("searchBox")?.addEventListener("input", (event) => {
        dashboardState.search = event.target?.value ?? "";
        graph3d.nodeVisibility(graph3d.nodeVisibility()).linkVisibility(graph3d.linkVisibility());
        refreshObservatoryPanels(model, state);
        centerGraphView(graph3d, controls, model, state, { animateMs: 450, fit: true, userInitiated: false });
      });
      for (const id of ["showTitles", "showSim", "showHebb", "autoRotate", "fogOn"]) {
        document.getElementById(id)?.addEventListener("change", () => {
          graph3d.nodeVisibility(graph3d.nodeVisibility()).linkVisibility(graph3d.linkVisibility());
          refreshObservatoryPanels(model, state);
        });
      }
      document.getElementById("scrub")?.addEventListener("input", (event) => {
        state.simH = Number(event.target.value);
        graph3d.nodeVisibility(graph3d.nodeVisibility()).linkVisibility(graph3d.linkVisibility());
        refreshObservatoryPanels(model, state);
        centerGraphView(graph3d, controls, model, state, { animateMs: 450, fit: true, userInitiated: false });
      });
      document.getElementById("replayPlay")?.addEventListener("click", (event) => {
        state.replayPlaying = !state.replayPlaying;
        state.replayLast = null;
        event.target.textContent = state.replayPlaying ? "停止" : "再生";
      });
    }
    function graphPoint(node) {
      return {
        x: finiteNumber(node?.x, 0),
        y: finiteNumber(node?.y, 0),
        z: finiteNumber(node?.z, 0)
      };
    }
    function finiteNumber(value, fallback) {
      return Number.isFinite(value) ? value : fallback;
    }
    function visibleObservatoryNodes(model, state) {
      return model.nodes.filter((node) => memVisible(node, state));
    }
    function computeGraphView(model, state) {
      const nodes = visibleObservatoryNodes(model, state);
      if (nodes.length === 0) {
        return { center: { x: 0, y: 0, z: 0 }, radius: 120 };
      }
      const center = nodes.reduce(
        (acc, node) => {
          const point = graphPoint(node);
          acc.x += point.x;
          acc.y += point.y;
          acc.z += point.z;
          return acc;
        },
        { x: 0, y: 0, z: 0 }
      );
      center.x /= nodes.length;
      center.y /= nodes.length;
      center.z /= nodes.length;
      let radius = 0;
      for (const node of nodes) {
        const point = graphPoint(node);
        radius = Math.max(
          radius,
          Math.hypot(point.x - center.x, point.y - center.y, point.z - center.z)
        );
      }
      return { center, radius: Math.max(80, radius) };
    }
    function centerGraphView(graph3d, controls, model, state, options = {}) {
      if (state.userMovedCamera && options.userInitiated === false) return;
      const view = computeGraphView(model, state);
      state.viewCenter = view.center;
      controls.target.set(view.center.x, view.center.y, view.center.z);
      controls.update();
      if (options.fit && typeof graph3d.cameraPosition === "function") {
        const cameraDistance = clamp(view.radius * 1.65 + 135, 205, 360);
        state.autoCentering = true;
        graph3d.cameraPosition(
          {
            x: view.center.x,
            y: view.center.y + 14,
            z: view.center.z + cameraDistance
          },
          view.center,
          options.animateMs ?? 700
        );
        window.setTimeout(() => {
          state.autoCentering = false;
        }, (options.animateMs ?? 700) + 80);
      }
    }
    function createNodeObject(node, THREE) {
      const group = new THREE.Group();
      const sphere = new THREE.Mesh(
        new THREE.SphereGeometry(2.4, 16, 12),
        new THREE.MeshBasicMaterial({ color: node.color, transparent: true })
      );
      const glow = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: getGlowTexture(THREE),
          color: node.color,
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false
        })
      );
      glow.scale.set(14, 14, 1);
      const labelTitle = makeTextSprite(node.name, "#d6e2fa", THREE);
      const labelAnon = makeTextSprite(node.clusterKey + "#" + String(node.id).padStart(3, "0"), "#9fb1d8", THREE);
      labelTitle.visible = false;
      labelAnon.visible = false;
      group.add(sphere, glow, labelTitle, labelAnon);
      node.__obj = group;
      node.__sphere = sphere;
      node.__glow = glow;
      node.__labelTitle = labelTitle;
      node.__labelAnon = labelAnon;
      return group;
    }
    function getGlowTexture(THREE) {
      if (dashboardState.glowTexture) return dashboardState.glowTexture;
      const canvas = document.createElement("canvas");
      canvas.width = 128;
      canvas.height = 128;
      const ctx = canvas.getContext("2d");
      const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
      gradient.addColorStop(0, "rgba(255,255,255,1)");
      gradient.addColorStop(0.3, "rgba(255,255,255,0.45)");
      gradient.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 128, 128);
      dashboardState.glowTexture = new THREE.CanvasTexture(canvas);
      return dashboardState.glowTexture;
    }
    function makeTextSprite(text, color, THREE) {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      const font = "22px 'Segoe UI', sans-serif";
      ctx.font = font;
      const width = Math.ceil(ctx.measureText(text).width) + 16;
      canvas.width = width;
      canvas.height = 32;
      ctx.font = font;
      ctx.fillStyle = color;
      ctx.textBaseline = "middle";
      ctx.fillText(String(text).slice(0, 30), 8, 16);
      const texture = new THREE.CanvasTexture(canvas);
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: texture,
          transparent: true,
          depthWrite: false
        })
      );
      sprite.scale.set(width / 4.4, 32 / 4.4, 1);
      sprite.position.set(0, -7.5, 0);
      return sprite;
    }
    function clamp(value, min, max) {
      return Math.max(min, Math.min(max, value));
    }
    function updateNodeObject(node, state, graph3d) {
      if (!node.__obj) return;
      const score = activationScore(node);
      const pulse = state.focus === node || state.hover === node ? 0.45 : 0;
      const total = Math.min(1.3, score * 0.85 + pulse * 1.15);
      const searchMatch = matchesSearch(node);
      let alpha = searchMatch ? 1 : 0.15;
      if (state.focus && !linkedToFocus(node, state.focus, dashboardState.observatory3d?.modelLinks) && node !== state.focus) {
        alpha *= 0.12;
      }
      if (node.__sphere?.material) {
        node.__sphere.material.opacity = (0.35 + 0.65 * total) * alpha;
        const scale = 0.7 + score * 0.9 + pulse * 1.3;
        node.__sphere.scale.set(scale, scale, scale);
      }
      if (node.__glow?.material) {
        const camera = graph3d?.camera?.();
        const point = graphPoint(node);
        const distance = camera
          ? Math.hypot(camera.position.x - point.x, camera.position.y - point.y, camera.position.z - point.z)
          : 260;
        const nearDamping = 1 - clamp((340 - distance) / 220, 0, 0.55);
        const glowDamping = (state.visualDensityDamping ?? 1) * nearDamping;
        node.__glow.material.opacity = (0.06 + total * 0.36) * alpha * glowDamping;
        const glowScale = (7 + 15 * total) * clamp(glowDamping + 0.16, 0.54, 1);
        node.__glow.scale.set(glowScale, glowScale, 1);
      }
      const labelOpacity = (state.focus === node || state.hover === node || score > 0.45 ? 1 : 0) * alpha;
      const showLabel = labelOpacity > 0.06;
      if (node.__labelTitle && node.__labelAnon) {
        node.__labelTitle.visible = showLabel && isChecked("showTitles");
        node.__labelAnon.visible = showLabel && !isChecked("showTitles");
        node.__labelTitle.material.opacity = labelOpacity;
        node.__labelAnon.material.opacity = labelOpacity;
      }
    }
    function memVisible(node, state) {
      if (state.mode === "replay" && (node.createdH > state.simH || node.forgottenH <= state.simH)) return false;
      if (state.clusterFilter && node.clusterKey !== state.clusterFilter) return false;
      if (state.focus) {
        return node === state.focus || node.clusterKey === state.focus.clusterKey || linkedToFocus(node, state.focus, dashboardState.observatory3d?.modelLinks);
      }
      return matchesSearch(node);
    }
    function linkVisible(link, state) {
      if (link.type === "sim" && !isChecked("showSim")) return false;
      if (link.type === "hebb" && !isChecked("showHebb")) return false;
      if (link.type === "hebb" && Number(link.weight ?? 0) < 0.05) return false;
      const source = typeof link.source === "object" ? link.source : null;
      const target = typeof link.target === "object" ? link.target : null;
      if (state.clusterFilter && source && target && source.clusterKey !== state.clusterFilter && target.clusterKey !== state.clusterFilter) return false;
      if (state.focus && source && target && source !== state.focus && target !== state.focus) return false;
      return true;
    }
    function linkedToFocus(node, focus, links) {
      if (!links) return false;
      return links.some((link) => {
        const source = typeof link.source === "object" ? link.source.id : link.source;
        const target = typeof link.target === "object" ? link.target.id : link.target;
        return (source === node.id && target === focus.id) || (target === node.id && source === focus.id);
      });
    }
    function refreshObservatoryPanels(model, state) {
      dashboardState.observatory3d = { ...(dashboardState.observatory3d ?? {}), modelLinks: model.links };
      const visible = model.nodes.filter((node) => memVisible(node, state));
      document.getElementById("stats").innerHTML = [
        "mode: " + state.mode,
        "nodes: " + visible.length + " / " + model.nodes.length,
        "similarity links: " + model.links.filter((link) => link.type === "sim").length,
        "hebbian links: " + model.links.filter((link) => link.type === "hebb").length,
        "events: " + (model.graph.events?.length ?? 0),
        "privacy: summary / metadata only"
      ].map((line) => "<div>" + escapeHtml(line) + "</div>").join("");
      const graphStatusbar = document.getElementById("graph-statusbar");
      if (graphStatusbar) {
        graphStatusbar.innerHTML = [
          "mode " + state.mode,
          visible.length + " / " + model.nodes.length + " nodes",
          model.links.filter((link) => link.type === "sim").length + " sim",
          model.links.filter((link) => link.type === "hebb").length + " hebb",
          (model.graph.events?.length ?? 0) + " events"
        ].map((line) => "<span>" + escapeHtml(line) + "</span>").join("");
      }
      document.getElementById("forecast").innerHTML = renderForecastBars(visible);
      const feedHtml = renderObservatoryFeed(model.graph.events ?? [], model.nodeById);
      if (feedHtml !== state.lastFeedHtml) {
        document.getElementById("feed").innerHTML = feedHtml;
        state.lastFeedHtml = feedHtml;
      }
      document.getElementById("legend").innerHTML = model.clusters.map((cluster) => (
        "<div data-cluster=\\"" + escapeHtml(cluster.key) + "\\" class=\\"" + (state.clusterFilter && state.clusterFilter !== cluster.key ? "off" : "") + "\\"><i style=\\"background:" + escapeHtml(cluster.color) + "\\"></i><span>" + escapeHtml(cluster.label) + "</span></div>"
      )).join("");
      for (const item of queryAll("#legend div")) {
        item.addEventListener("click", () => {
          state.clusterFilter = state.clusterFilter === item.dataset.cluster ? null : item.dataset.cluster;
          refreshObservatoryPanels(model, state);
          const graph3d = dashboardState.observatory3d?.graph3d;
          const controls = dashboardState.observatory3d?.controls;
          if (graph3d && controls) {
            centerGraphView(graph3d, controls, model, state, { animateMs: 450, fit: true, userInitiated: false });
          }
        });
      }
      document.getElementById("timeLabel").textContent = "Day " + Math.floor(state.simH / 24) + " " + String(Math.floor(state.simH % 24)).padStart(2, "0") + ":00";
    }
    function renderForecastBars(nodes) {
      const sorted = [...nodes].sort((a, b) => Number(a.retrievability7d ?? 1) - Number(b.retrievability7d ?? 1)).slice(0, 7);
      if (!sorted.length) return "<div class=\\"fc\\"><span class=\\"nm\\">retrievability</span><span class=\\"pc\\">-</span></div>";
      return sorted.map((node) => {
        const value = Math.max(0, Math.min(1, Number(node.retrievability7d ?? 0)));
        return "<div class=\\"fc\\"><span class=\\"nm\\">" + escapeHtml(node.name) + "</span><span class=\\"bar\\"><i style=\\"width:" + Math.round(value * 100) + "%\\"></i></span><span class=\\"pc\\">" + Math.round(value * 100) + "%</span></div>";
      }).join("");
    }
    function renderObservatoryFeed(events, nodeById) {
      return renderObservatoryFeedFixed(events, nodeById);
      /*
      const items = events.slice(0, 7);
      if (!items.length) return "<li><span class=\\"q\\">イベント</span><div class=\\"meta\\">表示できる最近のイベントはありません</div></li>";
      return items.map((event) => {
        const names = (event.memoryIds ?? []).map((id) => nodeById.get(id)?.name ?? id).join(", ") || "-";
        return "<li><span class=\\"q\\">" + escapeHtml(eventTypeLabel(event.eventType)) + "</span><div>" + escapeHtml(names) + "</div><div class=\\"meta\\">" + escapeHtml(formatEventTime(event.createdAt)) + "</div></li>";
      }).join("");
    }
    function eventTypeLabel(eventType) {
      return {
        created: "作成",
        updated: "更新",
        forgotten: "忘却",
        consolidated: "統合",
        retrieved: "参照"
      }[eventType] ?? "イベント";
    }
      */
    }
    function eventTypeLabel(eventType) {
      return eventTypeLabelFixed(eventType);
    }
    function renderObservatoryFeedFixed(events, nodeById) {
      const items = events.slice(0, 7);
      if (!items.length) {
        return "<li><span class=\\"q\\">イベント</span><div class=\\"meta\\">表示できる最近のイベントはありません</div></li>";
      }
      return items.map((event) => {
        const names = (event.memoryIds ?? []).map((id) => nodeById.get(id)?.name ?? id).join(", ") || "-";
        return "<li><span class=\\"q\\">" + escapeHtml(eventTypeLabelFixed(event.eventType)) + "</span><div>" + escapeHtml(names) + "</div><div class=\\"meta\\">" + escapeHtml(formatEventTime(event.createdAt)) + "</div></li>";
      }).join("");
    }
    function eventTypeLabelFixed(eventType) {
      return {
        created: "作成",
        updated: "更新",
        forgotten: "忘却",
        consolidated: "統合",
        retrieved: "参照"
      }[eventType] ?? "イベント";
    }
    function formatEventTime(value) {
      if (!value) return "";
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return String(value);
      return date.toLocaleString("ja-JP", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
      });
    }
    function updateReplay(time, model, graph3d, state) {
      if (state.mode !== "replay" || !state.replayPlaying) return;
      if (state.replayLast === null) state.replayLast = time;
      const speed = Number(document.getElementById("replaySpeed")?.value ?? 6);
      const next = Math.min(720, state.simH + ((time - state.replayLast) / 1000) * speed);
      state.replayLast = time;
      state.simH = next;
      const scrub = document.getElementById("scrub");
      if (scrub) scrub.value = String(next);
      graph3d.nodeVisibility(graph3d.nodeVisibility()).linkVisibility(graph3d.linkVisibility());
      if (next >= 720) {
        state.replayPlaying = false;
        document.getElementById("replayPlay").textContent = "再生";
      }
    }
    function emitRecentParticle(model, graph3d, state) {
      const event = (model.graph.events ?? [])[Math.floor(Math.random() * Math.max(1, (model.graph.events ?? []).length))];
      if (!event) return;
      const ids = new Set(event.memoryIds ?? []);
      const relatedLinks = model.links
        .map((item) => {
          const source = typeof item.source === "object" ? item.source.id : item.source;
          const target = typeof item.target === "object" ? item.target.id : item.target;
          const matchedEnds = Number(ids.has(source)) + Number(ids.has(target));
          return { item, matchedEnds, weight: Number(item.weight ?? 0) };
        })
        .filter((entry) => entry.matchedEnds > 0)
        .sort((left, right) => right.matchedEnds - left.matchedEnds || right.weight - left.weight)
        .slice(0, 4)
        .map((entry) => entry.item);
      for (const [index, link] of relatedLinks.entries()) {
        window.setTimeout(() => graph3d.emitParticle(link), index * 90);
      }
    }
    function showTooltip(node, event, state) {
      const tooltip = document.getElementById("tooltip");
      if (!tooltip) return;
      if (!node) {
        tooltip.style.display = "none";
        return;
      }
      const reveal = event?.ctrlKey ? "<div class=\\"reveal\\">" + escapeHtml(node.summary ?? "") + "</div>" : "";
      tooltip.innerHTML = "<strong>" + escapeHtml(node.name) + "</strong><div class=\\"t\\">layer: " + escapeHtml(node.layer) + " / activation: " + Number(node.activation ?? 0).toFixed(2) + "</div>" + reveal;
      tooltip.style.display = "block";
      tooltip.style.left = ((event?.clientX ?? 0) + 14) + "px";
      tooltip.style.top = ((event?.clientY ?? 0) + 14) + "px";
    }
    function setCursor(cursor) {
      const graph = document.getElementById("graph");
      if (graph) graph.style.cursor = cursor;
    }
    function activationScore(node) {
      return Math.max(0.04, Math.min(1, Number(node.activation ?? 0.18)));
    }
    function matchesSearch(node) {
      const query = dashboardState.search.trim().toLowerCase();
      if (!query) return true;
      return [node.name, node.summary, node.layer, node.sourceRef, node.projectScope, ...(node.tags ?? [])].join(" ").toLowerCase().includes(query);
    }
    function eventToHour(event, index, total) {
      if (event?.createdAt) {
        const time = Date.parse(event.createdAt);
        if (Number.isFinite(time)) return Math.max(0, Math.min(720, (index / Math.max(1, total - 1)) * 720));
      }
      return Math.max(0, Math.min(720, (index / Math.max(1, total - 1)) * 720));
    }
    function shortMemoryTitle(node) {
      const source = node.sourceRef ? String(node.sourceRef).split(/[\\\\/]/).pop() : "";
      const summary = String(node.summary ?? source ?? "memory");
      return summary.length > 34 ? summary.slice(0, 31) + "..." : summary;
    }
    function renderMemoryGraphFallback(graph) {
      const nodes = graph?.nodes ?? [];
      document.getElementById("stats").innerHTML = renderStats({
        状態: graph ? "3D runtime unavailable" : "読み込み不可",
        nodes: nodes.length,
        表示: "summary / metadata only"
      });
      document.getElementById("forecast").innerHTML = renderForecastBars(nodes.map((node) => ({ ...node, name: shortMemoryTitle(node) })));
      document.getElementById("feed").innerHTML = renderObservatoryFeed(graph?.events ?? [], new Map(nodes.map((node) => [node.id, { ...node, name: shortMemoryTitle(node) }])));
    }
    function filterGraphNodes(nodes) {
      const query = dashboardState.search.trim().toLowerCase();
      if (!query) return nodes;
      return nodes.filter((node) => {
        const text = [
          node.summary,
          node.layer,
          node.sourceRef,
          node.projectScope,
          ...(node.tags ?? [])
        ].join(" ").toLowerCase();
        return text.includes(query);
      });
    }
    function isChecked(id) {
      const element = document.getElementById(id);
      return element ? element.checked !== false : true;
    }
    function drawMemoryGraph(graph) {
      const canvas = document.getElementById("memory-graph");
      if (!canvas || typeof canvas.getContext !== "function") return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const width = canvas.width;
      const height = canvas.height;
      ctx.clearRect(0, 0, width, height);
      const gradient = ctx.createLinearGradient(0, 0, width, height);
      gradient.addColorStop(0, "#0f172a");
      gradient.addColorStop(1, "#1f2937");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);
      drawStars(ctx, width, height, graph.nodes.length + graph.edges.similarity.length + graph.edges.hebbian.length);
      const nodes = graph.nodes.map((node, index) => {
        const layout = layoutNode(node, index, graph.nodes.length, width, height);
        return {
          ...node,
          px: layout.x,
          py: layout.y
        };
      });
      const byId = new Map(nodes.map((node) => [node.id, node]));
      drawClusterRings(ctx, nodes);
      if (isChecked("show-similarity")) {
        drawEdges(ctx, byId, graph.edges?.similarity ?? [], "rgba(125, 211, 252, 0.24)", 1);
      }
      if (isChecked("show-hebbian")) {
        drawEdges(ctx, byId, graph.edges?.hebbian ?? [], "rgba(251, 191, 36, 0.42)", 2);
      }
      drawEventParticles(ctx, nodes, graph.events ?? [], width, height);
      for (const node of nodes) {
        const activation = Number(node.activation ?? 0);
        const r = 4 + activation * 10;
        ctx.beginPath();
        ctx.fillStyle = colorForLayer(node.layer, activation);
        ctx.shadowColor = ctx.fillStyle;
        ctx.shadowBlur = 8 + activation * 14;
        ctx.arc(node.px, node.py, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        if (isChecked("show-labels") || dashboardState.mode === "explore") {
          ctx.fillStyle = "rgba(226, 232, 240, 0.88)";
          ctx.font = "12px Arial";
          ctx.fillText(String(node.summary ?? "").slice(0, 42), node.px + r + 6, node.py + 4);
        }
      }
    }
    function layoutNode(node, index, total, width, height) {
      const layerOrder = { core: 0, recall: 1, archival: 2 };
      const layer = layerOrder[node.layer] ?? 1;
      const bandX = width * (0.22 + layer * 0.28);
      const angle = total <= 1 ? 0 : (index / total) * Math.PI * 2;
      const activation = Number(node.activation ?? 0);
      const retrievability = Number(node.retrievability7d ?? 0.5);
      const jitterX = Math.cos(angle * 2.17) * width * 0.08;
      const jitterY = Math.sin(angle) * height * (0.22 + activation * 0.08);
      return {
        x: Math.max(40, Math.min(width - 40, bandX + jitterX)),
        y: Math.max(48, Math.min(height - 48, height * (0.75 - retrievability * 0.5) + jitterY))
      };
    }
    function drawStars(ctx, width, height, seed) {
      ctx.save();
      for (let index = 0; index < 70; index += 1) {
        const x = (Math.sin(index * 12.9898 + seed) * 43758.5453) % 1;
        const y = (Math.sin(index * 78.233 + seed) * 24634.6345) % 1;
        ctx.fillStyle = "rgba(148, 163, 184, " + (0.18 + (index % 5) * 0.04) + ")";
        ctx.fillRect(Math.abs(x) * width, Math.abs(y) * height, 1.3, 1.3);
      }
      ctx.restore();
    }
    function drawClusterRings(ctx, nodes) {
      const byLayer = new Map();
      for (const node of nodes) {
        const items = byLayer.get(node.layer) ?? [];
        items.push(node);
        byLayer.set(node.layer, items);
      }
      ctx.save();
      ctx.strokeStyle = "rgba(148, 163, 184, 0.18)";
      ctx.lineWidth = 1;
      for (const items of byLayer.values()) {
        if (!items.length) continue;
        const cx = items.reduce((sum, node) => sum + node.px, 0) / items.length;
        const cy = items.reduce((sum, node) => sum + node.py, 0) / items.length;
        const r = Math.max(42, Math.min(150, items.length * 18));
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }
    function drawEventParticles(ctx, nodes, events, width, height) {
      if (dashboardState.mode === "explore") return;
      ctx.save();
      const byId = new Map(nodes.map((node) => [node.id, node]));
      const eventSlice = dashboardState.mode === "replay" ? events.slice(-12) : events.slice(0, 6);
      for (const [index, event] of eventSlice.entries()) {
        const memoryId = event.memoryIds?.[0];
        const node = byId.get(memoryId);
        const x = node ? node.px : width * (0.12 + index * 0.06);
        const y = node ? node.py : height * 0.12;
        ctx.fillStyle = dashboardState.mode === "replay" ? "rgba(251, 191, 36, 0.76)" : "rgba(45, 212, 191, 0.66)";
        ctx.beginPath();
        ctx.arc(x, y, 2.5 + (index % 3), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
    function drawEdges(ctx, byId, edges, color, width) {
      ctx.strokeStyle = color;
      for (const edge of edges) {
        const source = byId.get(edge.source);
        const target = byId.get(edge.target);
        if (!source || !target) continue;
        ctx.lineWidth = width + Math.min(3, Number(edge.weight ?? 0));
        ctx.beginPath();
        ctx.moveTo(source.px, source.py);
        ctx.lineTo(target.px, target.py);
        ctx.stroke();
      }
    }
    function colorForLayer(layer, activation) {
      if (layer === "core") return "rgba(52, 211, 153, " + (0.62 + activation * 0.38) + ")";
      if (layer === "archival") return "rgba(167, 139, 250, " + (0.52 + activation * 0.38) + ")";
      return "rgba(96, 165, 250, " + (0.58 + activation * 0.38) + ")";
    }
    function renderForgettingForecast(nodes) {
      const sorted = [...nodes]
        .sort((a, b) => Number(a.retrievability7d ?? 1) - Number(b.retrievability7d ?? 1))
        .slice(0, 5);
      if (!sorted.length) return renderStats({ retrievability: "-" });
      return sorted.map((node) => (
        "<li><span>" + escapeHtml(String(node.summary ?? "").slice(0, 44)) + "</span>"
        + "<strong>retrievability " + escapeHtml(Number(node.retrievability7d ?? 0).toFixed(2)) + "</strong></li>"
      )).join("");
    }
    function renderGraphFeed(events) {
      const items = events.slice(0, 8);
      if (!items.length) return "<li><span class=\\"action-title\\">event</span><span class=\\"action-body\\">no recent safe graph events</span></li>";
      return items.map((event) => (
        "<li><span class=\\"action-title\\">event " + escapeHtml(event.eventType) + "</span>"
        + "<span class=\\"action-body\\">memory: " + escapeHtml((event.memoryIds ?? []).join(", ") || "-") + "</span>"
        + "<span class=\\"action-body\\">created: " + escapeHtml(event.createdAt) + "</span></li>"
      )).join("");
    }
    function renderStats(values) {
      return Object.entries(values).map(([key, value]) => (
        "<li><span>" + escapeHtml(key) + "</span><strong>" + escapeHtml(value) + "</strong></li>"
      )).join("");
    }
    function renderWarningActions(actions, warnings) {
      if (actions && actions.length) {
        return actions.map((item) => (
          "<li><span class=\\"action-title\\">" + escapeHtml(item.title) + "</span>"
          + "<span class=\\"action-body\\">" + escapeHtml(item.message) + "</span>"
          + "<span class=\\"action-body\\">対応: " + escapeHtml(item.action) + "</span>"
          + (item.tools && item.tools.length ? "<span class=\\"action-body\\">関連ツール: " + escapeHtml(item.tools.join(", ")) + "</span>" : "")
          + "</li>"
        )).join("");
      }
      return warnings.map((warning) => "<li><span>" + escapeHtml(warning) + "</span></li>").join("");
    }
    function renderDirectiveRows(directives) {
      return directives.map((directive) => (
        "<tr><td>" + directive.id + "</td><td>" + escapeHtml(directive.scope) + "</td><td class=\\"tags\\">" + escapeHtml(directive.projectScope) + "</td><td class=\\"summary\\">" + escapeHtml(directive.content) + "</td><td class=\\"summary\\">" + escapeHtml(directive.rationale) + "</td><td class=\\"tags\\">" + escapeHtml(directive.sourceType + ': ' + directive.sourceRef) + "</td><td>" + escapeHtml(directive.updatedAt) + "</td></tr>"
      )).join("");
    }
    function renderMemoryCandidates(candidates) {
      return candidates.map((candidate) => (
        "<li><span class=\\"action-title\\">" + escapeHtml(candidate.summary) + "</span>"
        + "<span class=\\"action-body\\">理由: " + escapeHtml(candidate.reason) + "</span>"
        + "<span class=\\"action-body\\">情報源: " + escapeHtml(candidate.sourceType + ': ' + candidate.sourceRef) + "</span>"
        + "<span class=\\"action-body\\">推奨: " + escapeHtml(candidate.suggestedTool) + "</span>"
        + "</li>"
      )).join("");
    }
    function renderFreshnessStatus(status) {
      return {
        fresh: "新しい",
        stale: "古い可能性",
        empty: "未保存",
        unknown: "不明"
      }[status] ?? status;
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
    setupNavigation();
    setupObservatoryControls();
    document.getElementById("refresh").addEventListener("click", refresh);
    void refresh();
  </script>
</body>
</html>`;
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body, null, 2));
}

function sendHtml(response: ServerResponse, statusCode: number, body: string): void {
  response.writeHead(statusCode, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(body);
}

function sendJavaScript(response: ServerResponse, statusCode: number, body: string): void {
  response.writeHead(statusCode, {
    "content-type": "text/javascript; charset=utf-8",
    "cache-control": "public, max-age=31536000, immutable",
  });
  response.end(body);
}

function sendText(response: ServerResponse, statusCode: number, body: string): void {
  response.writeHead(statusCode, {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store",
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
  const embeddingProvider =
    config.embeddingMode === "off"
      ? undefined
      : new OllamaEmbeddingProvider({
          baseUrl: config.ollamaBaseUrl,
          model: config.embeddingModel,
        });
  const server = createDashboardServer(store, {
    embeddingProvider,
    embeddingRequired: config.embeddingMode === "ollama",
    autoMemoryWrite: config.memoryAutoWrite,
    ollama:
      config.embeddingMode === "off"
        ? undefined
        : {
            baseUrl: config.ollamaBaseUrl,
            embeddingModel: config.embeddingModel,
            maintenanceModel: config.maintenanceModel,
          },
    ollamaRequired: config.embeddingMode === "ollama",
  });

  server.listen(port, "127.0.0.1", () => {
    const dashboardUrl = `http://127.0.0.1:${port}`;
    console.log(`Codex Memory Sidecar dashboard: ${dashboardUrl}`);
    if (shouldOpenDashboardBrowser(process.env.CODEX_MEMORY_DASHBOARD_OPEN)) {
      openDashboardUrl(dashboardUrl);
    }
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
