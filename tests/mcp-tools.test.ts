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
