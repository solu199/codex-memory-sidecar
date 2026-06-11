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

  test("propose_memory_update recommends creating useful durable memories without writing", async () => {
    const tools = createToolHandlers(store);

    const result = await tools.proposeMemoryUpdate({
      content: "When using Codex Memory Sidecar, call start_memory_session before multi-file work.",
      taskContext: "daily operation rule",
      projectPath: tempDir,
      sourceType: "manual",
      sourceRef: "test"
    });

    expect(result.structuredContent.recommendation).toBe("create");
    expect(result.structuredContent.proposed.layer).toBe("core");
    expect(result.structuredContent.proposed.tags).toEqual(expect.arrayContaining(["daily-operation"]));
    expect(result.structuredContent.duplicateCandidates).toEqual([]);
    expect(result.structuredContent.wouldWrite).toBe(false);
    expect(store.countRecords().memoryCount).toBe(0);
  });

  test("propose_memory_update returns curation guidance for durable core candidates", async () => {
    const tools = createToolHandlers(store);

    const result = await tools.proposeMemoryUpdate({
      content: "Always treat MCP memory as supporting context; prefer README, current files, and git history when they disagree.",
      taskContext: "global memory protocol rule",
      projectPath: tempDir,
      sourceType: "codex-chat",
      sourceRef: "docs/daily-operations.md#memory-priority"
    });

    expect(result.structuredContent.proposed.layer).toBe("core");
    expect(result.structuredContent.curation).toEqual({
      recommendedLayer: "core",
      durability: "durable",
      shouldPromoteToCore: true,
      rationale: expect.arrayContaining(["Content looks like a durable rule or preference."])
    });
  });

  test("propose_memory_update returns provenance guidance for traceable source refs", async () => {
    const tools = createToolHandlers(store);

    const result = await tools.proposeMemoryUpdate({
      content: "The comparison evaluation found sourceRef quality should improve before adding more search features.",
      taskContext: "implementation priority",
      projectPath: tempDir,
      sourceType: "codex-chat",
      sourceRef: "PR #44 / commit ba91c1f / docs/memory-digest-protocol.md"
    });

    expect(result.structuredContent.provenance).toEqual({
      sourceType: "codex-chat",
      sourceRef: "PR #44 / commit ba91c1f / docs/memory-digest-protocol.md",
      quality: "strong",
      recognizedRefs: ["pr", "commit", "doc_path"],
      suggestions: []
    });
  });

  test("propose_memory_update recognizes issue source refs as traceable provenance", async () => {
    const tools = createToolHandlers(store);

    const result = await tools.proposeMemoryUpdate({
      content: "The restore workflow should stay dry-run until the user explicitly approves replacement.",
      taskContext: "issue follow-up",
      projectPath: tempDir,
      sourceType: "github",
      sourceRef: "issue #12"
    });

    expect(result.structuredContent.provenance).toEqual({
      sourceType: "github",
      sourceRef: "issue #12",
      quality: "strong",
      recognizedRefs: ["issue"],
      suggestions: []
    });
  });

  test("propose_memory_update suggests stronger provenance for generic source refs", async () => {
    const tools = createToolHandlers(store);

    const result = await tools.proposeMemoryUpdate({
      content: "Prefer provenance-rich memories for long-lived project decisions.",
      taskContext: "implementation priority",
      projectPath: tempDir,
      sourceType: "manual",
      sourceRef: "test"
    });

    expect(result.structuredContent.provenance.quality).toBe("weak");
    expect(result.structuredContent.provenance.recognizedRefs).toEqual([]);
    expect(result.structuredContent.provenance.suggestions).toEqual(
      expect.arrayContaining([
        "Use a sourceRef that points to a doc path, commit hash, PR number, issue number, or named chat/evaluation id."
      ])
    );
  });

  test("propose_memory_update detects duplicates and recommends update", async () => {
    const tools = createToolHandlers(store);
    const existing = await tools.writeMemory({
      content: "Use start_memory_session before multi-file work.",
      layer: "core",
      tags: ["daily-operation"],
      sourceType: "manual",
      sourceRef: "test",
      projectPath: tempDir
    });

    const result = await tools.proposeMemoryUpdate({
      content: " use start_memory_session before multi-file work ",
      taskContext: "daily operation rule",
      projectPath: tempDir,
      sourceType: "manual",
      sourceRef: "test"
    });

    expect(result.structuredContent.recommendation).toBe("update");
    expect(result.structuredContent.duplicateCandidates).toEqual([
      expect.objectContaining({
        memoryId: existing.structuredContent.memory.id,
        reason: "duplicate_content"
      })
    ]);
    expect(store.countRecords().memoryCount).toBe(1);
  });

  test("propose_memory_update detects near duplicates before writing", async () => {
    const tools = createToolHandlers(store);
    const existing = await tools.writeMemory({
      content: "複数ファイル実装前に start_memory_session を呼ぶ。",
      layer: "core",
      tags: ["daily-operation"],
      sourceType: "manual",
      sourceRef: "test",
      projectPath: tempDir
    });

    const result = await tools.proposeMemoryUpdate({
      content: "複数 file 実装の前は start memory session を呼ぶ。",
      taskContext: "daily operation rule",
      projectPath: tempDir,
      sourceType: "manual",
      sourceRef: "test"
    });

    expect(result.structuredContent.recommendation).toBe("update");
    expect(result.structuredContent.duplicateCandidates).toEqual([
      expect.objectContaining({
        memoryId: existing.structuredContent.memory.id,
        reason: "near_duplicate_content",
        confidence: expect.any(Number)
      })
    ]);
    expect(store.countRecords().memoryCount).toBe(1);
  });

  test("propose_memory_update rejects likely secrets without writing", async () => {
    const tools = createToolHandlers(store);

    const result = await tools.proposeMemoryUpdate({
      content: "OPENAI_API_KEY=sk-proj-this-should-not-be-stored",
      taskContext: "secret test",
      sourceType: "manual",
      sourceRef: "test"
    });

    expect(result.structuredContent.recommendation).toBe("skip");
    expect(result.structuredContent.reasons.join(" ")).toMatch(/secret/i);
    expect(result.structuredContent.wouldWrite).toBe(false);
    expect(store.countRecords().memoryCount).toBe(0);
  });

  test("propose_directive_update asks for scope choice in project context without writing", async () => {
    const tools = createToolHandlers(store);

    const result = await tools.proposeDirectiveUpdate({
      content: "Always prefer the strengthened AGENTS.md memory protocol for this project.",
      taskContext: "project directive update",
      projectPath: tempDir,
      sourceType: "codex-chat",
      sourceRef: "chat:directive-memory-design"
    });

    expect(result.structuredContent.recommendation).toBe("ask_user");
    expect(result.structuredContent.wouldWrite).toBe(false);
    expect(result.structuredContent.scopeGuidance.requiresUserChoice).toBe(true);
    expect(result.structuredContent.scopeGuidance.options.map((option) => option.scope)).toEqual(["project", "global"]);
    expect(result.structuredContent.priorityOrder).toEqual([
      "system/developer",
      "latest_user_instruction",
      "AGENTS.md",
      "directive_memory",
      "normal_memory",
      "inference"
    ]);
    expect(store.listDirectives()).toEqual([]);
  });

  test("propose_directive_update allows durable rules that mention avoiding one-off troubleshooting", async () => {
    const tools = createToolHandlers(store);

    const result = await tools.proposeDirectiveUpdate({
      content:
        "When the same problem recurs, propose capturing the reusable operating pattern as directive memory instead of treating it as one-off troubleshooting.",
      taskContext: "global meta-rule for repeated user corrections",
      preferredScope: "global",
      sourceType: "codex-chat",
      sourceRef: "chat:repeated-pattern-rule"
    });

    expect(result.structuredContent.recommendation).toBe("create");
    expect(result.structuredContent.reasons).not.toContain("Content looks temporary and is too strong for directive memory.");
    expect(result.structuredContent.warnings).toEqual([]);
  });

  test("propose_directive_update still rejects genuinely temporary directive candidates", async () => {
    const tools = createToolHandlers(store);

    const result = await tools.proposeDirectiveUpdate({
      content: "For this scratch run, temporarily use the one-off local port.",
      taskContext: "temporary debugging note",
      preferredScope: "global",
      sourceType: "manual",
      sourceRef: "test"
    });

    expect(result.structuredContent.recommendation).toBe("skip");
    expect(result.structuredContent.reasons).toContain("Content looks temporary and is too strong for directive memory.");
  });

  test("write_directive and list_directives expose active directive contents", async () => {
    const tools = createToolHandlers(store);
    const written = await tools.writeDirective({
      content: "Read directive memory before normal memory.",
      scope: "global",
      rationale: "Memory protocol priority.",
      tags: ["memory-protocol"],
      sourceType: "manual",
      sourceRef: "AGENTS-memory-protocol.md"
    });

    const listed = await tools.listDirectives({ projectPath: tempDir });

    expect(written.structuredContent.directive).toMatchObject({
      id: expect.any(Number),
      scope: "global",
      projectScope: "global",
      content: "Read directive memory before normal memory.",
      status: "active"
    });
    expect(listed.structuredContent.directives).toEqual([written.structuredContent.directive]);
  });

  test("disable_directive hides the directive from normal listings", async () => {
    const tools = createToolHandlers(store);
    const written = await tools.writeDirective({
      content: "Disable this directive after testing.",
      scope: "global",
      rationale: "Disable flow.",
      sourceType: "manual",
      sourceRef: "test"
    });

    const disabled = await tools.disableDirective({
      directiveId: written.structuredContent.directive.id,
      reason: "test complete"
    });

    expect(disabled.structuredContent.directive.status).toBe("disabled");
    expect((await tools.listDirectives({})).structuredContent.directives).toEqual([]);
    expect((await tools.listDirectives({ includeDisabled: true })).structuredContent.directives[0]?.status).toBe("disabled");
  });

  test("write_memory duplicate candidates stay within project scope plus global memories", async () => {
    const tools = createToolHandlers(store);
    await tools.writeMemory({
      content: "Scoped duplicate candidate.",
      layer: "core",
      tags: ["scope"],
      sourceType: "manual",
      sourceRef: "test",
      projectScope: "alpha"
    });

    const beta = await tools.writeMemory({
      content: "Scoped duplicate candidate.",
      layer: "core",
      tags: ["scope"],
      sourceType: "manual",
      sourceRef: "test",
      projectScope: "beta"
    });

    expect(beta.structuredContent.duplicateCandidates).toEqual([]);
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

  test("list_memory_summaries can scope results", async () => {
    const tools = createToolHandlers(store);
    await tools.writeMemory({
      content: "Alpha summary should be listed.",
      layer: "recall",
      tags: ["summary"],
      sourceType: "manual",
      sourceRef: "test",
      projectScope: "alpha"
    });
    await tools.writeMemory({
      content: "Beta summary should stay hidden.",
      layer: "recall",
      tags: ["summary"],
      sourceType: "manual",
      sourceRef: "test",
      projectScope: "beta"
    });

    const result = await tools.listMemorySummaries({
      projectScope: "alpha",
      limit: 10
    });

    expect(result.structuredContent.memories).toHaveLength(1);
    expect(result.structuredContent.memories[0]?.projectScope).toBe("alpha");
    expect(result.structuredContent.memories[0]?.summary).toContain("Alpha");
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

  test("write_memory and search_memory use FTS quietly when optional embeddings fail", async () => {
    const tools = createToolHandlers(store, {
      embeddingProvider: { embed: vi.fn(async () => Promise.reject(new Error("Ollama offline"))) },
      embeddingRequired: false
    });

    const written = await tools.writeMemory({
      content: "Keyword fallback should stay useful without Ollama.",
      layer: "recall",
      tags: ["fallback"],
      sourceType: "manual",
      sourceRef: "test"
    });
    const searched = await tools.searchMemory({
      query: "Keyword fallback",
      limit: 5
    });

    expect(written.structuredContent.memory.embedding).toBeNull();
    expect(written.structuredContent.warnings).toEqual([]);
    expect(searched.structuredContent.memories[0]?.summary).toContain("Keyword fallback");
    expect(searched.structuredContent.warnings).toEqual([]);
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

  test("health_check treats unavailable optional embeddings as non-blocking", async () => {
    const tools = createToolHandlers(store, {
      embeddingProvider: { embed: vi.fn(async () => Promise.reject(new Error("Ollama offline"))) },
      embeddingRequired: false
    });

    const result = await tools.healthCheck({});

    expect(result.structuredContent.ok).toBe(true);
    expect(result.structuredContent.database.ok).toBe(true);
    expect(result.structuredContent.embedding.ok).toBe(true);
    expect(result.structuredContent.embedding.required).toBe(false);
    expect(result.structuredContent.embedding.error).toContain("Ollama offline");
    expect(result.structuredContent.warnings).toEqual([]);
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

  test("start_memory_session returns health stats and digest without full memory content", async () => {
    const tools = createToolHandlers(store);
    store.createMemory({
      content: "Daily startup private body should not be returned in session summaries.",
      summary: "Use daily startup digest before multi-file work.",
      layer: "core",
      tags: ["daily"],
      sourceType: "manual",
      sourceRef: "test",
      projectPath: tempDir
    });

    const result = await tools.startMemorySession({
      taskDescription: "daily startup digest",
      projectPath: tempDir,
      maxTokens: 200
    });

    expect(result.structuredContent.ready).toBe(true);
    expect(result.structuredContent.health.database.ok).toBe(true);
    expect(result.structuredContent.memoryStats.memoryCount).toBe(1);
    expect(result.structuredContent.digest).toContain("daily startup digest");
    expect(result.structuredContent.memories).toEqual([
      expect.objectContaining({
        layer: "core",
        summary: "Use daily startup digest before multi-file work.",
        tags: ["daily"]
      })
    ]);
    expect(JSON.stringify(result.structuredContent)).not.toContain("Daily startup private body");
  });

  test("start_memory_session returns memory freshness and safe update candidates", async () => {
    const tools = createToolHandlers(store, {
      autoMemoryWrite: "review",
      now: new Date("2026-06-20T03:20:00Z"),
      workspaceActivity: {
        commits: [
          {
            hash: "92e5fcb1234567890",
            subject: "Ollama表示と手動MCP例を改善",
            committedAt: new Date("2026-06-20T03:00:20Z")
          }
        ],
        pullRequests: [
          {
            number: 77,
            title: "Ollama表示と手動MCP例を改善",
            mergedAt: new Date("2026-06-20T03:00:20Z")
          }
        ]
      }
    });
    store.createMemory({
      content: "Older memory before recent work.",
      summary: "Older saved memory",
      layer: "recall",
      tags: ["freshness"],
      sourceType: "manual",
      sourceRef: "test",
      projectPath: tempDir
    });

    const result = await tools.startMemorySession({
      taskDescription: "check memory freshness",
      projectPath: tempDir
    });

    expect(result.structuredContent.memoryFreshness).toMatchObject({
      status: "stale",
      latestWorkspaceActivityAt: "2026-06-20T03:00:20.000Z",
      candidateCount: 2
    });
    expect(result.structuredContent.memoryUpdateCandidates).toEqual([
      expect.objectContaining({
        kind: "pull_request",
        sourceRef: "pr:#77",
        suggestedTool: "propose_memory_update"
      }),
      expect.objectContaining({
        kind: "commit",
        sourceRef: "git:92e5fcb",
        suggestedTool: "propose_memory_update"
      }),
      expect.objectContaining({
        kind: "session",
        sourceRef: "session:2026-06-20T03:20:00.000Z",
        suggestedTool: "propose_memory_update"
      })
    ]);
  });

  test("start_memory_session safe auto-writes high confidence curation candidates with audit details", async () => {
    const tools = createToolHandlers(store, {
      autoMemoryWrite: "safe",
      now: new Date("2026-06-20T03:20:00Z"),
      workspaceActivity: {
        pullRequests: [
          {
            number: 79,
            title: "メモリ鮮度と保存候補を表示",
            mergedAt: new Date("2026-06-20T03:00:20Z")
          }
        ]
      }
    });
    store.createMemory({
      content: "Older memory before recent work.",
      summary: "Older saved memory",
      layer: "recall",
      tags: ["freshness"],
      sourceType: "manual",
      sourceRef: "test",
      projectPath: tempDir
    });

    const result = await tools.startMemorySession({
      taskDescription: "check auto memory curation",
      projectPath: tempDir
    });

    expect(result.structuredContent.autoMemoryCuration.mode).toBe("safe");
    expect(result.structuredContent.autoMemoryCuration.autoWrittenMemories).toEqual([
      expect.objectContaining({
        sourceRef: "pr:#79",
        score: expect.any(Number)
      })
    ]);
    expect(result.structuredContent.memoryUpdateCandidates).toEqual([
      expect.objectContaining({ kind: "session" })
    ]);

    const audit = await tools.auditMemory({ limit: 10 });
    expect(JSON.stringify(audit.structuredContent.events)).toContain("autoCuration");
    expect(JSON.stringify(audit.structuredContent.events)).toContain("pr:#79");
  });

  test("start_memory_session safe mode keeps duplicate candidates in review", async () => {
    const tools = createToolHandlers(store, {
      autoMemoryWrite: "safe",
      now: new Date("2026-06-20T03:20:00Z"),
      workspaceActivity: {
        pullRequests: [
          {
            number: 79,
            title: "メモリ鮮度と保存候補を表示",
            mergedAt: new Date("2026-06-20T03:00:20Z")
          }
        ]
      }
    });
    store.createMemory({
      content: "PR memory candidate: PR #79: メモリ鮮度と保存候補を表示. Reason: already saved.",
      summary: "PR #79: メモリ鮮度と保存候補を表示",
      layer: "recall",
      tags: ["auto-curated"],
      sourceType: "github-pr",
      sourceRef: "pr:#79",
      projectPath: tempDir
    });

    const result = await tools.startMemorySession({
      taskDescription: "check auto memory curation duplicates",
      projectPath: tempDir
    });

    expect(result.structuredContent.autoMemoryCuration.autoWrittenMemories).toEqual([]);
    expect(result.structuredContent.memoryUpdateCandidates).toEqual([
      expect.objectContaining({ sourceRef: "pr:#79" }),
      expect.objectContaining({ kind: "session" })
    ]);
  });

  test("start_memory_session returns directive memory and priority guidance", async () => {
    const tools = createToolHandlers(store);
    await tools.writeDirective({
      content: "Global directive: read directive memory before normal memory.",
      scope: "global",
      rationale: "Memory protocol.",
      sourceType: "manual",
      sourceRef: "AGENTS-memory-protocol.md"
    });
    await tools.writeDirective({
      content: "Project directive: keep this repository README in Japanese.",
      scope: "project",
      projectPath: tempDir,
      rationale: "Project documentation preference.",
      sourceType: "manual",
      sourceRef: "README.md"
    });

    const result = await tools.startMemorySession({
      taskDescription: "update README",
      projectPath: tempDir
    });

    expect(result.structuredContent.directives.map((directive) => directive.content)).toEqual([
      "Project directive: keep this repository README in Japanese.",
      "Global directive: read directive memory before normal memory."
    ]);
    expect(result.structuredContent.sessionGuidance.priorityOrder).toEqual([
      "system/developer",
      "latest_user_instruction",
      "AGENTS.md",
      "directive_memory",
      "normal_memory",
      "inference"
    ]);
  });

  test("start_memory_session returns guidance that prevents over-trusting memory", async () => {
    const tools = createToolHandlers(store);
    store.createMemory({
      content: "MCP memories are supporting context and current files remain the source of truth.",
      summary: "Treat MCP memory as supporting context, not the source of truth.",
      layer: "core",
      tags: ["provenance"],
      sourceType: "manual",
      sourceRef: "docs/daily-operations.md",
      projectPath: tempDir
    });

    const result = await tools.startMemorySession({
      taskDescription: "decide next implementation priority from memory and docs",
      projectPath: tempDir,
      maxTokens: 200
    });

    expect(result.structuredContent.sessionGuidance).toEqual({
      memoryUse: "supporting_context",
      canAnswer: expect.arrayContaining([
        "Relevant saved memory summaries and their sourceRefs can inform this task."
      ]),
      mustVerify: expect.arrayContaining([
        "Validate memory-derived claims against the user's latest instruction, README/docs, actual files, or git history before treating them as facts."
      ]),
      limitations: expect.arrayContaining([
        "The digest may omit relevant memories when the query is too narrow or the database has not captured the decision yet."
      ]),
      priorityOrder: expect.arrayContaining(["directive_memory", "normal_memory"]),
      suggestedNextTools: expect.arrayContaining(["list_directives", "read_memory", "audit_memory"])
    });
  });

  test("start_memory_session reports backup retention summary without deleting backups", async () => {
    const tools = createToolHandlers(store);
    await tools.writeMemory({
      content: "Session startup should surface backup retention status.",
      layer: "recall",
      tags: ["daily", "backup"],
      sourceType: "manual",
      sourceRef: "test"
    });
    const first = await tools.backupMemory({});
    const second = await tools.backupMemory({});

    const result = await tools.startMemorySession({
      taskDescription: "daily backup status",
      projectPath: tempDir
    });

    expect(result.structuredContent.backupRetention).toMatchObject({
      backupDir: path.join(tempDir, "backups"),
      keepCount: 10,
      backupCount: 2,
      keptCount: 2,
      prunableCount: 0,
      prunableSizeBytes: 0,
      wouldDelete: false,
      latestBackup: expect.objectContaining({
        backupPath: second.structuredContent.backupPath,
        sizeBytes: expect.any(Number),
        mtime: expect.any(String)
      })
    });
    expect(existsSync(first.structuredContent.backupPath)).toBe(true);
    expect(existsSync(second.structuredContent.backupPath)).toBe(true);
  });

  test("start_memory_session skips digest and recommends repair when database health is not ok", async () => {
    const tools = createToolHandlers(store);
    const created = await tools.writeMemory({
      content: "Broken FTS should not be queried during session start.",
      layer: "recall",
      tags: ["daily"],
      sourceType: "manual",
      sourceRef: "test"
    });
    const db = new Database(path.join(tempDir, "memory.sqlite"));
    try {
      db.prepare("DELETE FROM memories_fts WHERE rowid = ?").run(created.structuredContent.memory.id);
    } finally {
      db.close();
    }

    const result = await tools.startMemorySession({
      taskDescription: "broken FTS startup",
      projectPath: tempDir
    });

    expect(result.structuredContent.ready).toBe(false);
    expect(result.structuredContent.repairRecommended).toBe(true);
    expect(result.structuredContent.digest).toBe("");
    expect(result.structuredContent.memories).toEqual([]);
    expect(result.structuredContent.warnings).toContain("FTS index is missing 1 active memory row(s).");
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

  test("plan_backup_retention reports kept and prunable default backups without deleting files", async () => {
    const tools = createToolHandlers(store);
    await tools.writeMemory({
      content: "Retention planning should not delete backup files.",
      layer: "recall",
      tags: ["backup"],
      sourceType: "manual",
      sourceRef: "test"
    });
    const first = await tools.backupMemory({});
    const second = await tools.backupMemory({});

    const result = await tools.planBackupRetention({ keepCount: 1 });

    expect(result.structuredContent.backupDir).toBe(path.join(tempDir, "backups"));
    expect(result.structuredContent.keepCount).toBe(1);
    expect(result.structuredContent.backups).toHaveLength(2);
    expect(result.structuredContent.kept).toEqual([
      expect.objectContaining({
        backupPath: second.structuredContent.backupPath,
        sizeBytes: expect.any(Number),
        mtime: expect.any(String)
      })
    ]);
    expect(result.structuredContent.prunable).toEqual([
      expect.objectContaining({
        backupPath: first.structuredContent.backupPath,
        sizeBytes: expect.any(Number),
        mtime: expect.any(String)
      })
    ]);
    expect(result.structuredContent.wouldDelete).toBe(false);
    expect(result.structuredContent.plannedAt).toEqual(expect.any(String));
    expect(existsSync(first.structuredContent.backupPath)).toBe(true);
    expect(existsSync(second.structuredContent.backupPath)).toBe(true);
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

  test("plan_backup_restore compares current database with a backup without restoring", async () => {
    const tools = createToolHandlers(store);
    await tools.writeMemory({
      content: "Backup restore plan should inspect the backup.",
      layer: "recall",
      tags: ["backup"],
      sourceType: "manual",
      sourceRef: "test"
    });
    const backup = await tools.backupMemory({});
    await tools.writeMemory({
      content: "Current database has newer data after the backup.",
      layer: "recall",
      tags: ["backup"],
      sourceType: "manual",
      sourceRef: "test"
    });

    const result = await tools.planBackupRestore({
      backupPath: backup.structuredContent.backupPath
    });

    expect(result.structuredContent).toMatchObject({
      backupPath: backup.structuredContent.backupPath,
      ok: true,
      wouldRestore: false,
      requiresMcpRestart: true,
      current: {
        databaseOk: true,
        memoryCount: 2,
        eventCount: 2
      },
      backup: {
        ok: true,
        memoryCount: 1,
        eventCount: 1
      },
      warnings: []
    });
    expect(result.structuredContent.steps).toEqual([
      expect.stringContaining("Stop"),
      expect.stringContaining("Create"),
      expect.stringContaining("Replace"),
      expect.stringContaining("Restart"),
      expect.stringContaining("health_check")
    ]);
    expect(store.countRecords().memoryCount).toBe(2);
  });

  test("repair_memory_index rebuilds FTS and returns backup details", async () => {
    const tools = createToolHandlers(store);
    const created = await tools.writeMemory({
      content: "MCP repair should restore keyword search.",
      layer: "recall",
      tags: ["repair"],
      sourceType: "manual",
      sourceRef: "test"
    });
    const db = new Database(path.join(tempDir, "memory.sqlite"));
    try {
      db.prepare("DELETE FROM memories_fts WHERE rowid = ?").run(created.structuredContent.memory.id);
    } finally {
      db.close();
    }

    const result = await tools.repairMemoryIndex({});

    expect(result.structuredContent.repaired).toBe(true);
    expect(result.structuredContent.backupPath).toContain(path.join(tempDir, "backups"));
    expect(result.structuredContent.backupVerification?.ok).toBe(true);
    expect(result.structuredContent.before.fts.missingCount).toBe(1);
    expect(result.structuredContent.after.ok).toBe(true);
    expect(result.structuredContent.after.fts.missingCount).toBe(0);
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
        tags: ["backup"],
        projectScope: "global"
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

  test("inspect_backup can scope backup summaries", async () => {
    const tools = createToolHandlers(store);
    const alpha = await tools.writeMemory({
      content: "Alpha backup scope summary.",
      layer: "recall",
      tags: ["backup"],
      sourceType: "manual",
      sourceRef: "test",
      projectScope: "alpha"
    });
    await tools.writeMemory({
      content: "Beta backup scope summary.",
      layer: "recall",
      tags: ["backup"],
      sourceType: "manual",
      sourceRef: "test",
      projectScope: "beta"
    });
    const backup = await tools.backupMemory({});

    const result = await tools.inspectBackup({
      backupPath: backup.structuredContent.backupPath,
      projectScope: "alpha",
      limit: 10
    });

    expect(result.structuredContent.memories).toEqual([
      expect.objectContaining({
        id: alpha.structuredContent.memory.id,
        projectScope: "alpha",
        summary: "Alpha backup scope summary."
      })
    ]);
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

  test("consolidate_memory proposes near-duplicate records with shared terms", async () => {
    const tools = createToolHandlers(store);
    const first = await tools.writeMemory({
      content: "Call start_memory_session before multi-file implementation work.",
      layer: "core",
      tags: ["daily-operation", "memory"],
      sourceType: "manual",
      sourceRef: "test"
    });
    const second = await tools.writeMemory({
      content: "Before multi file implementation work, call start memory session.",
      layer: "core",
      tags: ["daily-operation", "memory"],
      sourceType: "manual",
      sourceRef: "test"
    });

    const result = await tools.consolidateMemory({
      layers: ["core"],
      dryRun: true,
      maxCandidates: 10
    });

    expect(result.structuredContent.proposedMerges).toEqual([
      {
        memoryIds: [first.structuredContent.memory.id, second.structuredContent.memory.id],
        reason: "near_duplicate_content",
        summary: "Call start_memory_session before multi-file implementation work.",
        confidence: expect.any(Number)
      }
    ]);
    expect(store.getMemory(second.structuredContent.memory.id)?.status).toBe("active");
  });

  test("consolidate_memory proposes near-duplicate Japanese records", async () => {
    const tools = createToolHandlers(store);
    const first = await tools.writeMemory({
      content: "複数ファイル実装前に start_memory_session を呼ぶ。",
      layer: "core",
      tags: ["daily-operation", "memory"],
      sourceType: "manual",
      sourceRef: "test"
    });
    const second = await tools.writeMemory({
      content: "複数 file 実装の前は start memory session を呼ぶ。",
      layer: "core",
      tags: ["daily-operation", "memory"],
      sourceType: "manual",
      sourceRef: "test"
    });

    const result = await tools.consolidateMemory({
      layers: ["core"],
      dryRun: true,
      maxCandidates: 10
    });

    expect(result.structuredContent.proposedMerges).toEqual([
      expect.objectContaining({
        memoryIds: [first.structuredContent.memory.id, second.structuredContent.memory.id],
        reason: "near_duplicate_content"
      })
    ]);
  });

  test("consolidate_memory keeps duplicate proposals inside project scope", async () => {
    const tools = createToolHandlers(store);
    await tools.writeMemory({
      content: "Scoped consolidation candidate.",
      layer: "core",
      tags: ["safety"],
      sourceType: "manual",
      sourceRef: "test",
      projectScope: "alpha"
    });
    await tools.writeMemory({
      content: "scoped consolidation candidate",
      layer: "core",
      tags: ["safety"],
      sourceType: "manual",
      sourceRef: "test",
      projectScope: "beta"
    });

    const result = await tools.consolidateMemory({
      projectScope: "alpha",
      dryRun: true,
      maxCandidates: 10
    });

    expect(result.structuredContent.proposedMerges).toEqual([]);
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

  test("memory_digest supports projectScope without embedding raw projectPath", async () => {
    const embedder = { embed: vi.fn(async () => [1, 0]) };
    const tools = createToolHandlers(store, { embeddingProvider: embedder });
    await tools.writeMemory({
      content: "Project scope digest memory.",
      layer: "recall",
      tags: ["digest"],
      sourceType: "manual",
      sourceRef: "test",
      projectScope: "alpha"
    });
    await tools.writeMemory({
      content: "Other scope digest memory.",
      layer: "recall",
      tags: ["digest"],
      sourceType: "manual",
      sourceRef: "test",
      projectScope: "beta"
    });

    const result = await tools.memoryDigest({
      taskDescription: "Project scope digest",
      projectScope: "alpha",
      projectPath: tempDir,
      maxTokens: 200
    });
    const retrievedEvents = store.listRecentEvents({ limit: 10 }).filter((event) => event.eventType === "retrieved");

    expect(embedder.embed).toHaveBeenLastCalledWith("Project scope digest");
    expect(result.structuredContent.digest).toContain("Project scope");
    expect(result.structuredContent.digest).not.toContain("Other scope");
    expect(JSON.stringify(retrievedEvents[0]?.payload)).not.toContain(tempDir);
  });
});
