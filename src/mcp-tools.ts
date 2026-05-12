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
  importance: z.number().min(0).max(1).default(0.5),
  confidence: z.number().min(0).max(1).default(0.5),
  allowSecret: z.boolean().default(false)
};

const searchMemorySchema = {
  query: z.string().min(1),
  layers: z.array(layerSchema).optional(),
  tags: z.array(z.string()).optional(),
  limit: z.number().int().min(1).max(50).default(8),
  includeSuperseded: z.boolean().default(false)
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
  maxCandidates: z.number().int().min(1).max(100).default(20)
};

const memoryDigestSchema = {
  taskDescription: z.string().min(1),
  projectPath: z.string().optional(),
  maxTokens: z.number().int().min(50).max(4000).default(800)
};

const backupMemorySchema = {
  backupPath: z.string().min(1).optional()
};

const verifyBackupSchema = {
  backupPath: z.string().min(1)
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
  importance?: number;
  confidence?: number;
  allowSecret?: boolean;
}

interface SearchMemoryToolInput {
  query: string;
  layers?: MemoryLayer[];
  tags?: string[];
  limit?: number;
  includeSuperseded?: boolean;
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
}

interface MemoryDigestToolInput {
  taskDescription: string;
  projectPath?: string;
  maxTokens?: number;
}

interface BackupMemoryToolInput {
  backupPath?: string;
}

interface VerifyBackupToolInput {
  backupPath: string;
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
        sourceType: input.sourceType,
        sourceRef: input.sourceRef,
        importance: input.importance,
        confidence: input.confidence,
        allowSecret: input.allowSecret ?? false,
        embedding: embedding.value
      });

      return toolResult({
        memory: serializeMemory(memory),
        duplicateCandidates: [] as unknown[],
        warnings: embedding.warning ? [embedding.warning] : []
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
        includeSuperseded: input.includeSuperseded ?? false
      });

      return toolResult({
        memories: results.map(serializeSearchResult),
        warnings: embedding.warning ? [embedding.warning] : []
      });
    },

    async updateMemory(input: UpdateMemoryToolInput) {
      const memory = store.updateMemory({
        memoryId: input.memoryId,
        newContent: input.newContent,
        updateNote: input.updateNote,
        tags: input.tags,
        allowSecret: input.allowSecret ?? false
      });

      return toolResult({
        memory: serializeMemory(memory),
        event: "updated"
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
        limit: input.maxCandidates ?? 20
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
      const query = [input.taskDescription, input.projectPath].filter(Boolean).join(" ");
      const embedding = await tryEmbed(options.embeddingProvider, query);
      const results = store.searchMemory({ query, queryEmbedding: embedding.value, limit: 8 });
      const serialized = results.map(serializeSearchResult);
      const digest = compactDigest(serialized, input.maxTokens ?? 800);

      return toolResult({
        digest,
        memories: serialized,
        warnings: embedding.warning ? [embedding.warning] : []
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
        checkedAt: verification.checkedAt.toISOString()
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
    "search_memory",
    {
      description: "Search local memory using SQLite FTS and metadata filters.",
      inputSchema: searchMemorySchema
    },
    handlers.searchMemory
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
    "audit_memory",
    {
      description: "Read recent audit events without returning full memory contents.",
      inputSchema: auditMemorySchema
    },
    handlers.auditMemory
  );
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

function serializeSearchResult(result: SearchMemoryResult) {
  return {
    ...serializeMemory(result.memory),
    score: result.score,
    scoreBreakdown: result.scoreBreakdown
  };
}

function serializeMemory(memory: Memory) {
  return {
    id: memory.id,
    layer: memory.layer,
    content: memory.content,
    summary: memory.summary,
    tags: memory.tags,
    sourceType: memory.sourceType,
    sourceRef: memory.sourceRef,
    importance: memory.importance,
    confidence: memory.confidence,
    embedding: memory.embedding,
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

function normalizeMemoryContent(content: string): string {
  return content.trim().replace(/\s+/g, " ").replace(/[.]+$/, "").toLowerCase();
}
