import os from "node:os";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

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
    const tools = createToolHandlers(store);

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
