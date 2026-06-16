import { MemoryStore } from "./memory-store.js";
import type { Directive, Memory, SearchMemoryResult } from "./types.js";

export function serializeDatabaseHealth(health: ReturnType<MemoryStore["checkDatabaseHealth"]>) {
  return {
    ok: health.ok,
    integrityCheck: health.integrityCheck,
    fts: health.fts,
    walCheckpoint: health.walCheckpoint,
    warnings: health.warnings,
    checkedAt: health.checkedAt.toISOString(),
  };
}

export function serializeMemoryStats(stats: ReturnType<MemoryStore["getStats"]>) {
  return {
    memoryCount: stats.memoryCount,
    eventCount: stats.eventCount,
    byStatus: stats.byStatus,
    byLayer: stats.byLayer,
    byProjectScope: stats.byProjectScope.map((scope) => ({
      projectScope: scope.projectScope,
      total: scope.total,
      active: scope.active,
      latestUpdatedAt: scope.latestUpdatedAt?.toISOString() ?? null,
    })),
    updatedAtRange: {
      oldest: stats.updatedAtRange.oldest?.toISOString() ?? null,
      newest: stats.updatedAtRange.newest?.toISOString() ?? null,
    },
  };
}

export function serializeBackupRetentionEntry(
  entry: ReturnType<MemoryStore["planBackupRetention"]>["backups"][number],
) {
  return {
    backupPath: entry.backupPath,
    sizeBytes: entry.sizeBytes,
    mtime: entry.mtime.toISOString(),
  };
}

export function serializeBackupRetentionSummary(
  plan: ReturnType<MemoryStore["planBackupRetention"]>,
) {
  const latestBackup = plan.backups[0] ?? null;

  return {
    backupDir: plan.backupDir,
    keepCount: plan.keepCount,
    backupCount: plan.backups.length,
    keptCount: plan.kept.length,
    prunableCount: plan.prunable.length,
    prunableSizeBytes: plan.prunable.reduce((total, backup) => total + backup.sizeBytes, 0),
    latestBackup: latestBackup ? serializeBackupRetentionEntry(latestBackup) : null,
    prunable: plan.prunable.map(serializeBackupRetentionEntry),
    wouldDelete: false,
    plannedAt: plan.plannedAt.toISOString(),
  };
}

export function serializeSearchResult(
  result: SearchMemoryResult,
  options: { includeEmbedding?: boolean } = {},
) {
  return {
    ...serializeMemory(result.memory, options),
    score: result.score,
    scoreBreakdown: result.scoreBreakdown,
  };
}

export function serializeMemory(memory: Memory, options: { includeEmbedding?: boolean } = {}) {
  return {
    id: memory.id,
    layer: memory.layer,
    content: memory.content,
    summary: memory.summary,
    tags: memory.tags,
    projectScope: memory.projectScope,
    sourceType: memory.sourceType,
    sourceRef: memory.sourceRef,
    importance: memory.importance,
    confidence: memory.confidence,
    embedding: options.includeEmbedding ? memory.embedding : null,
    createdAt: memory.createdAt.toISOString(),
    updatedAt: memory.updatedAt.toISOString(),
    validFrom: memory.validFrom.toISOString(),
    invalidatedAt: memory.invalidatedAt?.toISOString() ?? null,
    invalidatedByRef: memory.invalidatedByRef,
    invalidationReason: memory.invalidationReason,
    lastAccessedAt: memory.lastAccessedAt?.toISOString() ?? null,
    expiresAt: memory.expiresAt?.toISOString() ?? null,
    status: memory.status,
  };
}

export function serializeDirective(directive: Directive) {
  return {
    id: directive.id,
    scope: directive.scope,
    projectScope: directive.projectScope,
    content: directive.content,
    rationale: directive.rationale,
    tags: directive.tags,
    sourceType: directive.sourceType,
    sourceRef: directive.sourceRef,
    priority: directive.priority,
    createdAt: directive.createdAt.toISOString(),
    updatedAt: directive.updatedAt.toISOString(),
    status: directive.status,
  };
}

export function serializeMemorySummary(memory: Memory) {
  return {
    id: memory.id,
    layer: memory.layer,
    summary: memory.summary,
    tags: memory.tags,
    projectScope: memory.projectScope,
    sourceType: memory.sourceType,
    sourceRef: memory.sourceRef,
    importance: memory.importance,
    confidence: memory.confidence,
    createdAt: memory.createdAt.toISOString(),
    updatedAt: memory.updatedAt.toISOString(),
    validFrom: memory.validFrom.toISOString(),
    invalidatedAt: memory.invalidatedAt?.toISOString() ?? null,
    invalidatedByRef: memory.invalidatedByRef,
    invalidationReason: memory.invalidationReason,
    lastAccessedAt: memory.lastAccessedAt?.toISOString() ?? null,
    expiresAt: memory.expiresAt?.toISOString() ?? null,
    status: memory.status,
  };
}

export function serializeSessionMemory(result: SearchMemoryResult) {
  return {
    id: result.memory.id,
    layer: result.memory.layer,
    summary: result.memory.summary,
    tags: result.memory.tags,
    projectScope: result.memory.projectScope,
    sourceType: result.memory.sourceType,
    sourceRef: result.memory.sourceRef,
    importance: result.memory.importance,
    confidence: result.memory.confidence,
    updatedAt: result.memory.updatedAt.toISOString(),
    validFrom: result.memory.validFrom.toISOString(),
    invalidatedAt: result.memory.invalidatedAt?.toISOString() ?? null,
    invalidatedByRef: result.memory.invalidatedByRef,
    invalidationReason: result.memory.invalidationReason,
    status: result.memory.status,
    score: result.score,
    scoreBreakdown: result.scoreBreakdown,
  };
}

export function serializeBackupMemorySummary(
  memory: ReturnType<MemoryStore["inspectBackup"]>["memories"][number],
) {
  return {
    id: memory.id,
    layer: memory.layer,
    summary: memory.summary,
    tags: memory.tags,
    projectScope: memory.projectScope,
    sourceType: memory.sourceType,
    sourceRef: memory.sourceRef,
    importance: memory.importance,
    confidence: memory.confidence,
    createdAt: memory.createdAt.toISOString(),
    updatedAt: memory.updatedAt.toISOString(),
    validFrom: memory.validFrom?.toISOString() ?? null,
    invalidatedAt: memory.invalidatedAt?.toISOString() ?? null,
    invalidatedByRef: memory.invalidatedByRef,
    invalidationReason: memory.invalidationReason,
    lastAccessedAt: memory.lastAccessedAt?.toISOString() ?? null,
    expiresAt: memory.expiresAt?.toISOString() ?? null,
    status: memory.status,
  };
}
