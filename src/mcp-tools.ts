import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

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
  hardDelete: z.boolean().default(false)
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

export function createToolHandlers(store: MemoryStore) {
  return {
    async writeMemory(input: WriteMemoryToolInput) {
      const memory = store.createMemory({
        content: input.content,
        layer: input.layer,
        tags: input.tags,
        sourceType: input.sourceType,
        sourceRef: input.sourceRef,
        importance: input.importance,
        confidence: input.confidence,
        allowSecret: input.allowSecret ?? false
      });

      return toolResult({
        memory: serializeMemory(memory),
        duplicateCandidates: [] as unknown[]
      });
    },

    async searchMemory(input: SearchMemoryToolInput) {
      const results = store.searchMemory({
        query: input.query,
        layers: input.layers,
        tags: input.tags,
        limit: input.limit,
        includeSuperseded: input.includeSuperseded ?? false
      });

      return toolResult({
        memories: results.map(serializeSearchResult)
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
        hardDelete: input.hardDelete ?? false
      });

      return toolResult({
        memory: serializeMemory(memory),
        event: "forgotten"
      });
    },

    async consolidateMemory(input: ConsolidateMemoryToolInput) {
      return toolResult({
        dryRun: input.dryRun ?? true,
        layers: input.layers ?? ["core", "recall", "archival"],
        since: input.since ?? null,
        maxCandidates: input.maxCandidates ?? 20,
        proposedMerges: [] as unknown[],
        proposedSummaries: [] as unknown[],
        proposedForgottenRecords: [] as unknown[],
        contradictionWarnings: [] as unknown[]
      });
    },

    async memoryDigest(input: MemoryDigestToolInput) {
      const query = [input.taskDescription, input.projectPath].filter(Boolean).join(" ");
      const results = store.searchMemory({ query, limit: 8 });
      const serialized = results.map(serializeSearchResult);
      const digest = compactDigest(serialized, input.maxTokens ?? 800);

      return toolResult({
        digest,
        memories: serialized,
        warnings: [] as string[]
      });
    }
  };
}

export function registerMemoryTools(server: McpServer, store: MemoryStore): void {
  const handlers = createToolHandlers(store);

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
      description: "Return dry-run consolidation proposals. Phase 1 returns an empty proposal set.",
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
    score: result.score
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
    createdAt: memory.createdAt.toISOString(),
    updatedAt: memory.updatedAt.toISOString(),
    lastAccessedAt: memory.lastAccessedAt?.toISOString() ?? null,
    expiresAt: memory.expiresAt?.toISOString() ?? null,
    status: memory.status
  };
}

function compactDigest(memories: ReturnType<typeof serializeSearchResult>[], maxTokens: number): string {
  const maxChars = maxTokens * 4;
  const lines = memories.map((memory) => `- [${memory.layer}] ${memory.summary}`);
  const digest = lines.join("\n");
  return digest.length <= maxChars ? digest : `${digest.slice(0, Math.max(0, maxChars - 3))}...`;
}
