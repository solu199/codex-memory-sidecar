#!/usr/bin/env node
import { spawn } from "node:child_process";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfig } from "./config.js";
import type { EmbeddingProvider } from "./embedding.js";
import { OllamaEmbeddingProvider } from "./embedding.js";
import { MemoryStore } from "./memory-store.js";
import { runStartupMaintenance } from "./startup-maintenance.js";

export const DASHBOARD_SCHEMA_VERSION = "2026-05-19-dashboard-status-v1";

export interface DashboardOptions {
  embeddingProvider?: EmbeddingProvider;
  embeddingRequired?: boolean;
  ollama?: OllamaStatusOptions;
  ollamaRequired?: boolean;
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
  }
) => DashboardBrowserProcess;

export interface DashboardStatus {
  ok: boolean;
  checkedAt: string;
  dashboard: {
    schemaVersion: string;
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
  warnings: string[];
  warningActions: Array<{
    severity: "warning" | "error";
    title: string;
    message: string;
    action: string;
    tools: string[];
  }>;
}

export async function buildDashboardStatus(store: MemoryStore, options: DashboardOptions = {}): Promise<DashboardStatus> {
  const embeddingRequired = options.embeddingRequired ?? true;
  const ollamaRequired = options.ollamaRequired ?? true;
  const counts = store.countRecords();
  const databaseHealth = store.checkDatabaseHealth();
  const memoryStats = store.getStats();
  const backupRetention = store.planBackupRetention();
  const latestBackup = backupRetention.backups[0] ?? null;
  const embedding = options.embeddingProvider
    ? await probeEmbedding(options.embeddingProvider, embeddingRequired)
    : {
        ok: !embeddingRequired,
        dimensions: 0,
        error: embeddingRequired ? "Embedding provider is not configured." : null,
        required: embeddingRequired
      };
  const ollama = options.ollama ? { ...(await probeOllamaStatus(options.ollama)), required: ollamaRequired } : null;
  const warnings = [
    ...databaseHealth.warnings,
    ...(embedding.ok || !embeddingRequired ? [] : [embedding.error ?? "Embedding provider is unavailable."]),
    ...ollamaWarnings(ollama, ollamaRequired)
  ];
  const warningActions = buildWarningActions({
    warnings,
    repairRecommended: !databaseHealth.ok && (databaseHealth.integrityCheck !== "ok" || !databaseHealth.fts.ok),
    ollama,
    ollamaRequired
  });

  return {
    ok: databaseHealth.ok && (embedding.ok || !embeddingRequired) && (!ollama || ollama.ok || !ollamaRequired),
    checkedAt: new Date().toISOString(),
    dashboard: {
      schemaVersion: DASHBOARD_SCHEMA_VERSION
    },
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
    maintenance: {
      repairRecommended: !databaseHealth.ok && (databaseHealth.integrityCheck !== "ok" || !databaseHealth.fts.ok),
      latestBackup: latestBackup ? serializeDashboardBackup(latestBackup) : null,
      backupRetention: {
        backupDir: backupRetention.backupDir,
        keepCount: backupRetention.keepCount,
        backupCount: backupRetention.backups.length,
        keptCount: backupRetention.kept.length,
        prunableCount: backupRetention.prunable.length,
        prunableSizeBytes: backupRetention.prunable.reduce((total, backup) => total + backup.sizeBytes, 0),
        latestBackup: latestBackup ? serializeDashboardBackup(latestBackup) : null,
        prunable: backupRetention.prunable.map(serializeDashboardBackup)
      }
    },
    embedding,
    ollama,
    directives: serializeDashboardDirectives([
      ...store.listDirectives({ includeGlobal: false, includeProject: true, limit: 50 }),
      ...store.listDirectives({ includeGlobal: true, includeProject: false, limit: 50 })
    ]),
    disabledDirectives: serializeDashboardDirectives(
      [
        ...store.listDirectives({ includeGlobal: false, includeProject: true, includeDisabled: true, limit: 100 }),
        ...store.listDirectives({ includeGlobal: true, includeProject: false, includeDisabled: true, limit: 100 })
      ].filter((directive) => directive.status !== "active")
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
      updatedAt: memory.updatedAt.toISOString()
    })),
    recentEvents: store.listRecentEvents({ limit: 10 }).map((event) => ({
      id: event.id,
      memoryId: event.memoryId,
      eventType: event.eventType,
      createdAt: event.createdAt.toISOString()
    })),
    warnings,
    warningActions
  };
}

function serializeDashboardBackup(backup: ReturnType<MemoryStore["planBackupRetention"]>["backups"][number]) {
  return {
    backupPath: backup.backupPath,
    sizeBytes: backup.sizeBytes,
    mtime: backup.mtime.toISOString()
  };
}

function serializeDashboardDirectives(directives: ReturnType<MemoryStore["listDirectives"]>): DashboardStatus["directives"] {
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
    updatedAt: directive.updatedAt.toISOString()
  }));
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

export function shouldOpenDashboardBrowser(value: string | undefined): boolean {
  if (value === undefined) {
    return true;
  }
  const normalized = value.trim().toLowerCase();
  return !["false", "0", "off", "no"].includes(normalized);
}

export function openDashboardUrl(url: string, opener: DashboardBrowserOpener = spawn): boolean {
  const command =
    process.platform === "win32"
      ? "cmd"
      : process.platform === "darwin"
        ? "open"
        : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];

  try {
    const child = opener(command, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true
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
  options: OllamaStatusOptions
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
      error: null
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
      error: error instanceof Error ? error.message : String(error)
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
}): DashboardStatus["warningActions"] {
  const actions: DashboardStatus["warningActions"] = [];

  if (
    options.repairRecommended ||
    options.warnings.some((warning) => warning.includes("FTS index is missing") || warning.includes("FTS index has"))
  ) {
    actions.push({
      severity: "warning",
      title: "検索インデックスの修復が必要です",
      message: "全文検索インデックスとメモリDBの内容に差分があります。",
      action: "MCP tool の repair_memory_index を実行してください。",
      tools: ["backup_memory", "repair_memory_index", "health_check"]
    });
  }

  if (options.warnings.some((warning) => warning.includes("Embedding provider") || warning.includes("Embedding unavailable"))) {
    actions.push({
      severity: "warning",
      title: "Embedding が利用できません",
      message: "検索の意味ベクトル処理が使えないため、検索品質が下がる可能性があります。",
      action: "Ollama アプリの起動状態と embedding model のインストール状態を確認してください。",
      tools: ["health_check"]
    });
  }

  if (options.ollamaRequired && options.ollama?.error) {
    actions.push({
      severity: "warning",
      title: "Ollama に接続できません",
      message: options.ollama.error,
      action: "Ollama アプリを起動し、OLLAMA_BASE_URL の endpoint が正しいか確認してください。",
      tools: ["health_check"]
    });
  }

  if (options.ollamaRequired && options.ollama && !options.ollama.error) {
    const missingModels = [
      ...(options.ollama.embeddingModelAvailable ? [] : [options.ollama.embeddingModel]),
      ...(options.ollama.maintenanceModelAvailable ? [] : [options.ollama.maintenanceModel])
    ];
    for (const model of missingModels) {
      actions.push({
        severity: "warning",
        title: "Ollama モデルが見つかりません",
        message: `設定済みモデル ${model} が Ollama のモデル一覧にありません。`,
        action: `Ollama に不足モデルを追加してください: ollama pull ${model}`,
        tools: ["health_check"]
      });
    }
  }

  if (options.warnings.length > 0 && actions.length === 0) {
    actions.push({
      severity: "warning",
      title: "確認が必要な警告があります",
      message: options.warnings.join(" / "),
      action: "README と health_check の結果を確認し、必要ならバックアップを作成してから対応してください。",
      tools: ["health_check", "backup_memory"]
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
  return modelNames.some((name) => name === configuredModel || name === `${configuredModel}:latest` || name.split(":")[0] === configuredModel);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function probeEmbedding(provider: EmbeddingProvider, required: boolean): Promise<DashboardStatus["embedding"]> {
  try {
    const vector = await provider.embed("codex memory sidecar dashboard health check");
    return {
      ok: true,
      dimensions: vector.length,
      error: null,
      required
    };
  } catch (error) {
    return {
      ok: false,
      dimensions: 0,
      error: error instanceof Error ? error.message : String(error),
      required
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
      .action-body {
        color: #cbd5e1;
      }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>Codex Memory Sidecar</h1>
      <button type="button" id="refresh">更新</button>
    </header>
    <section class="grid">
      <div class="panel"><p class="label">状態</p><p class="value" id="status">読み込み中</p></div>
      <div class="panel"><p class="label">メモリ</p><p class="value" id="memories">-</p></div>
      <div class="panel"><p class="label">イベント</p><p class="value" id="events">-</p></div>
      <div class="panel"><p class="label">データベース</p><p class="value" id="database">-</p></div>
      <div class="panel"><p class="label">Embedding</p><p class="value" id="embedding">-</p></div>
    </section>
    <h2>メモリ統計</h2>
    <section class="stats-grid">
      <div class="panel">
        <p class="label">状態別</p>
        <ul class="stats-list" id="status-stats"></ul>
      </div>
      <div class="panel">
        <p class="label">レイヤー別</p>
        <ul class="stats-list" id="layer-stats"></ul>
      </div>
      <div class="panel">
        <p class="label">更新日時</p>
        <ul class="stats-list" id="updated-stats"></ul>
      </div>
    </section>
    <h2>メンテナンス</h2>
    <section class="stats-grid">
      <div class="panel">
        <p class="label">インデックス修復</p>
        <p class="value" id="repair">-</p>
      </div>
      <div class="panel">
        <p class="label">最新バックアップ</p>
        <ul class="stats-list" id="backup-stats"></ul>
      </div>
      <div class="panel">
        <p class="label">バックアップ保持</p>
        <ul class="stats-list" id="retention-stats"></ul>
      </div>
      <div class="panel">
        <p class="label">警告と対応</p>
        <ul class="stats-list action-list" id="warnings"></ul>
      </div>
    </section>
    <h2>Ollama モデル</h2>
    <section class="stats-grid">
      <div class="panel">
        <p class="label">接続</p>
        <p class="value" id="ollama-status">-</p>
      </div>
      <div class="panel">
        <p class="label">設定済みモデル</p>
        <ul class="stats-list" id="ollama-configured"></ul>
      </div>
      <div class="panel">
        <p class="label">利用可能なモデル</p>
        <ul class="stats-list" id="ollama-models"></ul>
      </div>
    </section>
    <h2>プロジェクトスコープ</h2>
    <table>
      <thead><tr><th>スコープ</th><th>有効</th><th>合計</th><th>最新</th></tr></thead>
      <tbody id="project-scopes"></tbody>
    </table>
    <h2>Directive Memory</h2>
    <table>
      <thead><tr><th>ID</th><th>範囲</th><th>スコープ</th><th>指示内容</th><th>理由</th><th>情報源</th><th>更新</th></tr></thead>
      <tbody id="directives"></tbody>
    </table>
    <h2>無効化済み Directive Memory</h2>
    <table>
      <thead><tr><th>ID</th><th>範囲</th><th>スコープ</th><th>指示内容</th><th>理由</th><th>情報源</th><th>更新</th></tr></thead>
      <tbody id="disabled-directives"></tbody>
    </table>
    <h2>最近のメモリ</h2>
    <table>
      <thead><tr><th>ID</th><th>レイヤー</th><th>要約</th><th>情報源</th><th>スコープ</th><th>タグ</th><th>更新</th></tr></thead>
      <tbody id="recent-memories"></tbody>
    </table>
    <h2>最近のイベント</h2>
    <table>
      <thead><tr><th>ID</th><th>メモリ</th><th>種類</th><th>作成</th></tr></thead>
      <tbody id="recent-events"></tbody>
    </table>
  </main>
  <script>
    async function refresh() {
      const response = await fetch("/api/status");
      const status = await response.json();
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
  const embeddingProvider =
    config.embeddingMode === "off"
      ? undefined
      : new OllamaEmbeddingProvider({
          baseUrl: config.ollamaBaseUrl,
          model: config.embeddingModel
        });
  const server = createDashboardServer(store, {
    embeddingProvider,
    embeddingRequired: config.embeddingMode === "ollama",
    ollama:
      config.embeddingMode === "off"
        ? undefined
        : {
            baseUrl: config.ollamaBaseUrl,
            embeddingModel: config.embeddingModel,
            maintenanceModel: config.maintenanceModel
          },
    ollamaRequired: config.embeddingMode === "ollama"
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
