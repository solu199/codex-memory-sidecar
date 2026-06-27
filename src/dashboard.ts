#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
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
import type { Memory } from "./types.js";
import { runStartupMaintenance } from "./startup-maintenance.js";

export const DASHBOARD_SCHEMA_VERSION = "2026-06-13-dashboard-status-v3";
const DASHBOARD_MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const DASHBOARD_REPO_ROOT =
  path.basename(DASHBOARD_MODULE_DIR) === "src" &&
  path.basename(path.dirname(DASHBOARD_MODULE_DIR)) === "dist"
    ? path.dirname(path.dirname(DASHBOARD_MODULE_DIR))
    : path.basename(DASHBOARD_MODULE_DIR) === "src"
      ? path.dirname(DASHBOARD_MODULE_DIR)
      : process.cwd();
const OBSERVATORY_RUNTIME_PATH = path.join(
  DASHBOARD_REPO_ROOT,
  "vendor",
  "observatory-3d.bundle.js",
);
const DASHBOARD_APP_DIR = path.join(DASHBOARD_REPO_ROOT, "dist", "dashboard-app");
export const DASHBOARD_BUILD_FINGERPRINT = createDashboardBuildFingerprint();

function createDashboardBuildFingerprint(): string {
  const hash = createHash("sha256");
  hash.update(readFileSync(fileURLToPath(import.meta.url)));
  hash.update("\n");
  hashDashboardAssets(hash, DASHBOARD_APP_DIR);
  return hash.digest("hex").slice(0, 16);
}

function hashDashboardAssets(hash: ReturnType<typeof createHash>, directory: string): void {
  if (!existsSync(directory)) {
    hash.update("dashboard-app:missing");
    return;
  }
  const entries = readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
    left.name.localeCompare(right.name),
  );
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      hashDashboardAssets(hash, entryPath);
      continue;
    }
    if (entry.isFile()) {
      hash.update(path.relative(DASHBOARD_APP_DIR, entryPath));
      hash.update("\0");
      hash.update(readFileSync(entryPath));
      hash.update("\0");
    }
  }
}

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

export interface DashboardMemoryDetailOptions {
  includeContent?: boolean;
}

export type DashboardMemoryDetail =
  | {
      ok: true;
      memory: {
        id: number;
        layer: string;
        summary: string;
        tags: string[];
        projectScope: string;
        sourceType: string;
        sourceRef: string;
        sourceUrl: string | null;
        importance: number;
        confidence: number;
        status: string;
        contentAvailable: boolean;
        contentIncluded: boolean;
        content?: string;
        createdAt: string;
        updatedAt: string;
        validFrom: string;
        invalidatedAt: string | null;
        invalidatedByRef: string | null;
        invalidationReason: string | null;
        lastAccessedAt: string | null;
        expiresAt: string | null;
        known: string[];
        unknown: string[];
        verificationHints: string[];
      };
    }
  | {
      ok: false;
      error: string;
    };

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

export function buildDashboardMemoryDetail(
  store: MemoryStore,
  memoryId: number,
  options: DashboardMemoryDetailOptions = {},
): DashboardMemoryDetail {
  const memory = store.getMemory(memoryId);
  if (!memory) {
    return {
      ok: false,
      error: `Memory ${memoryId} was not found.`,
    };
  }

  return {
    ok: true,
    memory: serializeDashboardMemoryDetail(memory, options),
  };
}

function serializeDashboardMemoryDetail(
  memory: Memory,
  options: DashboardMemoryDetailOptions,
): Extract<DashboardMemoryDetail, { ok: true }>["memory"] {
  const includeContent = options.includeContent ?? false;
  const guidance = buildMemoryDetailGuidance(memory);
  return {
    id: memory.id,
    layer: memory.layer,
    summary: memory.summary,
    tags: memory.tags,
    projectScope: memory.projectScope,
    sourceType: memory.sourceType,
    sourceRef: memory.sourceRef,
    sourceUrl: sourceRefUrl(memory.sourceType, memory.sourceRef),
    importance: memory.importance,
    confidence: memory.confidence,
    status: memory.status,
    contentAvailable: memory.content.length > 0,
    contentIncluded: includeContent,
    ...(includeContent ? { content: memory.content } : {}),
    createdAt: memory.createdAt.toISOString(),
    updatedAt: memory.updatedAt.toISOString(),
    validFrom: memory.validFrom.toISOString(),
    invalidatedAt: memory.invalidatedAt?.toISOString() ?? null,
    invalidatedByRef: memory.invalidatedByRef,
    invalidationReason: memory.invalidationReason,
    lastAccessedAt: memory.lastAccessedAt?.toISOString() ?? null,
    expiresAt: memory.expiresAt?.toISOString() ?? null,
    known: guidance.known,
    unknown: guidance.unknown,
    verificationHints: guidance.verificationHints,
  };
}

function buildMemoryDetailGuidance(memory: Memory): {
  known: string[];
  unknown: string[];
  verificationHints: string[];
} {
  const source = `${memory.sourceType}: ${memory.sourceRef}`;
  const statusLabel =
    memory.status === "active"
      ? "active"
      : memory.status === "superseded"
        ? "superseded"
        : "forgotten";
  const known = [
    `保存されている sourceRef は ${source} です。`,
    `このメモリは ${statusLabel} として扱われます。`,
    `保存先は layer=${memory.layer} / projectScope=${memory.projectScope} です。`,
  ];
  if (memory.invalidatedAt) {
    known.push(
      `無効化情報として ${memory.invalidatedAt.toISOString()} に ${memory.invalidatedByRef ?? "unknown"} が記録されています。`,
    );
  }

  const unknown = [
    "この要約が現在のコード、README、docs、最新指示と一致するかは、この画面だけでは確定できません。",
    "保存時に見ていた周辺ファイルや会話全文は、この詳細だけでは再構成できません。",
  ];
  if (!sourceRefUrl(memory.sourceType, memory.sourceRef)) {
    unknown.push("sourceRef から一次ソースへ直接移動できる保証はありません。");
  }

  const verificationHints = [
    "sourceRef を起点に、README / docs / git history などの一次ソースを確認してください。",
    memory.status === "active"
      ? "重要な判断に使う前に、現在の実ファイルと矛盾しないか確認してください。"
      : "無効化済みメモリなので、invalidatedByRef と invalidationReason を確認してから参照してください。",
  ];

  return { known, unknown, verificationHints };
}

function sourceRefUrl(sourceType: string, sourceRef: string): string | null {
  if (/^https?:\/\//.test(sourceRef)) {
    return sourceRef;
  }
  const repositoryUrl = "https://github.com/solu199/codex-memory-sidecar";
  const pullRequestMatch = /^pr:#?(\d+)$/i.exec(sourceRef);
  if (sourceType === "github-pr" || pullRequestMatch) {
    const number = pullRequestMatch?.[1] ?? /^#?(\d+)$/.exec(sourceRef)?.[1];
    return number ? `${repositoryUrl}/pull/${number}` : null;
  }
  const issueMatch = /^issue:#?(\d+)$/i.exec(sourceRef);
  if (sourceType === "github-issue" || issueMatch) {
    const number = issueMatch?.[1] ?? /^#?(\d+)$/.exec(sourceRef)?.[1];
    return number ? `${repositoryUrl}/issues/${number}` : null;
  }
  const commitMatch = /^git:([0-9a-f]{7,40})$/i.exec(sourceRef);
  if (sourceType === "git-commit" || commitMatch) {
    const hash = commitMatch?.[1] ?? sourceRef;
    return /^[0-9a-f]{7,40}$/i.test(hash) ? `${repositoryUrl}/commit/${hash}` : null;
  }
  return null;
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
        const includeSuperseded = ["1", "true", "yes"].includes(
          (url.searchParams.get("includeSuperseded") ?? "").toLowerCase(),
        );
        const includeForgotten = ["1", "true", "yes"].includes(
          (url.searchParams.get("includeForgotten") ?? "").toLowerCase(),
        );
        sendJson(response, 200, buildMemoryGraph(store, { includeSuperseded, includeForgotten }));
        return;
      }

      const memoryDetailMatch = /^\/api\/memories\/(\d+)$/.exec(url.pathname);
      if (memoryDetailMatch) {
        const includeContent = ["1", "true", "yes"].includes(
          (url.searchParams.get("includeContent") ?? "").toLowerCase(),
        );
        const detail = buildDashboardMemoryDetail(store, Number(memoryDetailMatch[1]), {
          includeContent,
        });
        sendJson(response, detail.ok ? 200 : 404, detail);
        return;
      }

      if (url.pathname === "/assets/observatory-3d.bundle.js") {
        sendJavaScript(response, 200, readFileSync(OBSERVATORY_RUNTIME_PATH, "utf8"));
        return;
      }

      if (url.pathname.startsWith("/dashboard-assets/")) {
        const assetPath = resolveDashboardAssetPath(url.pathname);
        if (!assetPath) {
          sendText(response, 404, "Not Found");
          return;
        }
        sendStaticAsset(response, assetPath);
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
  const indexPath = path.join(DASHBOARD_APP_DIR, "index.html");
  if (!existsSync(indexPath)) {
    return '<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>Codex Memory Sidecar</title></head><body><main><h1>Codex Memory Sidecar</h1><p>Dashboard app assets are missing. Run <code>npm run build</code> before opening the Dashboard.</p></main></body></html>';
  }
  return readFileSync(indexPath, "utf8");
}

function resolveDashboardAssetPath(urlPathname: string): string | null {
  const prefix = "/dashboard-assets/";
  const relative = decodeURIComponent(urlPathname.slice(prefix.length));
  if (!relative || relative.includes("\0")) {
    return null;
  }
  const resolved = path.resolve(DASHBOARD_APP_DIR, relative);
  const root = path.resolve(DASHBOARD_APP_DIR);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    return null;
  }
  if (!existsSync(resolved) || !statSync(resolved).isFile()) {
    return null;
  }
  return resolved;
}

function sendStaticAsset(response: ServerResponse, assetPath: string): void {
  response.writeHead(200, {
    "content-type": contentTypeForPath(assetPath),
    "cache-control": "public, max-age=31536000, immutable",
  });
  response.end(readFileSync(assetPath));
}

function contentTypeForPath(assetPath: string): string {
  const extension = path.extname(assetPath).toLowerCase();
  if (extension === ".js") return "text/javascript; charset=utf-8";
  if (extension === ".css") return "text/css; charset=utf-8";
  if (extension === ".svg") return "image/svg+xml";
  if (extension === ".png") return "image/png";
  if (extension === ".ico") return "image/x-icon";
  if (extension === ".json") return "application/json; charset=utf-8";
  return "application/octet-stream";
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
