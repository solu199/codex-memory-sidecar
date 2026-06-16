import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import { cosineSimilarity } from "./embedding.js";
import { containsLikelySecret, isLikelySecretKey } from "./secret-detection.js";
import type {
  CreateMemoryInput,
  CreateDirectiveInput,
  CreateBackupInput,
  DatabaseHealth,
  Directive,
  DirectiveEventType,
  ForgetMemoryInput,
  InspectBackupInput,
  DisableDirectiveInput,
  ListDirectivesInput,
  ListRecentEventsInput,
  ListMemoriesInput,
  Memory,
  BackupInspection,
  BackupMemorySummary,
  BackupRetentionPlan,
  BackupRetentionPlanInput,
  MemoryBackup,
  MemoryEvent,
  MemoryEventType,
  MemoryIndexRepair,
  MemoryLayer,
  MemoryStats,
  RepairMemoryIndexInput,
  BackupVerification,
  MemoryStoreCounts,
  SearchMemoryInput,
  SearchMemoryResult,
  UpdateMemoryInput,
  VerifyBackupInput,
} from "./types.js";

interface MemoryRow {
  id: number;
  layer: MemoryLayer;
  content: string;
  summary: string;
  tags: string;
  project_scope: string;
  source_type: string;
  source_ref: string;
  importance: number;
  confidence: number;
  embedding: string | null;
  created_at: string;
  updated_at: string;
  valid_from?: string | null;
  invalidated_at?: string | null;
  invalidated_by_ref?: string | null;
  invalidation_reason?: string | null;
  last_accessed_at: string | null;
  expires_at: string | null;
  status: Memory["status"];
}

interface EventRow {
  id: number;
  memory_id: number;
  event_type: MemoryEventType;
  payload_json: string;
  created_at: string;
}

interface DirectiveRow {
  id: number;
  scope: Directive["scope"];
  project_scope: string;
  content: string;
  rationale: string;
  tags: string;
  source_type: string;
  source_ref: string;
  priority: number;
  created_at: string;
  updated_at: string;
  status: Directive["status"];
}

interface BackupMemorySummaryRow {
  id: number;
  layer: MemoryLayer;
  summary: string;
  tags: string;
  project_scope?: string;
  source_type: string;
  source_ref: string;
  importance: number;
  confidence: number;
  created_at: string;
  updated_at: string;
  valid_from?: string | null;
  invalidated_at?: string | null;
  invalidated_by_ref?: string | null;
  invalidation_reason?: string | null;
  last_accessed_at: string | null;
  expires_at: string | null;
  status: Memory["status"];
}

interface CountByValueRow<T extends string> {
  value: T;
  count: number;
}

interface UpdatedAtRangeRow {
  oldest: string | null;
  newest: string | null;
}

interface ProjectScopeStatsRow {
  project_scope: string;
  total: number;
  active: number;
  latest_updated_at: string | null;
}

const DEFAULT_HYBRID_CANDIDATE_LIMIT = 250;
const MAX_HYBRID_CANDIDATE_LIMIT = 1000;
const GLOBAL_PROJECT_SCOPE = "global";
const DEFAULT_BACKUP_RETENTION_KEEP_COUNT = 10;
const DEFAULT_BACKUP_FILE_PATTERN = /^memory-\d{8}-\d{6}-\d{3}(?:-\d+)?\.sqlite$/;
const REQUIRED_BACKUP_TABLES = ["memories", "memory_events", "memories_fts"] as const;
const MAX_AUDIT_STRING_LENGTH = 2048;
const BI_TEMPORAL_BACKFILL_REF = "migration:bi-temporal-v1";
const BI_TEMPORAL_BACKFILL_REASON =
  "Backfilled from existing memory status during bi-temporal migration.";
const BI_TEMPORAL_MEMORY_COLUMNS = [
  "valid_from",
  "invalidated_at",
  "invalidated_by_ref",
  "invalidation_reason",
];

export class MemoryStore {
  private readonly db: Database.Database;
  private readonly databasePath: string;

  constructor(databasePath: string) {
    this.databasePath = databasePath;
    mkdirSync(path.dirname(databasePath), { recursive: true });
    this.db = new Database(databasePath);
    this.db.pragma("busy_timeout = 5000");
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  createMemory(input: CreateMemoryInput): Memory {
    this.assertStorable(input.content, input.allowSecret);

    const now = new Date();
    const projectScope = resolveProjectScope(input);
    const result = this.db
      .prepare(
        `INSERT INTO memories (
          layer, content, summary, tags, project_scope, source_type, source_ref,
          importance, confidence, embedding, created_at, updated_at, valid_from, expires_at, status
        ) VALUES (
          @layer, @content, @summary, @tags, @projectScope, @sourceType, @sourceRef,
          @importance, @confidence, @embedding, @createdAt, @updatedAt, @validFrom, @expiresAt, 'active'
        )`,
      )
      .run({
        layer: input.layer,
        content: input.content,
        summary: input.summary ?? summarize(input.content),
        tags: JSON.stringify(input.tags ?? []),
        projectScope,
        sourceType: input.sourceType,
        sourceRef: input.sourceRef,
        importance: clampScore(input.importance ?? 0.5),
        confidence: clampScore(input.confidence ?? 0.5),
        embedding: input.embedding ? JSON.stringify(input.embedding) : null,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        validFrom: now.toISOString(),
        expiresAt: input.expiresAt?.toISOString() ?? null,
      });

    const memory = this.getMemory(Number(result.lastInsertRowid));
    if (!memory) {
      throw new Error("Failed to read created memory.");
    }

    this.indexMemory(memory);
    this.recordEvent(memory.id, "created", { input: redactedInput(input) });
    return memory;
  }

  getMemory(memoryId: number): Memory | null {
    const row = this.db.prepare("SELECT * FROM memories WHERE id = ?").get(memoryId) as
      | MemoryRow
      | undefined;
    return row ? mapMemory(row) : null;
  }

  updateMemory(input: UpdateMemoryInput): Memory {
    this.assertStorable(input.newContent, input.allowSecret);
    const existing = this.requireMemory(input.memoryId);
    const now = new Date();

    this.db
      .prepare(
        `UPDATE memories
         SET content = @content,
             summary = @summary,
             tags = @tags,
             embedding = @embedding,
             updated_at = @updatedAt
         WHERE id = @id`,
      )
      .run({
        id: input.memoryId,
        content: input.newContent,
        summary: input.summary ?? summarize(input.newContent),
        tags: JSON.stringify(input.tags ?? existing.tags),
        embedding: input.embedding ? JSON.stringify(input.embedding) : null,
        updatedAt: now.toISOString(),
      });

    const updated = this.requireMemory(input.memoryId);
    this.indexMemory(updated);
    this.recordEvent(updated.id, "updated", {
      updateNote: input.updateNote,
      previousSummary: existing.summary,
    });
    return updated;
  }

  forgetMemory(input: ForgetMemoryInput): Memory {
    const existing = this.requireMemory(input.memoryId);
    const invalidatedAt = new Date();
    const invalidationPayload = {
      invalidatedAt: invalidatedAt.toISOString(),
      invalidatedByRef: input.invalidatedByRef ?? null,
      invalidationReason: input.reason,
    };

    if (input.hardDelete) {
      if (!input.confirmHardDelete) {
        throw new Error("Hard delete requires confirmHardDelete=true.");
      }
      this.deleteFtsRow(input.memoryId);
      this.db.prepare("DELETE FROM memories WHERE id = ?").run(input.memoryId);
      this.recordEvent(input.memoryId, "forgotten", {
        reason: input.reason,
        hardDelete: true,
        previousStatus: existing.status,
        ...invalidationPayload,
      });
      return { ...existing, status: "forgotten" };
    }

    this.db
      .prepare(
        `UPDATE memories
         SET status = 'forgotten',
             updated_at = ?,
             invalidated_at = ?,
             invalidated_by_ref = ?,
             invalidation_reason = ?
         WHERE id = ?`,
      )
      .run(
        invalidatedAt.toISOString(),
        invalidatedAt.toISOString(),
        input.invalidatedByRef ?? null,
        input.reason,
        input.memoryId,
      );
    this.deleteFtsRow(input.memoryId);
    this.recordEvent(input.memoryId, "forgotten", {
      reason: input.reason,
      hardDelete: false,
      previousStatus: existing.status,
      ...invalidationPayload,
    });
    return this.requireMemory(input.memoryId);
  }

  searchMemory(input: SearchMemoryInput): SearchMemoryResult[] {
    if (input.queryEmbedding?.length) {
      return this.searchMemoryWithEmbedding(input);
    }

    const limit = Math.max(1, Math.min(input.limit ?? 8, 50));
    const rows = this.keywordCandidateRows(input, limit, true);
    const results = rows.map((row) => scoreKeywordRow(row));

    this.recordSearchRetrieval(input, results);

    return results;
  }

  private keywordCandidateRows(
    input: SearchMemoryInput,
    limit: number,
    includeKeywordRank: true,
  ): (MemoryRow & { keyword_rank: number })[];
  private keywordCandidateRows(
    input: SearchMemoryInput,
    limit: number,
    includeKeywordRank?: false,
  ): MemoryRow[];
  private keywordCandidateRows(
    input: SearchMemoryInput,
    limit: number,
    includeKeywordRank = false,
  ): (MemoryRow & { keyword_rank: number })[] | MemoryRow[] {
    const ftsRows = this.rrfKeywordRows(input, limit);

    if (ftsRows.length >= limit) {
      return includeKeywordRank ? ftsRows : ftsRows.map(stripKeywordRank);
    }

    const fallbackRows = this.likeFallbackRows(
      input,
      limit - ftsRows.length,
      new Set(ftsRows.map((row) => row.id)),
    );
    const mergedRows = [
      ...ftsRows,
      ...fallbackRows.map((row) => ({ ...row, keyword_rank: 0.5 })),
    ].slice(0, limit);

    return includeKeywordRank ? mergedRows : mergedRows.map(stripKeywordRank);
  }

  private rrfKeywordRows(
    input: SearchMemoryInput,
    limit: number,
  ): (MemoryRow & { keyword_rank: number })[] {
    const candidateLimit = Math.max(limit, Math.min(limit * 4, 100));
    const trigramRows = this.ftsRows(input, "memories_fts", candidateLimit);
    const porterRows = this.ftsRows(input, "memories_fts_porter", candidateLimit);
    const rowById = new Map<number, MemoryRow>();
    const rrfScoreById = new Map<number, number>();
    const bestRankById = new Map<number, number>();

    for (const rows of [trigramRows, porterRows]) {
      rows.forEach((row, index) => {
        rowById.set(row.id, row);
        rrfScoreById.set(row.id, (rrfScoreById.get(row.id) ?? 0) + 1 / (60 + index + 1));
        bestRankById.set(
          row.id,
          Math.min(bestRankById.get(row.id) ?? Number.POSITIVE_INFINITY, row.keyword_rank),
        );
      });
    }

    return [...rowById.values()]
      .map((row) => ({
        ...row,
        keyword_rank: -(rrfScoreById.get(row.id) ?? 0),
        best_keyword_rank: bestRankById.get(row.id) ?? 0,
      }))
      .sort((left, right) => {
        const byRrf = left.keyword_rank - right.keyword_rank;
        if (byRrf !== 0) {
          return byRrf;
        }

        const byKeywordRank = left.best_keyword_rank - right.best_keyword_rank;
        if (byKeywordRank !== 0) {
          return byKeywordRank;
        }

        const byImportance = right.importance - left.importance;
        if (byImportance !== 0) {
          return byImportance;
        }

        const byUpdated = right.updated_at.localeCompare(left.updated_at);
        return byUpdated || right.id - left.id;
      })
      .slice(0, limit)
      .map(({ best_keyword_rank: _bestKeywordRank, ...row }) => row);
  }

  private ftsRows(
    input: SearchMemoryInput,
    table: "memories_fts" | "memories_fts_porter",
    limit: number,
  ): (MemoryRow & { keyword_rank: number })[] {
    const clauses = [`${table} MATCH @query`];
    const params: Record<string, unknown> = {
      query: quoteFtsQuery(input.query),
      limit,
    };

    addMemorySearchFilters(clauses, params, input, "m.");

    return this.db
      .prepare(
        `SELECT m.*, bm25(${table}) AS keyword_rank
         FROM ${table}
         JOIN memories m ON m.id = ${table}.rowid
         WHERE ${clauses.join(" AND ")}
         ORDER BY keyword_rank ASC, m.importance DESC, m.updated_at DESC
         LIMIT @limit`,
      )
      .all(params) as (MemoryRow & { keyword_rank: number })[];
  }

  listEvents(memoryId: number): MemoryEvent[] {
    const rows = this.db
      .prepare("SELECT * FROM memory_events WHERE memory_id = ? ORDER BY id ASC")
      .all(memoryId) as EventRow[];
    return rows.map(mapEvent);
  }

  listRecentEvents(input: ListRecentEventsInput = {}): MemoryEvent[] {
    const limit = Math.max(1, Math.min(input.limit ?? 20, 100));
    if (input.memoryId) {
      const rows = this.db
        .prepare("SELECT * FROM memory_events WHERE memory_id = ? ORDER BY id DESC LIMIT ?")
        .all(input.memoryId, limit) as EventRow[];
      return rows.map(mapEvent);
    }

    const rows = this.db
      .prepare("SELECT * FROM memory_events ORDER BY id DESC LIMIT ?")
      .all(limit) as EventRow[];
    return rows.map(mapEvent);
  }

  listMemories(input: ListMemoriesInput = {}): Memory[] {
    const limit = Math.max(1, Math.min(input.limit ?? 100, 500));
    const statuses: Memory["status"][] = ["active"];
    if (input.includeSuperseded) {
      statuses.push("superseded");
    }
    if (input.includeForgotten) {
      statuses.push("forgotten");
    }
    const clauses = [`status IN (${statuses.map((_, index) => `@status${index}`).join(", ")})`];
    const params: Record<string, unknown> = { limit };
    statuses.forEach((status, index) => {
      params[`status${index}`] = status;
    });

    if (input.layers?.length) {
      clauses.push(`layer IN (${input.layers.map((_, index) => `@layer${index}`).join(", ")})`);
      input.layers.forEach((layer, index) => {
        params[`layer${index}`] = layer;
      });
    }

    if (input.since) {
      clauses.push("updated_at >= @since");
      params.since = new Date(input.since).toISOString();
    }

    addProjectScopeFilter(clauses, params, input);

    const rows = this.db
      .prepare(
        `SELECT * FROM memories WHERE ${clauses.join(" AND ")} ORDER BY updated_at DESC, id DESC LIMIT @limit`,
      )
      .all(params) as MemoryRow[];
    return rows.map(mapMemory);
  }

  createDirective(input: CreateDirectiveInput): Directive {
    this.assertStorable(input.content, input.allowSecret);
    if (!input.rationale.trim()) {
      throw new Error("Directive rationale cannot be empty.");
    }

    const now = new Date();
    const projectScope =
      input.scope === "global" ? GLOBAL_PROJECT_SCOPE : resolveProjectScope(input);
    const result = this.db
      .prepare(
        `INSERT INTO directives (
          scope, project_scope, content, rationale, tags, source_type, source_ref,
          priority, created_at, updated_at, status
        ) VALUES (
          @scope, @projectScope, @content, @rationale, @tags, @sourceType, @sourceRef,
          @priority, @createdAt, @updatedAt, 'active'
        )`,
      )
      .run({
        scope: input.scope,
        projectScope,
        content: input.content,
        rationale: input.rationale,
        tags: JSON.stringify(input.tags ?? []),
        sourceType: input.sourceType,
        sourceRef: input.sourceRef,
        priority: clampScore(input.priority ?? 0.75),
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      });

    const directive = this.requireDirective(Number(result.lastInsertRowid));
    this.recordDirectiveEvent(directive.id, "created", {
      scope: directive.scope,
      projectScope: directive.projectScope,
      sourceType: directive.sourceType,
      sourceRef: directive.sourceRef,
    });
    return directive;
  }

  listDirectives(input: ListDirectivesInput = {}): Directive[] {
    const limit = Math.max(1, Math.min(input.limit ?? 100, 500));
    const includeGlobal = input.includeGlobal ?? true;
    const includeProject = input.includeProject ?? true;
    const projectScope = resolveProjectScope(input);
    const clauses: string[] = [];
    const params: Record<string, unknown> = { limit };

    if (!input.includeDisabled) {
      clauses.push("status = 'active'");
    }

    const scopeClauses: string[] = [];
    if (includeGlobal) {
      scopeClauses.push("(scope = 'global' AND project_scope = @globalProjectScope)");
      params.globalProjectScope = GLOBAL_PROJECT_SCOPE;
    }
    if (includeProject && projectScope !== GLOBAL_PROJECT_SCOPE) {
      scopeClauses.push("(scope = 'project' AND project_scope = @projectScope)");
      params.projectScope = projectScope;
    } else if (includeProject && !includeGlobal) {
      scopeClauses.push("scope = 'project'");
    }
    if (!scopeClauses.length) {
      return [];
    }
    clauses.push(`(${scopeClauses.join(" OR ")})`);

    const rows = this.db
      .prepare(
        `SELECT * FROM directives
         WHERE ${clauses.join(" AND ")}
         ORDER BY CASE scope WHEN 'project' THEN 0 ELSE 1 END, priority DESC, updated_at DESC, id DESC
         LIMIT @limit`,
      )
      .all(params) as DirectiveRow[];

    return rows.map(mapDirective);
  }

  disableDirective(input: DisableDirectiveInput): Directive {
    const existing = this.requireDirective(input.directiveId);
    this.db
      .prepare("UPDATE directives SET status = 'disabled', updated_at = ? WHERE id = ?")
      .run(new Date().toISOString(), input.directiveId);
    this.recordDirectiveEvent(input.directiveId, "disabled", {
      reason: input.reason,
      previousStatus: existing.status,
    });
    return this.requireDirective(input.directiveId);
  }

  countRecords(): MemoryStoreCounts {
    return {
      memoryCount: countRows(this.db, "memories"),
      eventCount: countRows(this.db, "memory_events"),
    };
  }

  checkDatabaseHealth(
    input: {
      integrityCheck?: boolean;
      ftsSanityCheck?: boolean;
      walCheckpoint?: boolean;
    } = {},
  ): DatabaseHealth {
    const shouldCheckIntegrity = input.integrityCheck ?? true;
    const shouldCheckFts = input.ftsSanityCheck ?? true;
    const shouldCheckpointWal = input.walCheckpoint ?? true;
    const integrityCheck = shouldCheckIntegrity
      ? runIntegrityCheck(this.db, "quick_check")
      : "skipped";
    const fts = shouldCheckFts ? this.checkFtsConsistency() : skippedFtsHealth();
    const walCheckpoint = shouldCheckpointWal
      ? checkpointWal(this.db)
      : { busy: 0, log: 0, checkpointed: 0 };
    const warnings = [
      ...(integrityCheck === "ok" ? [] : [`Database quick_check failed: ${integrityCheck}`]),
      ...(fts.missingCount > 0
        ? [`FTS index is missing ${fts.missingCount} active memory row(s).`]
        : []),
      ...(fts.orphanCount > 0
        ? [`FTS index contains ${fts.orphanCount} orphan or forgotten row(s).`]
        : []),
      ...(fts.porter.missingCount > 0
        ? [`Porter FTS index is missing ${fts.porter.missingCount} active memory row(s).`]
        : []),
      ...(fts.porter.orphanCount > 0
        ? [`Porter FTS index contains ${fts.porter.orphanCount} orphan or forgotten row(s).`]
        : []),
      ...(walCheckpoint.busy > 0
        ? [`WAL checkpoint reported ${walCheckpoint.busy} busy frame(s).`]
        : []),
    ];

    return {
      ok:
        (integrityCheck === "ok" || integrityCheck === "skipped") &&
        fts.ok &&
        walCheckpoint.busy === 0,
      integrityCheck,
      fts,
      walCheckpoint,
      warnings,
      checkedAt: new Date(),
    };
  }

  getStats(): MemoryStats {
    const byStatus: MemoryStats["byStatus"] = {
      active: 0,
      superseded: 0,
      forgotten: 0,
    };
    const byLayer: MemoryStats["byLayer"] = {
      core: 0,
      recall: 0,
      archival: 0,
    };

    const statusRows = this.db
      .prepare("SELECT status AS value, COUNT(*) AS count FROM memories GROUP BY status")
      .all() as CountByValueRow<Memory["status"]>[];
    for (const row of statusRows) {
      byStatus[row.value] = row.count;
    }

    const layerRows = this.db
      .prepare("SELECT layer AS value, COUNT(*) AS count FROM memories GROUP BY layer")
      .all() as CountByValueRow<MemoryLayer>[];
    for (const row of layerRows) {
      byLayer[row.value] = row.count;
    }

    const projectScopeRows = this.db
      .prepare(
        `SELECT project_scope,
                COUNT(*) AS total,
                SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active,
                MAX(updated_at) AS latest_updated_at
         FROM memories
         GROUP BY project_scope
         ORDER BY active DESC, total DESC, latest_updated_at DESC, project_scope ASC`,
      )
      .all() as ProjectScopeStatsRow[];

    const updatedAtRange = this.db
      .prepare("SELECT MIN(updated_at) AS oldest, MAX(updated_at) AS newest FROM memories")
      .get() as UpdatedAtRangeRow;

    return {
      ...this.countRecords(),
      byStatus,
      byLayer,
      byProjectScope: projectScopeRows.map((row) => ({
        projectScope: row.project_scope,
        total: row.total,
        active: row.active,
        latestUpdatedAt: row.latest_updated_at ? new Date(row.latest_updated_at) : null,
      })),
      updatedAtRange: {
        oldest: updatedAtRange.oldest ? new Date(updatedAtRange.oldest) : null,
        newest: updatedAtRange.newest ? new Date(updatedAtRange.newest) : null,
      },
    };
  }

  async createBackup(input: CreateBackupInput): Promise<MemoryBackup> {
    const backupPath = input.backupPath ?? this.defaultBackupPath();
    mkdirSync(path.dirname(backupPath), { recursive: true });
    await this.db.backup(backupPath);
    return {
      backupPath,
      createdAt: new Date(),
    };
  }

  planBackupRetention(input: BackupRetentionPlanInput = {}): BackupRetentionPlan {
    const backupDir = this.defaultBackupDir();
    const keepCount = Math.max(
      0,
      Math.floor(input.keepCount ?? DEFAULT_BACKUP_RETENTION_KEEP_COUNT),
    );
    const backups = existsSync(backupDir)
      ? readdirSync(backupDir, { withFileTypes: true })
          .filter((entry) => entry.isFile() && DEFAULT_BACKUP_FILE_PATTERN.test(entry.name))
          .map((entry) => {
            const backupPath = path.join(backupDir, entry.name);
            const stat = statSync(backupPath);
            return {
              backupPath,
              sizeBytes: stat.size,
              mtime: stat.mtime,
            };
          })
          .sort((left, right) => {
            const byMtime = right.mtime.getTime() - left.mtime.getTime();
            return byMtime === 0
              ? path.basename(right.backupPath).localeCompare(path.basename(left.backupPath))
              : byMtime;
          })
      : [];

    return {
      backupDir,
      keepCount,
      backups,
      kept: backups.slice(0, keepCount),
      prunable: backups.slice(keepCount),
      plannedAt: new Date(),
    };
  }

  verifyBackup(input: VerifyBackupInput): BackupVerification {
    if (!existsSync(input.backupPath)) {
      throw new Error(`Backup file was not found: ${input.backupPath}`);
    }

    const backupDb = new Database(input.backupPath, { readonly: true, fileMustExist: true });
    try {
      const integrityCheck = runIntegrityCheck(backupDb, "quick_check");
      const missingTables = missingRequiredBackupTables(backupDb);
      const warnings = missingTables.map((table) => `Backup is missing required table: ${table}`);
      const missingTemporalColumns = missingBiTemporalMemoryColumns(backupDb);
      if (missingTemporalColumns.length) {
        warnings.push(formatMissingBiTemporalColumnsWarning(missingTemporalColumns));
      }
      const schemaOk = missingTables.length === 0;
      const memoryCount = tableExists(backupDb, "memories") ? countRows(backupDb, "memories") : 0;
      const eventCount = tableExists(backupDb, "memory_events")
        ? countRows(backupDb, "memory_events")
        : 0;
      return {
        backupPath: input.backupPath,
        ok: integrityCheck === "ok" && schemaOk,
        memoryCount,
        eventCount,
        integrityCheck,
        schemaOk,
        warnings,
        checkedAt: new Date(),
      };
    } finally {
      backupDb.close();
    }
  }

  inspectBackup(input: InspectBackupInput): BackupInspection {
    if (!existsSync(input.backupPath)) {
      throw new Error(`Backup file was not found: ${input.backupPath}`);
    }

    const limit = Math.max(1, Math.min(input.limit ?? 20, 100));
    const backupDb = new Database(input.backupPath, { readonly: true, fileMustExist: true });
    try {
      const integrityCheck = runIntegrityCheck(backupDb, "quick_check");
      const missingTables = missingRequiredBackupTables(backupDb);
      if (missingTables.length) {
        return {
          backupPath: input.backupPath,
          ok: false,
          memoryCount: tableExists(backupDb, "memories") ? countRows(backupDb, "memories") : 0,
          eventCount: tableExists(backupDb, "memory_events")
            ? countRows(backupDb, "memory_events")
            : 0,
          integrityCheck,
          schemaOk: false,
          warnings: missingTables.map((table) => `Backup is missing required table: ${table}`),
          checkedAt: new Date(),
          memories: [],
        };
      }

      const statuses: Memory["status"][] = ["active"];
      if (input.includeSuperseded) {
        statuses.push("superseded");
      }
      if (input.includeForgotten) {
        statuses.push("forgotten");
      }
      const clauses = [`status IN (${statuses.map((_, index) => `@status${index}`).join(", ")})`];
      const params: Record<string, unknown> = { limit };
      statuses.forEach((status, index) => {
        params[`status${index}`] = status;
      });

      if (input.layers?.length) {
        clauses.push(`layer IN (${input.layers.map((_, index) => `@layer${index}`).join(", ")})`);
        input.layers.forEach((layer, index) => {
          params[`layer${index}`] = layer;
        });
      }

      const hasProjectScope = columnExists(backupDb, "memories", "project_scope");
      if (hasProjectScope) {
        addProjectScopeFilter(clauses, params, input);
      }

      const projectScopeSelection = hasProjectScope ? "project_scope" : "'global' AS project_scope";
      const missingTemporalColumns = missingBiTemporalMemoryColumns(backupDb);
      const temporalSelections = {
        validFrom: missingTemporalColumns.includes("valid_from")
          ? "NULL AS valid_from"
          : "valid_from",
        invalidatedAt: missingTemporalColumns.includes("invalidated_at")
          ? "NULL AS invalidated_at"
          : "invalidated_at",
        invalidatedByRef: missingTemporalColumns.includes("invalidated_by_ref")
          ? "NULL AS invalidated_by_ref"
          : "invalidated_by_ref",
        invalidationReason: missingTemporalColumns.includes("invalidation_reason")
          ? "NULL AS invalidation_reason"
          : "invalidation_reason",
      };
      const warnings = missingTemporalColumns.length
        ? [formatMissingBiTemporalColumnsWarning(missingTemporalColumns)]
        : [];
      const rows = backupDb
        .prepare(
          `SELECT id, layer, summary, tags, ${projectScopeSelection}, source_type, source_ref, importance, confidence,
                  created_at, updated_at, ${temporalSelections.validFrom}, ${temporalSelections.invalidatedAt},
                  ${temporalSelections.invalidatedByRef}, ${temporalSelections.invalidationReason},
                  last_accessed_at, expires_at, status
           FROM memories
           WHERE ${clauses.join(" AND ")}
           ORDER BY updated_at DESC, id DESC
           LIMIT @limit`,
        )
        .all(params) as BackupMemorySummaryRow[];

      return {
        backupPath: input.backupPath,
        ok: true,
        memoryCount: countRows(backupDb, "memories"),
        eventCount: countRows(backupDb, "memory_events"),
        integrityCheck,
        schemaOk: true,
        warnings,
        checkedAt: new Date(),
        memories: rows.map(mapBackupMemorySummary),
      };
    } finally {
      backupDb.close();
    }
  }

  async repairMemoryIndex(input: RepairMemoryIndexInput = {}): Promise<MemoryIndexRepair> {
    const before = this.checkDatabaseHealth();
    const shouldCreateBackup = input.createBackup ?? true;
    const backup = shouldCreateBackup
      ? await this.createBackup({ backupPath: input.backupPath })
      : null;
    const backupVerification = backup ? this.verifyBackup({ backupPath: backup.backupPath }) : null;

    if (backupVerification && !backupVerification.ok) {
      return {
        repaired: false,
        backupPath: backup?.backupPath ?? null,
        backupVerification,
        before,
        after: before,
        warnings: ["Backup verification failed; FTS index was not rebuilt."],
        repairedAt: new Date(),
      };
    }

    this.rebuildFtsIndex();
    const after = this.checkDatabaseHealth();

    return {
      repaired: after.ok,
      backupPath: backup?.backupPath ?? null,
      backupVerification,
      before,
      after,
      warnings: after.ok
        ? []
        : ["FTS index rebuild completed, but database health is still not OK.", ...after.warnings],
      repairedAt: new Date(),
    };
  }

  private checkFtsConsistency(): DatabaseHealth["fts"] {
    const expectedCount = countRowsWhere(this.db, "memories", "status != 'forgotten'");
    const primary = this.checkFtsTableConsistency("memories_fts");
    const porter = this.checkFtsTableConsistency("memories_fts_porter");

    return {
      ok:
        primary.missingCount === 0 &&
        primary.orphanCount === 0 &&
        porter.missingCount === 0 &&
        porter.orphanCount === 0,
      expectedCount,
      indexedCount: primary.indexedCount,
      missingCount: primary.missingCount,
      orphanCount: primary.orphanCount,
      porter,
    };
  }

  private checkFtsTableConsistency(table: "memories_fts" | "memories_fts_porter") {
    const indexedCount = countRows(this.db, table);
    const missing = this.db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM memories m
         LEFT JOIN ${table} f ON f.rowid = m.id
         WHERE m.status != 'forgotten' AND f.rowid IS NULL`,
      )
      .get() as { count: number };
    const orphan = this.db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM ${table} f
         LEFT JOIN memories m ON m.id = f.rowid
         WHERE m.id IS NULL OR m.status = 'forgotten'`,
      )
      .get() as { count: number };

    return {
      indexedCount,
      missingCount: missing.count,
      orphanCount: orphan.count,
    };
  }

  private rebuildFtsIndex(): void {
    const rebuild = this.db.transaction(() => {
      this.db.prepare("DELETE FROM memories_fts").run();
      this.db.prepare("DELETE FROM memories_fts_porter").run();
      this.db
        .prepare(
          `INSERT INTO memories_fts(rowid, content, summary, tags)
           SELECT id, content, summary, tags
           FROM memories
           WHERE status != 'forgotten'
           ORDER BY id ASC`,
        )
        .run();
      this.db
        .prepare(
          `INSERT INTO memories_fts_porter(rowid, content, summary, tags)
           SELECT id, content, summary, tags
           FROM memories
           WHERE status != 'forgotten'
           ORDER BY id ASC`,
        )
        .run();
    });

    rebuild();
  }

  private defaultBackupPath(): string {
    const stamp = new Date()
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.(\d{3})Z$/, "-$1")
      .replace("T", "-");
    const backupDir = this.defaultBackupDir();
    const basePath = path.join(backupDir, `memory-${stamp}.sqlite`);
    if (!existsSync(basePath)) {
      return basePath;
    }

    for (let index = 1; index < 1000; index += 1) {
      const candidate = path.join(backupDir, `memory-${stamp}-${index}.sqlite`);
      if (!existsSync(candidate)) {
        return candidate;
      }
    }

    throw new Error("Could not allocate a unique backup path.");
  }

  private defaultBackupDir(): string {
    return path.join(path.dirname(this.databasePath), "backups");
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        layer TEXT NOT NULL CHECK (layer IN ('core', 'recall', 'archival')),
        content TEXT NOT NULL,
        summary TEXT NOT NULL,
        tags TEXT NOT NULL DEFAULT '[]',
        project_scope TEXT NOT NULL DEFAULT 'global',
        source_type TEXT NOT NULL,
        source_ref TEXT NOT NULL,
        importance REAL NOT NULL DEFAULT 0.5,
        confidence REAL NOT NULL DEFAULT 0.5,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      valid_from TEXT,
      invalidated_at TEXT,
      invalidated_by_ref TEXT,
      invalidation_reason TEXT,
      last_accessed_at TEXT,
      expires_at TEXT,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'superseded', 'forgotten'))
      );

      CREATE TABLE IF NOT EXISTS memory_relations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_memory_id INTEGER NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
        target_memory_id INTEGER NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
        relation_type TEXT NOT NULL CHECK (
          relation_type IN ('supersedes', 'duplicates', 'contradicts', 'supports', 'derives_from')
        ),
        note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS memory_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_id INTEGER NOT NULL,
        event_type TEXT NOT NULL CHECK (
          event_type IN ('created', 'updated', 'forgotten', 'consolidated', 'retrieved')
        ),
        payload_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
        content,
        summary,
        tags,
        tokenize = 'trigram'
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts_porter USING fts5(
        content,
        summary,
        tags,
        tokenize = 'porter unicode61'
      );

      CREATE TABLE IF NOT EXISTS directives (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        scope TEXT NOT NULL CHECK (scope IN ('global', 'project')),
        project_scope TEXT NOT NULL DEFAULT 'global',
        content TEXT NOT NULL,
        rationale TEXT NOT NULL DEFAULT '',
        tags TEXT NOT NULL DEFAULT '[]',
        source_type TEXT NOT NULL,
        source_ref TEXT NOT NULL,
        priority REAL NOT NULL DEFAULT 0.75,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'superseded'))
      );

      CREATE TABLE IF NOT EXISTS directive_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        directive_id INTEGER NOT NULL,
        event_type TEXT NOT NULL CHECK (
          event_type IN ('created', 'updated', 'disabled', 'retrieved')
        ),
        payload_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_memories_status_updated
        ON memories(status, updated_at DESC);

      CREATE INDEX IF NOT EXISTS idx_memories_layer_status
        ON memories(layer, status);
    `);
    this.addColumnIfMissing("memories", "embedding", "TEXT");
    this.addColumnIfMissing("memories", "project_scope", "TEXT NOT NULL DEFAULT 'global'");
    this.addColumnIfMissing("memories", "valid_from", "TEXT");
    this.addColumnIfMissing("memories", "invalidated_at", "TEXT");
    this.addColumnIfMissing("memories", "invalidated_by_ref", "TEXT");
    this.addColumnIfMissing("memories", "invalidation_reason", "TEXT");
    this.backfillBiTemporalMetadata();
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_memories_project_scope_status_updated
        ON memories(project_scope, status, updated_at DESC);

      CREATE INDEX IF NOT EXISTS idx_memories_active_embedding_candidates
        ON memories(status, importance DESC, updated_at DESC)
        WHERE embedding IS NOT NULL;

      CREATE INDEX IF NOT EXISTS idx_directives_scope_status_updated
        ON directives(scope, project_scope, status, priority DESC, updated_at DESC);
    `);
    this.ensureTrigramFtsTable();
    this.ensurePorterFtsTable();
  }

  private backfillBiTemporalMetadata(): void {
    this.db
      .prepare(
        "UPDATE memories SET valid_from = created_at WHERE valid_from IS NULL OR valid_from = ''",
      )
      .run();
    this.db
      .prepare(
        `UPDATE memories
         SET invalidated_at = updated_at
         WHERE status != 'active' AND (invalidated_at IS NULL OR invalidated_at = '')`,
      )
      .run();
    this.db
      .prepare(
        `UPDATE memories
         SET invalidated_by_ref = ?
         WHERE status != 'active' AND (invalidated_by_ref IS NULL OR invalidated_by_ref = '')`,
      )
      .run(BI_TEMPORAL_BACKFILL_REF);
    this.db
      .prepare(
        `UPDATE memories
         SET invalidation_reason = ?
         WHERE status != 'active' AND (invalidation_reason IS NULL OR invalidation_reason = '')`,
      )
      .run(BI_TEMPORAL_BACKFILL_REASON);
  }

  private ensureTrigramFtsTable(): void {
    const row = this.db
      .prepare("SELECT sql FROM sqlite_master WHERE name = 'memories_fts'")
      .get() as { sql: string | null } | undefined;
    const sql = row?.sql ?? "";
    if (sql && /tokenize\s*=\s*['"]?trigram/i.test(sql)) {
      return;
    }

    this.db.exec("DROP TABLE IF EXISTS memories_fts");
    this.db.exec(`
      CREATE VIRTUAL TABLE memories_fts USING fts5(
        content,
        summary,
        tags,
        tokenize = 'trigram'
      );
    `);
    this.rebuildFtsIndex();
  }

  private ensurePorterFtsTable(): void {
    const row = this.db
      .prepare("SELECT sql FROM sqlite_master WHERE name = 'memories_fts_porter'")
      .get() as { sql: string | null } | undefined;
    const sql = row?.sql ?? "";
    if (sql && /tokenize\s*=\s*['"]?porter unicode61/i.test(sql)) {
      return;
    }

    this.db.exec("DROP TABLE IF EXISTS memories_fts_porter");
    this.db.exec(`
      CREATE VIRTUAL TABLE memories_fts_porter USING fts5(
        content,
        summary,
        tags,
        tokenize = 'porter unicode61'
      );
    `);
    this.rebuildFtsIndex();
  }

  private searchMemoryWithEmbedding(input: SearchMemoryInput): SearchMemoryResult[] {
    const limit = Math.max(1, Math.min(input.limit ?? 8, 50));
    const candidateLimit = Math.max(
      1,
      Math.min(
        input.hybridCandidateLimit ?? DEFAULT_HYBRID_CANDIDATE_LIMIT,
        MAX_HYBRID_CANDIDATE_LIMIT,
      ),
    );
    const vectorClauses = [
      input.includeSuperseded ? "status != 'forgotten'" : "status = 'active'",
      "embedding IS NOT NULL",
    ];
    const vectorParams: Record<string, unknown> = { candidateLimit };

    if (input.layers?.length) {
      vectorClauses.push(
        `layer IN (${input.layers.map((_, index) => `@layer${index}`).join(", ")})`,
      );
      input.layers.forEach((layer, index) => {
        vectorParams[`layer${index}`] = layer;
      });
    }

    if (input.tags?.length) {
      input.tags.forEach((tag, index) => {
        vectorClauses.push(`tags LIKE @tag${index} ESCAPE '\\'`);
        vectorParams[`tag${index}`] = `%${escapeLikePattern(JSON.stringify(tag))}%`;
      });
    }

    addProjectScopeFilter(vectorClauses, vectorParams, input);

    const vectorRows = this.db
      .prepare(
        `SELECT * FROM memories
         WHERE ${vectorClauses.join(" AND ")}
         ORDER BY importance DESC, updated_at DESC, id DESC
         LIMIT @candidateLimit`,
      )
      .all(vectorParams) as MemoryRow[];

    const keywordRows = this.hybridKeywordCandidateRows(input, candidateLimit);
    const rowsById = new Map<number, MemoryRow>();
    for (const row of [...vectorRows, ...keywordRows]) {
      rowsById.set(row.id, row);
    }

    const results = [...rowsById.values()]
      .map((row) => scoreHybridRow(row, input.query, input.queryEmbedding ?? []))
      .filter((result) => result.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, limit);

    this.recordSearchRetrieval(input, results, { hybrid: true });

    return results;
  }

  private hybridKeywordCandidateRows(
    input: SearchMemoryInput,
    candidateLimit: number,
  ): MemoryRow[] {
    return this.keywordCandidateRows(input, candidateLimit);
  }

  private likeFallbackRows(
    input: SearchMemoryInput,
    limit: number,
    excludedIds: Set<number>,
  ): MemoryRow[] {
    if (limit <= 0) {
      return [];
    }

    const clauses: string[] = [];
    const params: Record<string, unknown> = { limit };
    addMemorySearchFilters(clauses, params, input);

    if (excludedIds.size) {
      clauses.push(
        `id NOT IN (${[...excludedIds].map((_, index) => `@excluded${index}`).join(", ")})`,
      );
      [...excludedIds].forEach((id, index) => {
        params[`excluded${index}`] = id;
      });
    }

    const likeClauses: string[] = [];
    queryLikeTerms(input.query).forEach((term, index) => {
      const paramName = `like${index}`;
      params[paramName] = `%${escapeLikePattern(term)}%`;
      likeClauses.push(
        `(content LIKE @${paramName} ESCAPE '\\' OR summary LIKE @${paramName} ESCAPE '\\' OR tags LIKE @${paramName} ESCAPE '\\')`,
      );
    });
    if (!likeClauses.length) {
      return [];
    }
    clauses.push(`(${likeClauses.join(" OR ")})`);

    return this.db
      .prepare(
        `SELECT *
         FROM memories
         WHERE ${clauses.join(" AND ")}
         ORDER BY importance DESC, updated_at DESC, id DESC
         LIMIT @limit`,
      )
      .all(params) as MemoryRow[];
  }

  private recordSearchRetrieval(
    input: SearchMemoryInput,
    results: SearchMemoryResult[],
    payload: Record<string, unknown> = {},
  ): void {
    const now = new Date().toISOString();
    const markRetrieved = this.db.prepare("UPDATE memories SET last_accessed_at = ? WHERE id = ?");
    for (const result of results) {
      markRetrieved.run(now, result.memory.id);
    }

    if (!results.length) {
      return;
    }

    const projectScope = resolveProjectScope(input);
    const scopeFilterApplied = !input.includeCrossProject && projectScope !== GLOBAL_PROJECT_SCOPE;
    this.recordEvent(results[0].memory.id, "retrieved", {
      query: input.query,
      ...(projectScope === GLOBAL_PROJECT_SCOPE ? {} : { projectScope }),
      includeCrossProject: input.includeCrossProject ?? false,
      scopeFilterApplied,
      ...payload,
      resultCount: results.length,
      memoryIds: results.map((result) => result.memory.id),
      resultProjectScopes: uniqueProjectScopes(results),
    });
  }

  private addColumnIfMissing(table: string, column: string, definition: string): void {
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!columns.some((item) => item.name === column)) {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }

  private requireMemory(memoryId: number): Memory {
    const memory = this.getMemory(memoryId);
    if (!memory) {
      throw new Error(`Memory ${memoryId} was not found.`);
    }
    return memory;
  }

  private requireDirective(directiveId: number): Directive {
    const row = this.db.prepare("SELECT * FROM directives WHERE id = ?").get(directiveId) as
      | DirectiveRow
      | undefined;
    if (!row) {
      throw new Error(`Directive ${directiveId} was not found.`);
    }
    return mapDirective(row);
  }

  private assertStorable(content: string, allowSecret = false): void {
    if (!content.trim()) {
      throw new Error("Memory content cannot be empty.");
    }
    if (!allowSecret && containsLikelySecret(content)) {
      throw new Error("Refusing to store likely secret content without explicit override.");
    }
  }

  private indexMemory(memory: Memory): void {
    this.deleteFtsRow(memory.id);
    this.db
      .prepare("INSERT INTO memories_fts(rowid, content, summary, tags) VALUES (?, ?, ?, ?)")
      .run(memory.id, memory.content, memory.summary, memory.tags.join(" "));
    this.db
      .prepare("INSERT INTO memories_fts_porter(rowid, content, summary, tags) VALUES (?, ?, ?, ?)")
      .run(memory.id, memory.content, memory.summary, memory.tags.join(" "));
  }

  private deleteFtsRow(memoryId: number): void {
    this.db.prepare("DELETE FROM memories_fts WHERE rowid = ?").run(memoryId);
    this.db.prepare("DELETE FROM memories_fts_porter WHERE rowid = ?").run(memoryId);
  }

  private recordEvent(
    memoryId: number,
    eventType: MemoryEventType,
    payload: Record<string, unknown>,
  ): void {
    this.db
      .prepare(
        `INSERT INTO memory_events (memory_id, event_type, payload_json, created_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(
        memoryId,
        eventType,
        JSON.stringify(redactEventPayload(payload)),
        new Date().toISOString(),
      );
  }

  private recordDirectiveEvent(
    directiveId: number,
    eventType: DirectiveEventType,
    payload: Record<string, unknown>,
  ): void {
    this.db
      .prepare(
        `INSERT INTO directive_events (directive_id, event_type, payload_json, created_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(
        directiveId,
        eventType,
        JSON.stringify(redactEventPayload(payload)),
        new Date().toISOString(),
      );
  }
}

function mapMemory(row: MemoryRow): Memory {
  return {
    id: row.id,
    layer: row.layer,
    content: row.content,
    summary: row.summary,
    tags: safeParseTags(row.tags),
    projectScope: row.project_scope ?? GLOBAL_PROJECT_SCOPE,
    sourceType: row.source_type,
    sourceRef: row.source_ref,
    importance: row.importance,
    confidence: row.confidence,
    embedding: row.embedding ? parseEmbedding(row.embedding) : null,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    validFrom: new Date(row.valid_from ?? row.created_at),
    invalidatedAt: row.invalidated_at ? new Date(row.invalidated_at) : null,
    invalidatedByRef: row.invalidated_by_ref ?? null,
    invalidationReason: row.invalidation_reason ?? null,
    lastAccessedAt: row.last_accessed_at ? new Date(row.last_accessed_at) : null,
    expiresAt: row.expires_at ? new Date(row.expires_at) : null,
    status: row.status,
  };
}

function mapEvent(row: EventRow): MemoryEvent {
  return {
    id: row.id,
    memoryId: row.memory_id,
    eventType: row.event_type,
    payload: JSON.parse(row.payload_json) as Record<string, unknown>,
    createdAt: new Date(row.created_at),
  };
}

function mapDirective(row: DirectiveRow): Directive {
  return {
    id: row.id,
    scope: row.scope,
    projectScope: row.project_scope ?? GLOBAL_PROJECT_SCOPE,
    content: row.content,
    rationale: row.rationale,
    tags: safeParseTags(row.tags),
    sourceType: row.source_type,
    sourceRef: row.source_ref,
    priority: row.priority,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    status: row.status,
  };
}

function mapBackupMemorySummary(row: BackupMemorySummaryRow): BackupMemorySummary {
  return {
    id: row.id,
    layer: row.layer,
    summary: row.summary,
    tags: safeParseTags(row.tags),
    projectScope: row.project_scope ?? GLOBAL_PROJECT_SCOPE,
    sourceType: row.source_type,
    sourceRef: row.source_ref,
    importance: row.importance,
    confidence: row.confidence,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    validFrom: row.valid_from ? new Date(row.valid_from) : null,
    invalidatedAt: row.invalidated_at ? new Date(row.invalidated_at) : null,
    invalidatedByRef: row.invalidated_by_ref ?? null,
    invalidationReason: row.invalidation_reason ?? null,
    lastAccessedAt: row.last_accessed_at ? new Date(row.last_accessed_at) : null,
    expiresAt: row.expires_at ? new Date(row.expires_at) : null,
    status: row.status,
  };
}

function safeParseTags(tags: string): string[] {
  const parsed = JSON.parse(tags) as unknown;
  return Array.isArray(parsed)
    ? parsed.filter((tag): tag is string => typeof tag === "string")
    : [];
}

function summarize(content: string): string {
  const compact = content.trim().replace(/\s+/g, " ");
  return compact.length <= 180 ? compact : `${compact.slice(0, 177)}...`;
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function countRows(db: Database.Database, table: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number };
  return row.count;
}

function countRowsWhere(db: Database.Database, table: string, where: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${where}`).get() as {
    count: number;
  };
  return row.count;
}

function tableExists(db: Database.Database, table: string): boolean {
  const row = db
    .prepare(
      "SELECT 1 AS found FROM sqlite_master WHERE type IN ('table', 'virtual table') AND name = ?",
    )
    .get(table) as { found: number } | undefined;
  return row?.found === 1;
}

function missingRequiredBackupTables(db: Database.Database): string[] {
  return REQUIRED_BACKUP_TABLES.filter((table) => !tableExists(db, table));
}

function columnExists(db: Database.Database, table: string, column: string): boolean {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return columns.some((item) => item.name === column);
}

function missingBiTemporalMemoryColumns(db: Database.Database): string[] {
  if (!tableExists(db, "memories")) {
    return [];
  }
  return BI_TEMPORAL_MEMORY_COLUMNS.filter((column) => !columnExists(db, "memories", column));
}

function formatMissingBiTemporalColumnsWarning(columns: string[]): string {
  return `Backup is missing optional bi-temporal memories columns: ${columns.join(", ")}`;
}

function runIntegrityCheck(
  db: Database.Database,
  pragma: "quick_check" | "integrity_check",
): string {
  const rows = db.prepare(`PRAGMA ${pragma}`).all() as Record<string, string>[];
  const values = rows.flatMap((row) => Object.values(row));
  return values.length === 1 && values[0] === "ok" ? "ok" : values.join("; ");
}

function checkpointWal(db: Database.Database): DatabaseHealth["walCheckpoint"] {
  const row = db.prepare("PRAGMA wal_checkpoint(PASSIVE)").get() as {
    busy: number;
    log: number;
    checkpointed: number;
  };
  return {
    busy: row.busy,
    log: row.log,
    checkpointed: row.checkpointed,
  };
}

function skippedFtsHealth(): DatabaseHealth["fts"] {
  return {
    ok: true,
    expectedCount: 0,
    indexedCount: 0,
    missingCount: 0,
    orphanCount: 0,
    porter: {
      indexedCount: 0,
      missingCount: 0,
      orphanCount: 0,
    },
  };
}

function quoteFtsQuery(query: string): string {
  const terms = query
    .trim()
    .split(/\s+/)
    .map((term) => term.replace(/"/g, ""))
    .filter(Boolean);
  return terms.length ? terms.map((term) => `"${term}"`).join(" OR ") : '""';
}

function queryLikeTerms(query: string): string[] {
  const compactQuery = query.trim();
  const terms = compactQuery.split(/\s+/).filter(Boolean);
  return [...new Set([compactQuery, ...terms].filter(Boolean))];
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

function stripKeywordRank(row: MemoryRow & { keyword_rank: number }): MemoryRow {
  const { keyword_rank: _keywordRank, ...memoryRow } = row;
  return memoryRow;
}

function addMemorySearchFilters(
  clauses: string[],
  params: Record<string, unknown>,
  input: SearchMemoryInput,
  alias = "",
): void {
  if (!input.includeSuperseded) {
    clauses.push(`${alias}status = 'active'`);
  } else {
    clauses.push(`${alias}status != 'forgotten'`);
  }

  if (input.layers?.length) {
    clauses.push(
      `${alias}layer IN (${input.layers.map((_, index) => `@layer${index}`).join(", ")})`,
    );
    input.layers.forEach((layer, index) => {
      params[`layer${index}`] = layer;
    });
  }

  if (input.tags?.length) {
    input.tags.forEach((tag, index) => {
      clauses.push(`${alias}tags LIKE @tag${index} ESCAPE '\\'`);
      params[`tag${index}`] = `%${escapeLikePattern(JSON.stringify(tag))}%`;
    });
  }

  addProjectScopeFilter(clauses, params, input, alias);
}

function addProjectScopeFilter(
  clauses: string[],
  params: Record<string, unknown>,
  input: Pick<SearchMemoryInput, "projectScope" | "projectPath" | "includeCrossProject">,
  alias = "",
): void {
  if (input.includeCrossProject) {
    return;
  }

  const projectScope = resolveProjectScope(input);
  if (projectScope === GLOBAL_PROJECT_SCOPE) {
    return;
  }

  clauses.push(
    `(${alias}project_scope = @projectScope OR ${alias}project_scope = @globalProjectScope)`,
  );
  params.projectScope = projectScope;
  params.globalProjectScope = GLOBAL_PROJECT_SCOPE;
}

function resolveProjectScope(input: { projectScope?: string; projectPath?: string }): string {
  const explicitScope = normalizeProjectScope(input.projectScope);
  if (explicitScope) {
    return explicitScope;
  }

  const projectPath = input.projectPath?.trim();
  if (!projectPath) {
    return GLOBAL_PROJECT_SCOPE;
  }

  const normalizedPath = path.resolve(projectPath).toLowerCase();
  const digest = createHash("sha256").update(normalizedPath).digest("hex").slice(0, 16);
  return `project:${digest}`;
}

function normalizeProjectScope(value: string | undefined): string | null {
  const normalized = value?.trim().replace(/\s+/g, "-").toLowerCase();
  return normalized || null;
}

function uniqueProjectScopes(results: SearchMemoryResult[]): string[] {
  return [...new Set(results.map((result) => result.memory.projectScope))].sort();
}

function scoreKeywordRow(row: MemoryRow & { keyword_rank: number }): SearchMemoryResult {
  const keywordScore = 1 / (1 + Math.abs(row.keyword_rank));
  const freshnessScore = freshness(row.updated_at);
  return {
    memory: mapMemory(row),
    score: weightedScore({
      vector: 0,
      keyword: keywordScore,
      importance: row.importance,
      freshness: freshnessScore,
    }),
    scoreBreakdown: {
      vector: 0,
      keyword: Number(keywordScore.toFixed(4)),
      importance: row.importance,
      freshness: Number(freshnessScore.toFixed(4)),
    },
  };
}

function scoreHybridRow(
  row: MemoryRow,
  query: string,
  queryEmbedding: number[],
): SearchMemoryResult {
  const memory = mapMemory(row);
  const vectorScore = memory.embedding
    ? Math.max(0, cosineSimilarity(queryEmbedding, memory.embedding))
    : 0;
  const keywordScore = lexicalScore(
    query,
    [memory.content, memory.summary, memory.tags.join(" ")].join(" "),
  );
  const freshnessScore = freshness(row.updated_at);

  const scoreBreakdown = {
    vector: Number(vectorScore.toFixed(4)),
    keyword: Number(keywordScore.toFixed(4)),
    importance: row.importance,
    freshness: Number(freshnessScore.toFixed(4)),
  };

  return {
    memory,
    score: weightedScore(scoreBreakdown),
    scoreBreakdown,
  };
}

function weightedScore(parts: SearchMemoryResult["scoreBreakdown"]): number {
  return Number(
    (
      parts.vector * 0.45 +
      parts.keyword * 0.3 +
      parts.importance * 0.15 +
      parts.freshness * 0.1
    ).toFixed(4),
  );
}

function freshness(updatedAt: string): number {
  const ageMs = Date.now() - new Date(updatedAt).getTime();
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
  return Math.max(0, 1 - ageMs / thirtyDaysMs);
}

function redactedInput(input: CreateMemoryInput): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    layer: input.layer,
    tags: input.tags ?? [],
    projectScope: resolveProjectScope(input),
    sourceType: input.sourceType,
    sourceRef: input.sourceRef,
    importance: input.importance,
    confidence: input.confidence,
  };
  if (input.autoCuration) {
    payload.autoCuration = input.autoCuration;
  }
  return payload;
}

function parseEmbedding(value: string): number[] | null {
  const parsed = JSON.parse(value) as unknown;
  return Array.isArray(parsed) && parsed.every((item) => typeof item === "number") ? parsed : null;
}

function lexicalScore(query: string, text: string): number {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean);
  if (!terms.length) {
    return 0;
  }

  const normalized = text.toLowerCase();
  const matches = terms.filter((term) => normalized.includes(term)).length;
  return matches / terms.length;
}

function redactEventPayload(value: unknown): unknown {
  if (typeof value === "string") {
    if (containsLikelySecret(value)) {
      return "[REDACTED_SECRET]";
    }

    const parsed = parseJsonObjectOrArray(value);
    return truncateAuditString(parsed ? JSON.stringify(redactEventPayload(parsed)) : value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactEventPayload(item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        isLikelySecretKey(key) ? "[REDACTED_SECRET]" : redactEventPayload(item),
      ]),
    );
  }

  return value;
}

function truncateAuditString(value: string): string {
  if (value.length <= MAX_AUDIT_STRING_LENGTH) {
    return value;
  }

  return `${value.slice(0, MAX_AUDIT_STRING_LENGTH)}...[TRUNCATED ${value.length - MAX_AUDIT_STRING_LENGTH} chars]`;
}

function parseJsonObjectOrArray(value: string): unknown[] | Record<string, unknown> | null {
  const trimmed = value.trim();
  if (!trimmed || !["{", "["].includes(trimmed[0] ?? "")) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return parsed && typeof parsed === "object"
      ? (parsed as unknown[] | Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
