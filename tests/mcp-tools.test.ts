import os from "node:os";
import path from "node:path";
import { existsSync, mkdtempSync, rmSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import Database from "better-sqlite3";

import { createToolHandlers } from "../src/mcp-tools.js";
import { MemoryStore } from "../src/memory-store.js";

describe("MCP tool handlers", () => {
  let tempDir: string;
  let store: MemoryStore;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), "codex-memory-sidecar-tools-"));
    store = new MemoryStore(path.join(tempDir, "memory.sqlite"));
  });

  afterEach(() => {
    store.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("write_memory returns structured memory content", async () => {
    const embedder = { embed: vi.fn(async () => [1, 0]) };
    const tools = createToolHandlers(store, { embeddingProvider: embedder });

    const result = await tools.writeMemory({
      content: "Prefer dry-run consolidation by default.",
      layer: "core",
      tags: ["safety"],
      sourceType: "manual",
      sourceRef: "test",
      importance: 0.8,
      confidence: 0.9
    });

    expect(result.structuredContent.memory.status).toBe("active");
    expect(result.structuredContent.memory.embedding).toBeNull();
    expect(store.getMemory(result.structuredContent.memory.id)?.embedding).toEqual([1, 0]);
    expect(result.structuredContent.duplicateCandidates).toEqual([]);
    expect(result.content[0]?.type).toBe("text");
  });

  test("write_memory returns duplicate candidates for matching existing memories", async () => {
    const tools = createToolHandlers(store);
    const existing = await tools.writeMemory({
      content: "Prefer logical delete before hard delete.",
      layer: "core",
      tags: ["safety"],
      sourceType: "manual",
      sourceRef: "test"
    });

    const result = await tools.writeMemory({
      content: " prefer logical delete before hard delete ",
      layer: "core",
      tags: ["safety"],
      sourceType: "manual",
      sourceRef: "test"
    });

    expect(result.structuredContent.memory.id).not.toBe(existing.structuredContent.memory.id);
    expect(result.structuredContent.duplicateCandidates).toEqual([
      {
        memoryId: existing.structuredContent.memory.id,
        reason: "duplicate_content",
        summary: "Prefer logical delete before hard delete."
      }
    ]);
    expect(store.getMemory(result.structuredContent.memory.id)?.status).toBe("active");
  });

  test("search_memory returns ranked matching memories", async () => {
    const tools = createToolHandlers(store);
    await tools.writeMemory({
      content: "SQLite FTS handles keyword recall in phase one.",
      layer: "recall",
      tags: ["sqlite"],
      sourceType: "manual",
      sourceRef: "test",
      importance: 0.6,
      confidence: 0.8
    });

    const result = await tools.searchMemory({
      query: "FTS",
      layers: ["recall"],
      limit: 3
    });

    expect(result.structuredContent.memories).toHaveLength(1);
    expect(result.structuredContent.memories[0]?.summary).toContain("SQLite FTS");
  });

  test("write_memory and search_memory preserve project scope", async () => {
    const tools = createToolHandlers(store);
    await tools.writeMemory({
      content: "Scoped MCP lookup phrase for alpha.",
      layer: "recall",
      tags: ["scope"],
      sourceType: "manual",
      sourceRef: "test",
      projectScope: "alpha"
    });
    await tools.writeMemory({
      content: "Scoped MCP lookup phrase for beta.",
      layer: "recall",
      tags: ["scope"],
      sourceType: "manual",
      sourceRef: "test",
      projectScope: "beta"
    });

    const result = await tools.searchMemory({
      query: "scoped MCP lookup phrase",
      projectScope: "alpha",
      limit: 10
    });

    expect(result.structuredContent.memories).toHaveLength(1);
    expect(result.structuredContent.memories[0]?.projectScope).toBe("alpha");
    expect(result.structuredContent.memories[0]?.summary).toContain("alpha");
  });

  test("search_memory uses embeddings when the provider is available", async () => {
    const embedder = {
      embed: vi
        .fn()
        .mockResolvedValueOnce([1, 0])
        .mockResolvedValueOnce([0, 1])
        .mockResolvedValueOnce([0.95, 0.05])
    };
    const tools = createToolHandlers(store, { embeddingProvider: embedder });

    await tools.writeMemory({
      content: "Use local embeddings for semantic retrieval.",
      layer: "recall",
      tags: ["ollama"],
      sourceType: "manual",
      sourceRef: "test"
    });
    await tools.writeMemory({
      content: "Keep modules compact.",
      layer: "core",
      tags: ["style"],
      sourceType: "manual",
      sourceRef: "test"
    });

    const result = await tools.searchMemory({
      query: "meaning lookup",
      limit: 1
    });

    expect(result.structuredContent.memories[0]?.summary).toContain("semantic retrieval");
    expect(result.structuredContent.memories[0]?.embedding).toBeNull();
    expect(result.structuredContent.warnings).toEqual([]);
  });

  test("search_memory can include embeddings explicitly", async () => {
    const embedder = {
      embed: vi.fn().mockResolvedValueOnce([1, 0]).mockResolvedValueOnce([1, 0])
    };
    const tools = createToolHandlers(store, { embeddingProvider: embedder });
    await tools.writeMemory({
      content: "Embedding response should be opt-in.",
      layer: "recall",
      tags: ["embedding"],
      sourceType: "manual",
      sourceRef: "test"
    });

    const result = await tools.searchMemory({
      query: "embedding opt in",
      includeEmbedding: true,
      limit: 1
    });

    expect(result.structuredContent.memories[0]?.embedding).toEqual([1, 0]);
  });

  test("read_memory returns one active memory by id", async () => {
    const tools = createToolHandlers(store);
    const created = await tools.writeMemory({
      content: "Read memory should return the exact record by id.",
      layer: "core",
      tags: ["read"],
      sourceType: "manual",
      sourceRef: "test"
    });

    const result = await tools.readMemory({
      memoryId: created.structuredContent.memory.id
    });

    expect(result.structuredContent.memory.id).toBe(created.structuredContent.memory.id);
    expect(result.structuredContent.memory.content).toBe("Read memory should return the exact record by id.");
    expect(result.structuredContent.memory.embedding).toBeNull();
  });

  test("read_memory can include embeddings explicitly", async () => {
    const tools = createToolHandlers(store);
    const created = store.createMemory({
      content: "Read memory embedding should be opt-in.",
      layer: "core",
      tags: ["read"],
      sourceType: "manual",
      sourceRef: "test",
      embedding: [0.3, 0.7]
    });

    const result = await tools.readMemory({
      memoryId: created.id,
      includeEmbedding: true
    });

    expect(result.structuredContent.memory.embedding).toEqual([0.3, 0.7]);
  });

  test("read_memory excludes forgotten records unless explicitly requested", async () => {
    const tools = createToolHandlers(store);
    const created = await tools.writeMemory({
      content: "Forgotten records should require explicit read opt-in.",
      layer: "recall",
      tags: ["read"],
      sourceType: "manual",
      sourceRef: "test"
    });
    await tools.forgetMemory({
      memoryId: created.structuredContent.memory.id,
      reason: "read guard test"
    });

    await expect(
      tools.readMemory({
        memoryId: created.structuredContent.memory.id
      })
    ).rejects.toThrow(/forgotten/i);

    const result = await tools.readMemory({
      memoryId: created.structuredContent.memory.id,
      includeForgotten: true
    });

    expect(result.structuredContent.memory.status).toBe("forgotten");
  });

  test("list_memory_summaries returns metadata without full content", async () => {
    const tools = createToolHandlers(store);
    await tools.writeMemory({
      content: "Full content should stay out of summary listings.",
      layer: "core",
      tags: ["summary"],
      sourceType: "manual",
      sourceRef: "test"
    });

    const result = await tools.listMemorySummaries({
      layers: ["core"],
      limit: 10
    });

    expect(result.structuredContent.memories).toHaveLength(1);
    expect(result.structuredContent.memories[0]).toMatchObject({
      layer: "core",
      summary: "Full content should stay out of summary listings.",
      tags: ["summary"],
      status: "active"
    });
    expect(JSON.stringify(result.structuredContent.memories[0])).not.toContain("\"content\"");
  });

  test("list_memory_summaries excludes forgotten records by default", async () => {
    const tools = createToolHandlers(store);
    const created = await tools.writeMemory({
      content: "Forgotten summaries should require opt-in.",
      layer: "recall",
      tags: ["summary"],
      sourceType: "manual",
      sourceRef: "test"
    });
    await tools.forgetMemory({
      memoryId: created.structuredContent.memory.id,
      reason: "summary filter test"
    });

    expect((await tools.listMemorySummaries({ limit: 10 })).structuredContent.memories).toEqual([]);

    const result = await tools.listMemorySummaries({
      includeForgotten: true,
      limit: 10
    });

    expect(result.structuredContent.memories[0]?.status).toBe("forgotten");
  });

  test("list_memory_summaries keeps forgotten and superseded opt-ins independent", async () => {
    const tools = createToolHandlers(store);
    const forgotten = await tools.writeMemory({
      content: "Forgotten summaries need their own opt-in.",
      layer: "recall",
      tags: ["summary"],
      sourceType: "manual",
      sourceRef: "test"
    });
    const superseded = await tools.writeMemory({
      content: "Superseded summaries need their own opt-in.",
      layer: "recall",
      tags: ["summary"],
      sourceType: "manual",
      sourceRef: "test"
    });
    await tools.forgetMemory({
      memoryId: forgotten.structuredContent.memory.id,
      reason: "summary filter test"
    });
    const db = new Database(path.join(tempDir, "memory.sqlite"));
    db.prepare("UPDATE memories SET status = 'superseded' WHERE id = ?").run(superseded.structuredContent.memory.id);
    db.close();

    const forgottenOnly = await tools.listMemorySummaries({
      includeForgotten: true,
      limit: 10
    });
    const supersededOnly = await tools.listMemorySummaries({
      includeSuperseded: true,
      limit: 10
    });

    expect(forgottenOnly.structuredContent.memories.map((memory) => memory.status)).toEqual(["forgotten"]);
    expect(supersededOnly.structuredContent.memories.map((memory) => memory.status)).toEqual(["superseded"]);
  });

  test("write_memory falls back when embedding generation fails", async () => {
    const tools = createToolHandlers(store, {
      embeddingProvider: { embed: vi.fn(async () => Promise.reject(new Error("Ollama offline"))) }
    });

    const result = await tools.writeMemory({
      content: "Keyword search should still work without Ollama.",
      layer: "recall",
      tags: ["fallback"],
      sourceType: "manual",
      sourceRef: "test"
    });

    expect(result.structuredContent.memory.embedding).toBeNull();
    expect(result.structuredContent.warnings).toEqual(["Embedding unavailable: Ollama offline"]);
  });

  test("update_memory recalculates embedding from new content", async () => {
    const embedder = {
      embed: vi.fn().mockResolvedValueOnce([1, 0]).mockResolvedValueOnce([0, 1])
    };
    const tools = createToolHandlers(store, { embeddingProvider: embedder });
    const created = await tools.writeMemory({
      content: "Old semantic meaning.",
      layer: "recall",
      tags: ["embedding"],
      sourceType: "manual",
      sourceRef: "test"
    });

    const updated = await tools.updateMemory({
      memoryId: created.structuredContent.memory.id,
      newContent: "New semantic meaning.",
      updateNote: "semantic update"
    });

    expect(embedder.embed).toHaveBeenLastCalledWith("New semantic meaning.");
    expect(updated.structuredContent.memory.embedding).toBeNull();
    expect(store.getMemory(created.structuredContent.memory.id)?.embedding).toEqual([0, 1]);
  });

  test("health_check reports database and embedding readiness", async () => {
    const tools = createToolHandlers(store, {
      embeddingProvider: { embed: vi.fn(async () => [0.1, 0.2, 0.3]) }
    });
    await tools.writeMemory({
      content: "Health check should count existing memories.",
      layer: "recall",
      tags: ["health"],
      sourceType: "manual",
      sourceRef: "test"
    });

    const result = await tools.healthCheck({});

    expect(result.structuredContent.ok).toBe(true);
    expect(result.structuredContent.database.ok).toBe(true);
    expect(result.structuredContent.database.memoryCount).toBe(1);
    expect(result.structuredContent.database.integrityCheck).toBe("ok");
    expect(result.structuredContent.database.fts).toMatchObject({
      ok: true,
      expectedCount: 1,
      indexedCount: 1
    });
    expect(result.structuredContent.database.walCheckpoint.busy).toBe(0);
    expect(result.structuredContent.embedding.ok).toBe(true);
    expect(result.structuredContent.embedding.dimensions).toBe(3);
    expect(result.structuredContent.warnings).toEqual([]);
  });

  test("health_check reports embedding warnings without throwing", async () => {
    const tools = createToolHandlers(store, {
      embeddingProvider: { embed: vi.fn(async () => Promise.reject(new Error("Ollama offline"))) }
    });

    const result = await tools.healthCheck({});

    expect(result.structuredContent.ok).toBe(false);
    expect(result.structuredContent.database.ok).toBe(true);
    expect(result.structuredContent.embedding.ok).toBe(false);
    expect(result.structuredContent.embedding.error).toContain("Ollama offline");
    expect(result.structuredContent.warnings).toEqual(["Embedding unavailable: Ollama offline"]);
  });

  test("health_check reports missing embedding provider as unavailable", async () => {
    const tools = createToolHandlers(store);

    const result = await tools.healthCheck({});

    expect(result.structuredContent.ok).toBe(false);
    expect(result.structuredContent.embedding.ok).toBe(false);
    expect(result.structuredContent.embedding.error).toContain("not configured");
    expect(result.structuredContent.warnings).toEqual(["Embedding provider is not configured."]);
  });

  test("health_check reports uncapped database counts", async () => {
    const tools = createToolHandlers(store, {
      embeddingProvider: { embed: vi.fn(async () => [0.1, 0.2, 0.3]) }
    });

    for (let index = 0; index < 101; index += 1) {
      await tools.writeMemory({
        content: `Health check count memory ${index}.`,
        layer: "recall",
        tags: ["health"],
        sourceType: "manual",
        sourceRef: "test"
      });
    }

    const result = await tools.healthCheck({});

    expect(result.structuredContent.database.memoryCount).toBe(101);
    expect(result.structuredContent.database.eventCount).toBe(101);
  });

  test("memory_stats returns aggregate metadata without memory content", async () => {
    const tools = createToolHandlers(store);
    await tools.writeMemory({
      content: "Stats should not include this core content.",
      layer: "core",
      tags: ["stats"],
      sourceType: "manual",
      sourceRef: "test"
    });
    const forgotten = await tools.writeMemory({
      content: "Stats should not include this forgotten content.",
      layer: "recall",
      tags: ["stats"],
      sourceType: "manual",
      sourceRef: "test"
    });
    await tools.forgetMemory({
      memoryId: forgotten.structuredContent.memory.id,
      reason: "stats status test"
    });

    const result = await tools.memoryStats({});

    expect(result.structuredContent).toMatchObject({
      memoryCount: 2,
      eventCount: 3,
      byStatus: {
        active: 1,
        superseded: 0,
        forgotten: 1
      },
      byLayer: {
        core: 1,
        recall: 1,
        archival: 0
      }
    });
    expect(result.structuredContent.updatedAtRange.newest).toEqual(expect.any(String));
    expect(JSON.stringify(result.structuredContent)).not.toContain("Stats should not include this core content.");
    expect(JSON.stringify(result.structuredContent)).not.toContain("Stats should not include this forgotten content.");
  });

  test("forget_memory refuses hard delete without explicit confirmation", async () => {
    const tools = createToolHandlers(store);
    const created = await tools.writeMemory({
      content: "MCP hard delete should require a confirmation flag.",
      layer: "recall",
      tags: ["safety"],
      sourceType: "manual",
      sourceRef: "test"
    });

    await expect(
      tools.forgetMemory({
        memoryId: created.structuredContent.memory.id,
        reason: "testing MCP hard delete guard",
        hardDelete: true
      })
    ).rejects.toThrow(/confirm/i);

    expect(store.getMemory(created.structuredContent.memory.id)?.status).toBe("active");
  });

  test("backup_memory creates a database backup", async () => {
    const tools = createToolHandlers(store);
    await tools.writeMemory({
      content: "MCP backup should preserve records.",
      layer: "recall",
      tags: ["backup"],
      sourceType: "manual",
      sourceRef: "test"
    });
    const backupPath = path.join(tempDir, "backups", "mcp-backup.sqlite");

    const result = await tools.backupMemory({ backupPath });

    expect(result.structuredContent.backupPath).toBe(backupPath);
    expect(result.structuredContent.warning).toBeNull();
    expect(existsSync(backupPath)).toBe(true);
  });

  test("backup_memory creates a default backup when no path is provided", async () => {
    const tools = createToolHandlers(store);
    await tools.writeMemory({
      content: "MCP default backup path should be available.",
      layer: "recall",
      tags: ["backup"],
      sourceType: "manual",
      sourceRef: "test"
    });

    const result = await tools.backupMemory({});

    expect(result.structuredContent.backupPath).toContain(path.join(tempDir, "backups"));
    expect(existsSync(result.structuredContent.backupPath)).toBe(true);
  });

  test("verify_backup reports backup integrity metadata", async () => {
    const tools = createToolHandlers(store);
    await tools.writeMemory({
      content: "MCP backup verification should report counts.",
      layer: "recall",
      tags: ["backup"],
      sourceType: "manual",
      sourceRef: "test"
    });
    const backup = await tools.backupMemory({});

    const result = await tools.verifyBackup({
      backupPath: backup.structuredContent.backupPath
    });

    expect(result.structuredContent.ok).toBe(true);
    expect(result.structuredContent.memoryCount).toBe(1);
    expect(result.structuredContent.eventCount).toBe(1);
    expect(result.structuredContent.checkedAt).toEqual(expect.any(String));
  });

  test("inspect_backup returns backup counts and summaries without full content", async () => {
    const tools = createToolHandlers(store);
    const longVisibleContent = `Backup inspection should show only a generated summary, not this full content. ${"private detail ".repeat(30)}`;
    const visible = await tools.writeMemory({
      content: longVisibleContent,
      layer: "recall",
      tags: ["backup"],
      sourceType: "manual",
      sourceRef: "test"
    });
    const forgotten = await tools.writeMemory({
      content: "Forgotten backup content should require opt-in.",
      layer: "recall",
      tags: ["backup-hidden"],
      sourceType: "manual",
      sourceRef: "test"
    });
    await tools.forgetMemory({
      memoryId: forgotten.structuredContent.memory.id,
      reason: "backup inspect filter test"
    });
    const backup = await tools.backupMemory({});

    const result = await tools.inspectBackup({
      backupPath: backup.structuredContent.backupPath,
      limit: 10
    });

    expect(result.structuredContent.ok).toBe(true);
    expect(result.structuredContent.memoryCount).toBe(2);
    expect(result.structuredContent.eventCount).toBe(3);
    expect(result.structuredContent.memories).toEqual([
      expect.objectContaining({
        id: visible.structuredContent.memory.id,
        summary: expect.stringContaining("Backup inspection should show only a generated summary"),
        status: "active",
        tags: ["backup"]
      })
    ]);
    expect(JSON.stringify(result.structuredContent)).not.toContain(longVisibleContent);
    expect(JSON.stringify(result.structuredContent)).not.toContain("Forgotten backup content should require opt-in.");

    const withForgotten = await tools.inspectBackup({
      backupPath: backup.structuredContent.backupPath,
      includeForgotten: true,
      limit: 10
    });
    expect(withForgotten.structuredContent.memories.map((memory) => memory.status)).toEqual(["forgotten", "active"]);
  });

  test("audit_memory returns recent audit events with optional memory filter", async () => {
    const tools = createToolHandlers(store);
    const first = await tools.writeMemory({
      content: "First MCP audit record.",
      layer: "recall",
      tags: ["audit"],
      sourceType: "manual",
      sourceRef: "test"
    });
    await tools.writeMemory({
      content: "Second MCP audit record.",
      layer: "recall",
      tags: ["audit"],
      sourceType: "manual",
      sourceRef: "test"
    });
    await tools.forgetMemory({
      memoryId: first.structuredContent.memory.id,
      reason: "audit filter test"
    });

    const result = await tools.auditMemory({
      memoryId: first.structuredContent.memory.id,
      limit: 5
    });

    expect(result.structuredContent.events.map((event) => event.eventType)).toEqual(["forgotten", "created"]);
    expect(result.structuredContent.events.every((event) => event.memoryId === first.structuredContent.memory.id)).toBe(
      true
    );
  });

  test("consolidate_memory proposes duplicate records without applying changes", async () => {
    const tools = createToolHandlers(store);
    const first = await tools.writeMemory({
      content: "Use logical delete before hard delete.",
      layer: "core",
      tags: ["safety"],
      sourceType: "manual",
      sourceRef: "test"
    });
    const second = await tools.writeMemory({
      content: " use logical delete before hard delete. ",
      layer: "core",
      tags: ["safety"],
      sourceType: "manual",
      sourceRef: "test"
    });

    const result = await tools.consolidateMemory({
      layers: ["core"],
      dryRun: true,
      maxCandidates: 10
    });

    expect(result.structuredContent.dryRun).toBe(true);
    expect(result.structuredContent.proposedMerges).toEqual([
      {
        memoryIds: [first.structuredContent.memory.id, second.structuredContent.memory.id],
        reason: "duplicate_content",
        summary: "Use logical delete before hard delete."
      }
    ]);
    expect(store.getMemory(second.structuredContent.memory.id)?.status).toBe("active");
  });

  test("consolidate_memory honors since when selecting candidates", async () => {
    const tools = createToolHandlers(store);
    await tools.writeMemory({
      content: "Do not include older duplicates when since is in the future.",
      layer: "recall",
      tags: ["maintenance"],
      sourceType: "manual",
      sourceRef: "test"
    });
    await tools.writeMemory({
      content: "do not include older duplicates when since is in the future",
      layer: "recall",
      tags: ["maintenance"],
      sourceType: "manual",
      sourceRef: "test"
    });

    const result = await tools.consolidateMemory({
      since: new Date(Date.now() + 60_000).toISOString(),
      dryRun: true,
      maxCandidates: 10
    });

    expect(result.structuredContent.proposedMerges).toEqual([]);
  });

  test("memory_digest returns compact relevant context", async () => {
    const tools = createToolHandlers(store);
    await tools.writeMemory({
      content: "The memory sidecar should stay local-first and inspectable.",
      layer: "core",
      tags: ["privacy"],
      sourceType: "manual",
      sourceRef: "test",
      importance: 0.9,
      confidence: 0.9
    });

    const result = await tools.memoryDigest({
      taskDescription: "Check privacy design",
      projectPath: tempDir,
      maxTokens: 200
    });

    expect(result.structuredContent.digest).toContain("local-first");
    expect(result.structuredContent.memories).toHaveLength(1);
  });

  test("memory_digest scopes projectPath lookups", async () => {
    const tools = createToolHandlers(store);
    await tools.writeMemory({
      content: "Digest scoped memory for this project.",
      layer: "recall",
      tags: ["digest"],
      sourceType: "manual",
      sourceRef: "test",
      projectPath: tempDir
    });
    await tools.writeMemory({
      content: "Digest scoped memory for another project.",
      layer: "recall",
      tags: ["digest"],
      sourceType: "manual",
      sourceRef: "test",
      projectScope: "other-project"
    });

    const result = await tools.memoryDigest({
      taskDescription: "Digest scoped memory",
      projectPath: tempDir,
      maxTokens: 200
    });

    expect(result.structuredContent.digest).toContain("this project");
    expect(result.structuredContent.digest).not.toContain("another project");
    expect(result.structuredContent.memories).toHaveLength(1);
  });
});
