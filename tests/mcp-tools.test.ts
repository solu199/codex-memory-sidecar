import os from "node:os";
import path from "node:path";
import { existsSync, mkdtempSync, rmSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

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
    expect(result.structuredContent.memory.embedding).toEqual([1, 0]);
    expect(result.structuredContent.duplicateCandidates).toEqual([]);
    expect(result.content[0]?.type).toBe("text");
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
    expect(result.structuredContent.warnings).toEqual([]);
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
});
