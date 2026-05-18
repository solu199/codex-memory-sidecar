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

const planBackupRetentionSchema = {
  keepCount: z.number().int().min(0).max(1000).optional()
};

const verifyBackupSchema = {
  backupPath: z.string().min(1)
};

const planBackupRestoreSchema = {
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

interface PlanBackupRetentionToolInput {
  keepCount?: number;
}

interface VerifyBackupToolInput {
  backupPath: string;
}

interface PlanBackupRestoreToolInput {
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
        }),
        proposal.layer
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
      const curation = buildCurationGuidance(proposal.layer, recommendation, reasons);
      const provenance = analyzeProvenance(input.sourceType, input.sourceRef);

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
        curation,
        provenance,
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
      const backupRetention = serializeBackupRetentionSummary(store.planBackupRetention());
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
      const sessionGuidance = buildSessionGuidance();

      if (!databaseHealth.ok) {
        return toolResult({
          ready: false,
          taskDescription: input.taskDescription,
          health: {
            database,
            embedding: embeddingStatus
          },
          memoryStats: serializeMemoryStats(stats),
          backupRetention,
          repairRecommended,
          sessionGuidance,
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
        backupRetention,
        repairRecommended,
        sessionGuidance,
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

    async planBackupRetention(input: PlanBackupRetentionToolInput) {
      const plan = store.planBackupRetention({ keepCount: input.keepCount });

      return toolResult({
        backupDir: plan.backupDir,
        keepCount: plan.keepCount,
        backups: plan.backups.map(serializeBackupRetentionEntry),
        kept: plan.kept.map(serializeBackupRetentionEntry),
        prunable: plan.prunable.map(serializeBackupRetentionEntry),
        wouldDelete: false,
        plannedAt: plan.plannedAt.toISOString(),
        warnings: [] as string[]
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

    async planBackupRestore(input: PlanBackupRestoreToolInput) {
      const currentHealth = store.checkDatabaseHealth();
      const currentCounts = store.countRecords();
      const backupVerification = store.verifyBackup({ backupPath: input.backupPath });
      const warnings = [...currentHealth.warnings, ...backupVerification.warnings];

      return toolResult({
        backupPath: backupVerification.backupPath,
        ok: currentHealth.ok && backupVerification.ok,
        wouldRestore: false,
        requiresMcpRestart: true,
        current: {
          databaseOk: currentHealth.ok,
          memoryCount: currentCounts.memoryCount,
          eventCount: currentCounts.eventCount,
          integrityCheck: currentHealth.integrityCheck,
          fts: currentHealth.fts,
          walCheckpoint: currentHealth.walCheckpoint
        },
        backup: {
          ok: backupVerification.ok,
          memoryCount: backupVerification.memoryCount,
          eventCount: backupVerification.eventCount,
          integrityCheck: backupVerification.integrityCheck,
          schemaOk: backupVerification.schemaOk,
          checkedAt: backupVerification.checkedAt.toISOString()
        },
        note: "This is a dry-run restore plan. No database files were changed.",
        steps: [
          "Stop the Codex Memory Sidecar MCP server before replacing the database file.",
          "Create a fresh safety backup of the current database and verify it.",
          "Replace the current database file with the selected backup file outside the running MCP process.",
          "Restart the Codex Memory Sidecar MCP server.",
          "Run health_check and verify warnings is empty before resuming normal use."
        ],
        warnings
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
      description: "Return dry-run consolidation proposals such as duplicate_content and near_duplicate_content merge candidates.",
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
    "plan_backup_retention",
    {
      description: "Dry-run default backup retention and report kept/prunable backup files without deleting anything.",
      inputSchema: planBackupRetentionSchema
    },
    handlers.planBackupRetention
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
    "plan_backup_restore",
    {
      description: "Dry-run a backup restore by comparing current database health/counts with a verified backup.",
      inputSchema: planBackupRestoreSchema
    },
    handlers.planBackupRestore
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

function serializeBackupRetentionEntry(entry: ReturnType<MemoryStore["planBackupRetention"]>["backups"][number]) {
  return {
    backupPath: entry.backupPath,
    sizeBytes: entry.sizeBytes,
    mtime: entry.mtime.toISOString()
  };
}

function serializeBackupRetentionSummary(plan: ReturnType<MemoryStore["planBackupRetention"]>) {
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
    plannedAt: plan.plannedAt.toISOString()
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

function buildSessionGuidance() {
  return {
    memoryUse: "supporting_context",
    canAnswer: [
      "Relevant saved memory summaries and their sourceRefs can inform this task.",
      "Health, embedding, FTS, WAL, backup retention, and recent project memory availability are reflected in this session."
    ],
    mustVerify: [
      "Validate memory-derived claims against the user's latest instruction, README/docs, actual files, or git history before treating them as facts.",
      "Use read_memory or audit_memory when a memory summary affects an important decision."
    ],
    limitations: [
      "The digest may omit relevant memories when the query is too narrow or the database has not captured the decision yet.",
      "Memory can be stale, incomplete, or less precise than current repository files."
    ],
    suggestedNextTools: ["read_memory", "search_memory", "audit_memory"]
  };
}

function buildCurationGuidance(
  recommendedLayer: MemoryLayer,
  recommendation: "create" | "update" | "skip",
  rationale: string[]
) {
  return {
    recommendedLayer,
    durability:
      recommendation === "skip"
        ? "skip"
        : recommendedLayer === "core"
          ? "durable"
          : recommendedLayer === "archival"
            ? "archival"
            : "task_recall",
    shouldPromoteToCore: recommendation !== "skip" && recommendedLayer === "core",
    rationale
  };
}

function analyzeProvenance(sourceType: string, sourceRef: string) {
  const recognizedRefs: string[] = [];
  if (/\b(?:pr|pull request)\s*#?\d+\b/i.test(sourceRef)) {
    recognizedRefs.push("pr");
  }
  if (/\bissue\s*#?\d+\b/i.test(sourceRef)) {
    recognizedRefs.push("issue");
  }
  if (/\b[0-9a-f]{7,40}\b/i.test(sourceRef)) {
    recognizedRefs.push("commit");
  }
  if (/(?:^|[\\/])(?:docs|src|tests|config)[\\/][^\s]+|[^\s]+\.(?:md|ts|tsx|js|json|toml)\b/i.test(sourceRef)) {
    recognizedRefs.push("doc_path");
  }
  if (/\b(?:chat|evaluation|smoke|test)[:-][a-z0-9_.-]+/i.test(sourceRef)) {
    recognizedRefs.push("named_run");
  }

  const genericRefs = new Set(["test", "manual", "chat", "codex-chat", "note", "memory"]);
  const suggestions: string[] = [];
  if (!recognizedRefs.length || genericRefs.has(sourceRef.trim().toLowerCase())) {
    suggestions.push(
      "Use a sourceRef that points to a doc path, commit hash, PR number, issue number, or named chat/evaluation id."
    );
  }

  return {
    sourceType,
    sourceRef,
    quality: suggestions.length ? "weak" : "strong",
    recognizedRefs,
    suggestions
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

  const exactProposals = [...groups.values()]
    .filter((group) => group.length > 1)
    .map((group) => {
      const ordered = [...group].sort((left, right) => left.id - right.id);
      return {
        memoryIds: ordered.map((memory) => memory.id),
        reason: "duplicate_content",
        summary: ordered[0]?.summary ?? ""
      };
    });
  const exactPairKeys = new Set<string>();
  for (const proposal of exactProposals) {
    for (let left = 0; left < proposal.memoryIds.length; left += 1) {
      for (let right = left + 1; right < proposal.memoryIds.length; right += 1) {
        exactPairKeys.add(pairKey(proposal.memoryIds[left] ?? 0, proposal.memoryIds[right] ?? 0));
      }
    }
  }

  return [...exactProposals, ...findNearDuplicateMergeProposals(memories, exactPairKeys)];
}

function findNearDuplicateMergeProposals(memories: Memory[], excludedPairs: Set<string>) {
  const proposals: Array<{
    memoryIds: number[];
    reason: "near_duplicate_content";
    summary: string;
    confidence: number;
  }> = [];

  for (let leftIndex = 0; leftIndex < memories.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < memories.length; rightIndex += 1) {
      const left = memories[leftIndex];
      const right = memories[rightIndex];
      if (!left || !right || left.layer !== right.layer) {
        continue;
      }
      const key = pairKey(left.id, right.id);
      if (excludedPairs.has(key)) {
        continue;
      }
      const confidence = contentSimilarity(left.content, right.content);
      if (confidence < 0.72) {
        continue;
      }
      const ordered = [left, right].sort((a, b) => a.id - b.id);
      proposals.push({
        memoryIds: ordered.map((memory) => memory.id),
        reason: "near_duplicate_content",
        summary: ordered[0]?.summary ?? "",
        confidence: Number(confidence.toFixed(4))
      });
    }
  }

  return proposals.sort((left, right) => left.memoryIds[0] - right.memoryIds[0] || left.memoryIds[1] - right.memoryIds[1]);
}

function findDuplicateCandidatesForMemory(memory: Memory, candidates: Memory[]) {
  const key = normalizeMemoryContent(memory.content);
  const exactCandidates = candidates
    .filter((candidate) => candidate.id !== memory.id && normalizeMemoryContent(candidate.content) === key)
    .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime() || left.id - right.id)
    .slice(0, 5)
    .map((candidate) => ({
      memoryId: candidate.id,
      reason: "duplicate_content",
      summary: candidate.summary
    }));
  if (exactCandidates.length >= 5) {
    return exactCandidates;
  }

  return [
    ...exactCandidates,
    ...findNearDuplicateCandidates(memory.content, memory.layer, candidates, new Set([memory.id, ...exactCandidates.map((candidate) => candidate.memoryId)]))
  ].slice(0, 5);
}

function findDuplicateCandidatesForContent(content: string, candidates: Memory[], layer?: MemoryLayer) {
  const key = normalizeMemoryContent(content);
  const exactCandidates = candidates
    .filter((candidate) => normalizeMemoryContent(candidate.content) === key)
    .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime() || left.id - right.id)
    .slice(0, 5)
    .map((candidate) => ({
      memoryId: candidate.id,
      reason: "duplicate_content",
      summary: candidate.summary
    }));
  if (exactCandidates.length >= 5) {
    return exactCandidates;
  }

  return [
    ...exactCandidates,
    ...findNearDuplicateCandidates(content, layer, candidates, new Set(exactCandidates.map((candidate) => candidate.memoryId)))
  ].slice(0, 5);
}

function findNearDuplicateCandidates(content: string, layer: MemoryLayer | undefined, candidates: Memory[], excludedIds: Set<number>) {
  return candidates
    .filter((candidate) => !excludedIds.has(candidate.id) && (!layer || candidate.layer === layer))
    .map((candidate) => ({
      candidate,
      confidence: contentSimilarity(content, candidate.content)
    }))
    .filter((entry) => entry.confidence >= 0.72)
    .sort(
      (left, right) =>
        right.confidence - left.confidence ||
        right.candidate.updatedAt.getTime() - left.candidate.updatedAt.getTime() ||
        left.candidate.id - right.candidate.id
    )
    .slice(0, 5)
    .map(({ candidate, confidence }) => ({
      memoryId: candidate.id,
      reason: "near_duplicate_content",
      summary: candidate.summary,
      confidence: Number(confidence.toFixed(4))
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

function contentSimilarity(left: string, right: string): number {
  const leftTokens = tokenizeMemoryContent(left);
  const rightTokens = tokenizeMemoryContent(right);
  const tokenSimilarity =
    leftTokens.size && rightTokens.size
      ? setIntersectionSize(leftTokens, rightTokens) / new Set([...leftTokens, ...rightTokens]).size
      : 0;
  return Math.max(tokenSimilarity, characterSimilarity(left, right));
}

function tokenizeMemoryContent(content: string): Set<string> {
  const stopWords = new Set(["a", "an", "and", "are", "be", "for", "in", "is", "of", "the", "to", "with"]);
  return new Set(
    content
      .toLowerCase()
      .replace(/[_-]/g, " ")
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length > 2 && !stopWords.has(token))
  );
}

function characterSimilarity(left: string, right: string): number {
  const leftShingles = characterShingles(left);
  const rightShingles = characterShingles(right);
  if (!leftShingles.size || !rightShingles.size) {
    return 0;
  }
  return (2 * setIntersectionSize(leftShingles, rightShingles)) / (leftShingles.size + rightShingles.size);
}

function characterShingles(content: string): Set<string> {
  const normalized = content
    .toLowerCase()
    .replace(/[_\-\s]+/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");
  if (normalized.length <= 2) {
    return normalized ? new Set([normalized]) : new Set();
  }
  const shingles = new Set<string>();
  for (let index = 0; index <= normalized.length - 2; index += 1) {
    shingles.add(normalized.slice(index, index + 2));
  }
  return shingles;
}

function setIntersectionSize<T>(left: Set<T>, right: Set<T>): number {
  let count = 0;
  for (const value of left) {
    if (right.has(value)) {
      count += 1;
    }
  }
  return count;
}

function pairKey(left: number, right: number): string {
  return left < right ? `${left}:${right}` : `${right}:${left}`;
}

function normalizeMemoryContent(content: string): string {
  return content.trim().replace(/\s+/g, " ").replace(/[.]+$/, "").toLowerCase();
}
