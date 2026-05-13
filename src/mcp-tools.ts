import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { EmbeddingProvider } from "./embedding.js";
import { MemoryStore } from "./memory-store.js";
import type { Memory, MemoryLayer, SearchMemoryResult } from "./types.js";

const layerSchema = z.enum(["core", "recall", "archival"]);

const writeMemorySchema = {
  content: z.string().min(1),
  layer: layerSchema,
  tags: z.array(z.string()).default([]),
  sourceType: z.string().min(1),
  sourceRef: z.string().min(1),
  projectScope: z.string().min(1).optional(),
  projectPath: z.string().min(1).optional(),
  importance: z.number().min(0).max(1).default(0.5),
  confidence: z.number().min(0).max(1).default(0.5),
  allowSecret: z.boolean().default(false)
};

const proposeMemoryUpdateSchema = {
  content: z.string().min(1),
  taskContext: z.string().min(1).optional(),
  projectScope: z.string().min(1).optional(),
  projectPath: z.string().min(1).optional(),
  sourceType: z.string().min(1),
  sourceRef: z.string().min(1),
  allowSecret: z.boolean().default(false)
};

const healthCheckSchema = {};

const memoryStatsSchema = {};

const readMemorySchema = {
  memoryId: z.number().int().positive(),
  includeForgotten: z.boolean().default(false),
  includeEmbedding: z.boolean().default(false)
};

const listMemorySummariesSchema = {
  layers: z.array(layerSchema).optional(),
  includeSuperseded: z.boolean().default(false),
  includeForgotten: z.boolean().default(false),
  since: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(20),
  projectScope: z.string().min(1).optional(),
  projectPath: z.string().min(1).optional(),
  includeCrossProject: z.boolean().default(false)
};

const searchMemorySchema = {
  query: z.string().min(1),
  layers: z.array(layerSchema).optional(),
  tags: z.array(z.string()).optional(),
  limit: z.number().int().min(1).max(50).default(8),
  includeSuperseded: z.boolean().default(false),
  includeEmbedding: z.boolean().default(false),
  projectScope: z.string().min(1).optional(),
  projectPath: z.string().min(1).optional(),
  includeCrossProject: z.boolean().default(false)
};

const updateMemorySchema = {
  memoryId: z.number().int().positive(),
  newContent: z.string().min(1),
  updateNote: z.string().min(1),
  tags: z.array(z.string()).optional(),
  allowSecret: z.boolean().default(false)
};

const forgetMemorySchema = {
  memoryId: z.number().int().positive(),
  reason: z.string().min(1),
  hardDelete: z.boolean().default(false),
  confirmHardDelete: z.boolean().default(false)
};

const consolidateMemorySchema = {
  layers: z.array(layerSchema).optional(),
  since: z.string().optional(),
  dryRun: z.boolean().default(true),
  maxCandidates: z.number().int().min(1).max(100).default(20),
  projectScope: z.string().min(1).optional(),
  projectPath: z.string().min(1).optional(),
  includeCrossProject: z.boolean().default(false)
};

const memoryDigestSchema = {
  taskDescription: z.string().min(1),
  projectScope: z.string().min(1).optional(),
  projectPath: z.string().optional(),
  includeCrossProject: z.boolean().default(false),
  maxTokens: z.number().int().min(50).max(4000).default(800)
};

const startMemorySessionSchema = {
  taskDescription: z.string().min(1),
  projectScope: z.string().min(1).optional(),
  projectPath: z.string().optional(),
  includeCrossProject: z.boolean().default(false),
  maxTokens: z.number().int().min(50).max(4000).default(800)
};

const backupMemorySchema = {
  backupPath: z.string().min(1).optional()
};

const verifyBackupSchema = {
  backupPath: z.string().min(1)
};

const inspectBackupSchema = {
  backupPath: z.string().min(1),
  layers: z.array(layerSchema).optional(),
  includeSuperseded: z.boolean().default(false),
  includeForgotten: z.boolean().default(false),
  limit: z.number().int().min(1).max(100).default(20),
  projectScope: z.string().min(1).optional(),
  projectPath: z.string().min(1).optional(),
  includeCrossProject: z.boolean().default(false)
};

const repairMemoryIndexSchema = {
  backupPath: z.string().min(1).optional(),
  createBackup: z.boolean().default(true)
};

const auditMemorySchema = {
  memoryId: z.number().int().positive().optional(),
  limit: z.number().int().min(1).max(100).default(20)
};

type ToolResult<T extends Record<string, unknown>> = {
  content: [{ type: "text"; text: string }];
  structuredContent: T;
};

interface WriteMemoryToolInput {
  content: string;
  layer: MemoryLayer;
  tags?: string[];
  sourceType: string;
  sourceRef: string;
  projectScope?: string;
  projectPath?: string;
  importance?: number;
  confidence?: number;
  allowSecret?: boolean;
}

interface ProposeMemoryUpdateToolInput {
  content: string;
  taskContext?: string;
  projectScope?: string;
  projectPath?: string;
  sourceType: string;
  sourceRef: string;
  allowSecret?: boolean;
}

type HealthCheckToolInput = Record<string, never>;
type MemoryStatsToolInput = Record<string, never>;

interface ReadMemoryToolInput {
  memoryId: number;
  includeForgotten?: boolean;
  includeEmbedding?: boolean;
}

interface ListMemorySummariesToolInput {
  layers?: MemoryLayer[];
  includeSuperseded?: boolean;
  includeForgotten?: boolean;
  since?: string;
  limit?: number;
  projectScope?: string;
  projectPath?: string;
  includeCrossProject?: boolean;
}

interface SearchMemoryToolInput {
  query: string;
  layers?: MemoryLayer[];
  tags?: string[];
  limit?: number;
  includeSuperseded?: boolean;
  includeEmbedding?: boolean;
  projectScope?: string;
  projectPath?: string;
  includeCrossProject?: boolean;
}

interface UpdateMemoryToolInput {
  memoryId: number;
  newContent: string;
  updateNote: string;
  tags?: string[];
  allowSecret?: boolean;
}

interface ForgetMemoryToolInput {
  memoryId: number;
  reason: string;
  hardDelete?: boolean;
  confirmHardDelete?: boolean;
}

interface ConsolidateMemoryToolInput {
  layers?: MemoryLayer[];
  since?: string;
  dryRun?: boolean;
  maxCandidates?: number;
  projectScope?: string;
  projectPath?: string;
  includeCrossProject?: boolean;
}

interface MemoryDigestToolInput {
  taskDescription: string;
  projectScope?: string;
  projectPath?: string;
  includeCrossProject?: boolean;
  maxTokens?: number;
}

interface StartMemorySessionToolInput {
  taskDescription: string;
  projectScope?: string;
  projectPath?: string;
  includeCrossProject?: boolean;
  maxTokens?: number;
}

interface BackupMemoryToolInput {
  backupPath?: string;
}

interface VerifyBackupToolInput {
  backupPath: string;
}

interface InspectBackupToolInput {
  backupPath: string;
  layers?: MemoryLayer[];
  includeSuperseded?: boolean;
  includeForgotten?: boolean;
  limit?: number;
  projectScope?: string;
  projectPath?: string;
  includeCrossProject?: boolean;
}

interface RepairMemoryIndexToolInput {
  backupPath?: string;
  createBackup?: boolean;
}

interface AuditMemoryToolInput {
  memoryId?: number;
  limit?: number;
}

interface ToolHandlerOptions {
  embeddingProvider?: EmbeddingProvider;
}

export function createToolHandlers(store: MemoryStore, options: ToolHandlerOptions = {}) {
  return {
    async writeMemory(input: WriteMemoryToolInput) {
      const embedding = await tryEmbed(options.embeddingProvider, input.content);
      const memory = store.createMemory({
        content: input.content,
        layer: input.layer,
        tags: input.tags,
        projectScope: input.projectScope,
        projectPath: input.projectPath,
        sourceType: input.sourceType,
        sourceRef: input.sourceRef,
        importance: input.importance,
        confidence: input.confidence,
        allowSecret: input.allowSecret ?? false,
        embedding: embedding.value
      });
      const duplicateCandidates = findDuplicateCandidatesForMemory(
        memory,
        store.listMemories({
          limit: 500,
          projectScope: input.projectScope,
          projectPath: input.projectPath,
          includeCrossProject: false
        })
      );

      return toolResult({
        memory: serializeMemory(memory),
        duplicateCandidates,
        warnings: embedding.warning ? [embedding.warning] : []
      });
    },

    async proposeMemoryUpdate(input: ProposeMemoryUpdateToolInput) {
      const proposal = buildMemoryProposal(input);
      const duplicateCandidates = findDuplicateCandidatesForContent(
        input.content,
        store.listMemories({
          limit: 500,
          projectScope: input.projectScope,
          projectPath: input.projectPath,
          includeCrossProject: false
        })
      );
      const reasons = [...proposal.reasons];
      let recommendation: "create" | "update" | "skip" = duplicateCandidates.length ? "update" : "create";

      if (!input.allowSecret && looksLikeSecret(input.content)) {
        recommendation = "skip";
        reasons.push("Content looks like a secret; do not store without an explicit override.");
      }
      if (isEphemeralMemory(input.content, input.taskContext)) {
        recommendation = "skip";
        reasons.push("Content looks temporary and is unlikely to help future work.");
      }

      return toolResult({
        recommendation,
        wouldWrite: false,
        proposed: {
          content: input.content,
          layer: proposal.layer,
          tags: proposal.tags,
          sourceType: input.sourceType,
          sourceRef: input.sourceRef,
          projectScope: input.projectScope ?? null,
          projectPath: input.projectPath ?? null,
          importance: proposal.importance,
          confidence: proposal.confidence
        },
        duplicateCandidates,
        reasons,
        nextAction:
          recommendation === "create"
            ? "Call write_memory with the proposed fields if the user approves."
            : recommendation === "update"
              ? "Consider update_memory for the best matching existing memory instead of creating a duplicate."
              : "Do not write this memory unless the user explicitly overrides the recommendation.",
        warnings: [] as string[]
      });
    },

    async healthCheck(_input: HealthCheckToolInput) {
      const embedding = options.embeddingProvider
        ? await tryEmbed(options.embeddingProvider, "codex memory sidecar health check")
        : {
            value: null,
            warning: "Embedding provider is not configured."
          };
      const counts = store.countRecords();
      const health = store.checkDatabaseHealth();
      const database = {
        ok: health.ok,
        memoryCount: counts.memoryCount,
        eventCount: counts.eventCount,
        integrityCheck: health.integrityCheck,
        fts: health.fts,
        walCheckpoint: health.walCheckpoint
      };
      const warnings = [...health.warnings, ...(embedding.warning ? [embedding.warning] : [])];

      return toolResult({
        ok: database.ok && warnings.length === 0,
        database,
        embedding: {
          ok: embedding.warning === null,
          dimensions: embedding.value?.length ?? 0,
          error: embedding.warning ? embedding.warning.replace(/^Embedding unavailable: /, "") : null
        },
        warnings
      });
    },

    async memoryStats(_input: MemoryStatsToolInput) {
      const stats = store.getStats();

      return toolResult({
        memoryCount: stats.memoryCount,
        eventCount: stats.eventCount,
        byStatus: stats.byStatus,
        byLayer: stats.byLayer,
        byProjectScope: stats.byProjectScope.map((scope) => ({
          projectScope: scope.projectScope,
          total: scope.total,
          active: scope.active,
          latestUpdatedAt: scope.latestUpdatedAt?.toISOString() ?? null
        })),
        updatedAtRange: {
          oldest: stats.updatedAtRange.oldest?.toISOString() ?? null,
          newest: stats.updatedAtRange.newest?.toISOString() ?? null
        }
      });
    },

    async readMemory(input: ReadMemoryToolInput) {
      const memory = store.getMemory(input.memoryId);
      if (!memory) {
        throw new Error(`Memory ${input.memoryId} was not found.`);
      }
      if (memory.status === "forgotten" && !input.includeForgotten) {
        throw new Error(`Memory ${input.memoryId} is forgotten. Set includeForgotten=true to read it explicitly.`);
      }

      return toolResult({
        memory: serializeMemory(memory, { includeEmbedding: input.includeEmbedding ?? false })
      });
    },

    async listMemorySummaries(input: ListMemorySummariesToolInput) {
      const memories = store.listMemories({
        layers: input.layers,
        includeSuperseded: input.includeSuperseded ?? false,
        includeForgotten: input.includeForgotten ?? false,
        since: input.since,
        limit: input.limit ?? 20,
        projectScope: input.projectScope,
        projectPath: input.projectPath,
        includeCrossProject: input.includeCrossProject ?? false
      });

      return toolResult({
        memories: memories.map(serializeMemorySummary)
      });
    },

    async searchMemory(input: SearchMemoryToolInput) {
      const embedding = await tryEmbed(options.embeddingProvider, input.query);
      const results = store.searchMemory({
        query: input.query,
        queryEmbedding: embedding.value,
        layers: input.layers,
        tags: input.tags,
        limit: input.limit,
        includeSuperseded: input.includeSuperseded ?? false,
        projectScope: input.projectScope,
        projectPath: input.projectPath,
        includeCrossProject: input.includeCrossProject ?? false
      });

      return toolResult({
        memories: results.map((result) => serializeSearchResult(result, { includeEmbedding: input.includeEmbedding ?? false })),
        warnings: embedding.warning ? [embedding.warning] : []
      });
    },

    async updateMemory(input: UpdateMemoryToolInput) {
      const embedding = await tryEmbed(options.embeddingProvider, input.newContent);
      const memory = store.updateMemory({
        memoryId: input.memoryId,
        newContent: input.newContent,
        updateNote: input.updateNote,
        tags: input.tags,
        embedding: embedding.value,
        allowSecret: input.allowSecret ?? false
      });

      return toolResult({
        memory: serializeMemory(memory),
        event: "updated",
        warnings: embedding.warning ? [embedding.warning] : []
      });
    },

    async forgetMemory(input: ForgetMemoryToolInput) {
      const memory = store.forgetMemory({
        memoryId: input.memoryId,
        reason: input.reason,
        hardDelete: input.hardDelete ?? false,
        confirmHardDelete: input.confirmHardDelete ?? false
      });

      return toolResult({
        memory: serializeMemory(memory),
        event: "forgotten"
      });
    },

    async consolidateMemory(input: ConsolidateMemoryToolInput) {
      const memories = store.listMemories({
        layers: input.layers,
        since: input.since,
        limit: input.maxCandidates ?? 20,
        projectScope: input.projectScope,
        projectPath: input.projectPath,
        includeCrossProject: input.includeCrossProject ?? false
      });
      const proposedMerges = findDuplicateMergeProposals(memories);

      return toolResult({
        dryRun: input.dryRun ?? true,
        layers: input.layers ?? ["core", "recall", "archival"],
        since: input.since ?? null,
        maxCandidates: input.maxCandidates ?? 20,
        proposedMerges,
        proposedSummaries: [] as unknown[],
        proposedForgottenRecords: [] as unknown[],
        contradictionWarnings: [] as unknown[],
        warnings: input.dryRun === false ? ["Automatic consolidation is not implemented; no changes were applied."] : []
      });
    },

    async memoryDigest(input: MemoryDigestToolInput) {
      const query = input.taskDescription;
      const embedding = await tryEmbed(options.embeddingProvider, query);
      const results = store.searchMemory({
        query,
        queryEmbedding: embedding.value,
        limit: 8,
        projectScope: input.projectScope,
        projectPath: input.projectPath,
        includeCrossProject: input.includeCrossProject ?? false
      });
      const serialized = results.map((result) => serializeSearchResult(result));
      const digest = compactDigest(serialized, input.maxTokens ?? 800);

      return toolResult({
        digest,
        memories: serialized,
        warnings: embedding.warning ? [embedding.warning] : []
      });
    },

    async startMemorySession(input: StartMemorySessionToolInput) {
      const databaseHealth = store.checkDatabaseHealth();
      const stats = store.getStats();
      const embedding = await tryEmbed(options.embeddingProvider, input.taskDescription);
      const database = {
        ok: databaseHealth.ok,
        integrityCheck: databaseHealth.integrityCheck,
        fts: databaseHealth.fts,
        walCheckpoint: databaseHealth.walCheckpoint
      };
      const embeddingStatus = {
        ok: embedding.warning === null,
        dimensions: embedding.value?.length ?? 0,
        error: embedding.warning ? embedding.warning.replace(/^Embedding unavailable: /, "") : null
      };
      const repairRecommended =
        !databaseHealth.ok && (databaseHealth.integrityCheck !== "ok" || !databaseHealth.fts.ok);
      const warnings = [...databaseHealth.warnings, ...(embedding.warning ? [embedding.warning] : [])];

      if (!databaseHealth.ok) {
        return toolResult({
          ready: false,
          taskDescription: input.taskDescription,
          health: {
            database,
            embedding: embeddingStatus
          },
          memoryStats: serializeMemoryStats(stats),
          repairRecommended,
          digest: "",
          memories: [] as unknown[],
          warnings,
          startedAt: new Date().toISOString()
        });
      }

      const results = store.searchMemory({
        query: input.taskDescription,
        queryEmbedding: embedding.value,
        limit: 8,
        projectScope: input.projectScope,
        projectPath: input.projectPath,
        includeCrossProject: input.includeCrossProject ?? false
      });
      const serialized = results.map((result) => serializeSearchResult(result));

      return toolResult({
        ready: true,
        taskDescription: input.taskDescription,
        health: {
          database,
          embedding: embeddingStatus
        },
        memoryStats: serializeMemoryStats(stats),
        repairRecommended,
        digest: compactDigest(serialized, input.maxTokens ?? 800),
        memories: results.map(serializeSessionMemory),
        warnings,
        startedAt: new Date().toISOString()
      });
    },

    async backupMemory(input: BackupMemoryToolInput) {
      const backup = await store.createBackup({ backupPath: input.backupPath });

      return toolResult({
        backupPath: backup.backupPath,
        createdAt: backup.createdAt.toISOString(),
        warning: null
      });
    },

    async verifyBackup(input: VerifyBackupToolInput) {
      const verification = store.verifyBackup({ backupPath: input.backupPath });

      return toolResult({
        backupPath: verification.backupPath,
        ok: verification.ok,
        memoryCount: verification.memoryCount,
        eventCount: verification.eventCount,
        integrityCheck: verification.integrityCheck,
        schemaOk: verification.schemaOk,
        warnings: verification.warnings,
        checkedAt: verification.checkedAt.toISOString()
      });
    },

    async inspectBackup(input: InspectBackupToolInput) {
      const inspection = store.inspectBackup({
        backupPath: input.backupPath,
        layers: input.layers,
        includeSuperseded: input.includeSuperseded ?? false,
        includeForgotten: input.includeForgotten ?? false,
        limit: input.limit ?? 20,
        projectScope: input.projectScope,
        projectPath: input.projectPath,
        includeCrossProject: input.includeCrossProject ?? false
      });

      return toolResult({
        backupPath: inspection.backupPath,
        ok: inspection.ok,
        memoryCount: inspection.memoryCount,
        eventCount: inspection.eventCount,
        integrityCheck: inspection.integrityCheck,
        schemaOk: inspection.schemaOk,
        warnings: inspection.warnings,
        checkedAt: inspection.checkedAt.toISOString(),
        memories: inspection.memories.map(serializeBackupMemorySummary)
      });
    },

    async repairMemoryIndex(input: RepairMemoryIndexToolInput) {
      const repair = await store.repairMemoryIndex({
        backupPath: input.backupPath,
        createBackup: input.createBackup ?? true
      });

      return toolResult({
        repaired: repair.repaired,
        backupPath: repair.backupPath,
        backupVerification: repair.backupVerification
          ? {
              backupPath: repair.backupVerification.backupPath,
              ok: repair.backupVerification.ok,
              memoryCount: repair.backupVerification.memoryCount,
              eventCount: repair.backupVerification.eventCount,
              integrityCheck: repair.backupVerification.integrityCheck,
              schemaOk: repair.backupVerification.schemaOk,
              warnings: repair.backupVerification.warnings,
              checkedAt: repair.backupVerification.checkedAt.toISOString()
            }
          : null,
        before: serializeDatabaseHealth(repair.before),
        after: serializeDatabaseHealth(repair.after),
        warnings: repair.warnings,
        repairedAt: repair.repairedAt.toISOString()
      });
    },

    async auditMemory(input: AuditMemoryToolInput) {
      const events = store.listRecentEvents({
        memoryId: input.memoryId,
        limit: input.limit
      });

      return toolResult({
        events: events.map((event) => ({
          id: event.id,
          memoryId: event.memoryId,
          eventType: event.eventType,
          payload: event.payload,
          createdAt: event.createdAt.toISOString()
        }))
      });
    }
  };
}

export function registerMemoryTools(server: McpServer, store: MemoryStore, options: ToolHandlerOptions = {}): void {
  const handlers = createToolHandlers(store, options);

  server.registerTool(
    "write_memory",
    {
      description: "Create a local memory record after explicit user or Codex instruction.",
      inputSchema: writeMemorySchema
    },
    handlers.writeMemory
  );

  server.registerTool(
    "propose_memory_update",
    {
      description: "Dry-run a memory write/update decision without modifying the database.",
      inputSchema: proposeMemoryUpdateSchema
    },
    handlers.proposeMemoryUpdate
  );

  server.registerTool(
    "health_check",
    {
      description: "Check local memory database and embedding provider readiness.",
      inputSchema: healthCheckSchema
    },
    handlers.healthCheck
  );

  server.registerTool(
    "memory_stats",
    {
      description: "Return aggregate memory database counts by status and layer without memory contents.",
      inputSchema: memoryStatsSchema
    },
    handlers.memoryStats
  );

  server.registerTool(
    "search_memory",
    {
      description: "Search local memory using SQLite FTS and metadata filters.",
      inputSchema: searchMemorySchema
    },
    handlers.searchMemory
  );

  server.registerTool(
    "read_memory",
    {
      description: "Read a single memory by id, excluding forgotten records unless explicitly requested.",
      inputSchema: readMemorySchema
    },
    handlers.readMemory
  );

  server.registerTool(
    "list_memory_summaries",
    {
      description: "List memory metadata and summaries without returning full memory content.",
      inputSchema: listMemorySummariesSchema
    },
    handlers.listMemorySummaries
  );

  server.registerTool(
    "update_memory",
    {
      description: "Update an existing memory while preserving audit history.",
      inputSchema: updateMemorySchema
    },
    handlers.updateMemory
  );

  server.registerTool(
    "forget_memory",
    {
      description: "Logically forget a memory by default, with optional hard delete.",
      inputSchema: forgetMemorySchema
    },
    handlers.forgetMemory
  );

  server.registerTool(
    "consolidate_memory",
    {
      description: "Return dry-run consolidation proposals such as duplicate_content merge candidates.",
      inputSchema: consolidateMemorySchema
    },
    handlers.consolidateMemory
  );

  server.registerTool(
    "memory_digest",
    {
      description: "Build compact relevant memory context for a task.",
      inputSchema: memoryDigestSchema
    },
    handlers.memoryDigest
  );

  server.registerTool(
    "start_memory_session",
    {
      description: "Check readiness and return compact project-scoped memory context for starting work.",
      inputSchema: startMemorySessionSchema
    },
    handlers.startMemorySession
  );

  server.registerTool(
    "backup_memory",
    {
      description: "Create an explicit SQLite backup of the local memory database.",
      inputSchema: backupMemorySchema
    },
    handlers.backupMemory
  );

  server.registerTool(
    "verify_backup",
    {
      description: "Verify that a SQLite memory backup can be opened and report record counts.",
      inputSchema: verifyBackupSchema
    },
    handlers.verifyBackup
  );

  server.registerTool(
    "inspect_backup",
    {
      description: "Inspect a SQLite memory backup in read-only mode and return counts plus summaries without content.",
      inputSchema: inspectBackupSchema
    },
    handlers.inspectBackup
  );

  server.registerTool(
    "repair_memory_index",
    {
      description: "Create a safety backup, rebuild the SQLite FTS index, and report before/after health.",
      inputSchema: repairMemoryIndexSchema
    },
    handlers.repairMemoryIndex
  );

  server.registerTool(
    "audit_memory",
    {
      description: "Read recent audit events without returning full memory contents.",
      inputSchema: auditMemorySchema
    },
    handlers.auditMemory
  );
}

function serializeDatabaseHealth(health: ReturnType<MemoryStore["checkDatabaseHealth"]>) {
  return {
    ok: health.ok,
    integrityCheck: health.integrityCheck,
    fts: health.fts,
    walCheckpoint: health.walCheckpoint,
    warnings: health.warnings,
    checkedAt: health.checkedAt.toISOString()
  };
}

function serializeMemoryStats(stats: ReturnType<MemoryStore["getStats"]>) {
  return {
    memoryCount: stats.memoryCount,
    eventCount: stats.eventCount,
    byStatus: stats.byStatus,
    byLayer: stats.byLayer,
    byProjectScope: stats.byProjectScope.map((scope) => ({
      projectScope: scope.projectScope,
      total: scope.total,
      active: scope.active,
      latestUpdatedAt: scope.latestUpdatedAt?.toISOString() ?? null
    })),
    updatedAtRange: {
      oldest: stats.updatedAtRange.oldest?.toISOString() ?? null,
      newest: stats.updatedAtRange.newest?.toISOString() ?? null
    }
  };
}

function toolResult<T extends Record<string, unknown>>(structuredContent: T): ToolResult<T> {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(structuredContent, null, 2)
      }
    ],
    structuredContent
  };
}

function serializeSearchResult(result: SearchMemoryResult, options: { includeEmbedding?: boolean } = {}) {
  return {
    ...serializeMemory(result.memory, options),
    score: result.score,
    scoreBreakdown: result.scoreBreakdown
  };
}

function serializeMemory(memory: Memory, options: { includeEmbedding?: boolean } = {}) {
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
    lastAccessedAt: memory.lastAccessedAt?.toISOString() ?? null,
    expiresAt: memory.expiresAt?.toISOString() ?? null,
    status: memory.status
  };
}

function serializeMemorySummary(memory: Memory) {
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
    lastAccessedAt: memory.lastAccessedAt?.toISOString() ?? null,
    expiresAt: memory.expiresAt?.toISOString() ?? null,
    status: memory.status
  };
}

function serializeSessionMemory(result: SearchMemoryResult) {
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
    status: result.memory.status,
    score: result.score,
    scoreBreakdown: result.scoreBreakdown
  };
}

function serializeBackupMemorySummary(memory: ReturnType<MemoryStore["inspectBackup"]>["memories"][number]) {
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
    lastAccessedAt: memory.lastAccessedAt?.toISOString() ?? null,
    expiresAt: memory.expiresAt?.toISOString() ?? null,
    status: memory.status
  };
}

async function tryEmbed(
  embeddingProvider: EmbeddingProvider | undefined,
  input: string
): Promise<{ value: number[] | null; warning: string | null }> {
  if (!embeddingProvider) {
    return { value: null, warning: null };
  }

  try {
    return { value: await embeddingProvider.embed(input), warning: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { value: null, warning: `Embedding unavailable: ${message}` };
  }
}

function compactDigest(memories: ReturnType<typeof serializeSearchResult>[], maxTokens: number): string {
  const maxChars = maxTokens * 4;
  const lines = memories.map((memory) => `- [${memory.layer}] ${memory.summary}`);
  const digest = lines.join("\n");
  return digest.length <= maxChars ? digest : `${digest.slice(0, Math.max(0, maxChars - 3))}...`;
}

function findDuplicateMergeProposals(memories: Memory[]) {
  const groups = new Map<string, Memory[]>();

  for (const memory of memories) {
    const key = normalizeMemoryContent(memory.content);
    const group = groups.get(key) ?? [];
    group.push(memory);
    groups.set(key, group);
  }

  return [...groups.values()]
    .filter((group) => group.length > 1)
    .map((group) => {
      const ordered = [...group].sort((left, right) => left.id - right.id);
      return {
        memoryIds: ordered.map((memory) => memory.id),
        reason: "duplicate_content",
        summary: ordered[0]?.summary ?? ""
      };
    });
}

function findDuplicateCandidatesForMemory(memory: Memory, candidates: Memory[]) {
  const key = normalizeMemoryContent(memory.content);
  return candidates
    .filter((candidate) => candidate.id !== memory.id && normalizeMemoryContent(candidate.content) === key)
    .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime() || left.id - right.id)
    .slice(0, 5)
    .map((candidate) => ({
      memoryId: candidate.id,
      reason: "duplicate_content",
      summary: candidate.summary
    }));
}

function findDuplicateCandidatesForContent(content: string, candidates: Memory[]) {
  const key = normalizeMemoryContent(content);
  return candidates
    .filter((candidate) => normalizeMemoryContent(candidate.content) === key)
    .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime() || left.id - right.id)
    .slice(0, 5)
    .map((candidate) => ({
      memoryId: candidate.id,
      reason: "duplicate_content",
      summary: candidate.summary
    }));
}

function buildMemoryProposal(input: ProposeMemoryUpdateToolInput) {
  const combined = `${input.taskContext ?? ""} ${input.content}`.toLowerCase();
  const tags = new Set<string>();
  const reasons: string[] = [];
  let layer: MemoryLayer = "recall";
  let importance = 0.5;
  let confidence = 0.75;

  if (/\b(rule|policy|preference|always|never|must|should|運用|方針|ルール|毎回|必ず)\b/i.test(combined)) {
    layer = "core";
    importance = 0.75;
    confidence = 0.85;
    reasons.push("Content looks like a durable rule or preference.");
  } else {
    reasons.push("Content looks useful as task recall.");
  }

  if (/daily|startup|session|operation|運用|作業開始|日常/.test(combined)) {
    tags.add("daily-operation");
  }
  if (/mcp|sidecar|memory/.test(combined)) {
    tags.add("codex-memory-sidecar");
  }
  if (/test|verify|smoke|検証|確認/.test(combined)) {
    tags.add("verification");
  }
  if (!tags.size) {
    tags.add("memory-candidate");
  }

  return {
    layer,
    tags: [...tags].sort(),
    importance,
    confidence,
    reasons
  };
}

function looksLikeSecret(content: string): boolean {
  return /(?:api[_-]?key|token|password|secret)\s*[:=]/i.test(content) || /sk-(?:proj-)?[a-z0-9_-]{12,}/i.test(content);
}

function isEphemeralMemory(content: string, taskContext: string | undefined): boolean {
  const combined = `${taskContext ?? ""} ${content}`.toLowerCase();
  return /\b(temporary|one-off|scratch|just now|一時的|すぐ消す|今回だけ)\b/.test(combined);
}

function normalizeMemoryContent(content: string): string {
  return content.trim().replace(/\s+/g, " ").replace(/[.]+$/, "").toLowerCase();
}
