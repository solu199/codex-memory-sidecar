import os from "node:os";
import path from "node:path";
import { existsSync, mkdtempSync, rmSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { MemoryStore } from "../src/memory-store.js";

describe("MemoryStore", () => {
  let tempDir: string;
  let store: MemoryStore;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), "codex-memory-sidecar-"));
    store = new MemoryStore(path.join(tempDir, "memory.sqlite"));
  });

  afterEach(() => {
    store.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("creates an active memory and records an audit event", () => {
    const created = store.createMemory({
      content: "User prefers focused TypeScript modules with tests.",
      layer: "core",
      tags: ["preference", "typescript"],
      sourceType: "manual",
      sourceRef: "test",
      importance: 0.9,
      confidence: 0.8
    });

    expect(created.id).toBeGreaterThan(0);
    expect(created.status).toBe("active");
    expect(created.summary).toBe("User prefers focused TypeScript modules with tests.");
    expect(created.tags).toEqual(["preference", "typescript"]);

    const events = store.listEvents(created.id);
    expect(events).toHaveLength(1);
    expect(events[0]?.eventType).toBe("created");
  });

  test("creates missing parent directories for the database path", () => {
    const nestedStore = new MemoryStore(path.join(tempDir, "nested", "data", "memory.sqlite"));

    const created = nestedStore.createMemory({
      content: "Database parent directories should be created automatically.",
      layer: "recall",
      tags: ["setup"],
      sourceType: "manual",
      sourceRef: "test",
      importance: 0.5,
      confidence: 0.8
    });

    expect(created.status).toBe("active");
    nestedStore.close();
  });

  test("updates a memory while preserving event history", () => {
    const created = store.createMemory({
      content: "Use JavaScript for the memory sidecar.",
      layer: "recall",
      tags: ["decision"],
      sourceType: "manual",
      sourceRef: "test",
      importance: 0.5,
      confidence: 0.6
    });

    const updated = store.updateMemory({
      memoryId: created.id,
      newContent: "Use TypeScript for the memory sidecar.",
      updateNote: "Design default changed."
    });

    expect(updated.content).toBe("Use TypeScript for the memory sidecar.");
    expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(created.updatedAt.getTime());

    const events = store.listEvents(created.id);
    expect(events.map((event) => event.eventType)).toEqual(["created", "updated"]);
  });

  test("forgets a memory with a logical delete by default", () => {
    const created = store.createMemory({
      content: "Temporary implementation note.",
      layer: "recall",
      tags: ["temporary"],
      sourceType: "manual",
      sourceRef: "test",
      importance: 0.2,
      confidence: 0.7
    });

    const forgotten = store.forgetMemory({
      memoryId: created.id,
      reason: "No longer useful."
    });

    expect(forgotten.status).toBe("forgotten");
    expect(store.getMemory(created.id)?.status).toBe("forgotten");
    expect(store.listEvents(created.id).at(-1)?.eventType).toBe("forgotten");
  });

  test("refuses hard delete unless it is explicitly confirmed", () => {
    const created = store.createMemory({
      content: "Hard delete should require an explicit confirmation flag.",
      layer: "recall",
      tags: ["safety"],
      sourceType: "manual",
      sourceRef: "test",
      importance: 0.4,
      confidence: 0.8
    });

    expect(() =>
      store.forgetMemory({
        memoryId: created.id,
        reason: "testing hard delete guard",
        hardDelete: true
      })
    ).toThrow(/confirm/i);

    expect(store.getMemory(created.id)?.status).toBe("active");
  });

  test("searches active memories by keyword and excludes forgotten records", () => {
    const first = store.createMemory({
      content: "Ollama embeddings should use embeddinggemma first.",
      layer: "recall",
      tags: ["ollama"],
      sourceType: "manual",
      sourceRef: "test",
      importance: 0.7,
      confidence: 0.9
    });
    const second = store.createMemory({
      content: "Old note about unrelated deployment setup.",
      layer: "recall",
      tags: ["deploy"],
      sourceType: "manual",
      sourceRef: "test",
      importance: 0.4,
      confidence: 0.6
    });
    store.forgetMemory({ memoryId: second.id, reason: "superseded" });

    const results = store.searchMemory({ query: "embeddinggemma", limit: 5 });

    expect(results.map((result) => result.memory.id)).toEqual([first.id]);
    expect(results[0]?.score).toBeGreaterThan(0);
  });

  test("uses query embeddings to find semantically similar memories without keyword overlap", () => {
    const first = store.createMemory({
      content: "Use embeddinggemma for local retrieval.",
      layer: "recall",
      tags: ["ollama"],
      sourceType: "manual",
      sourceRef: "test",
      importance: 0.7,
      confidence: 0.9,
      embedding: [1, 0, 0]
    });
    store.createMemory({
      content: "Prefer compact modules.",
      layer: "core",
      tags: ["style"],
      sourceType: "manual",
      sourceRef: "test",
      importance: 0.7,
      confidence: 0.9,
      embedding: [0, 1, 0]
    });

    const results = store.searchMemory({
      query: "semantic lookup",
      queryEmbedding: [0.95, 0.05, 0],
      limit: 1
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.memory.id).toBe(first.id);
    expect(results[0]?.scoreBreakdown.vector).toBeGreaterThan(0.9);
  });

  test("refuses to store likely secrets unless explicitly overridden", () => {
    expect(() =>
      store.createMemory({
        content: "OPENAI_API_KEY=sk-proj-example123",
        layer: "recall",
        tags: ["secret"],
        sourceType: "manual",
        sourceRef: "test",
        importance: 0.1,
        confidence: 0.9
      })
    ).toThrow(/secret/i);
  });

  test("creates a SQLite backup at the requested path", async () => {
    const created = store.createMemory({
      content: "Backups should preserve local memory records.",
      layer: "recall",
      tags: ["backup"],
      sourceType: "manual",
      sourceRef: "test",
      importance: 0.6,
      confidence: 0.9
    });
    const backupPath = path.join(tempDir, "backups", "memory-backup.sqlite");

    const backup = await store.createBackup({ backupPath });

    expect(backup.backupPath).toBe(backupPath);
    expect(existsSync(backupPath)).toBe(true);

    const backupStore = new MemoryStore(backupPath);
    expect(backupStore.getMemory(created.id)?.content).toBe("Backups should preserve local memory records.");
    backupStore.close();
  });

  test("creates a timestamped backup next to the database when no path is provided", async () => {
    store.createMemory({
      content: "Default backup path should be easy to use.",
      layer: "recall",
      tags: ["backup"],
      sourceType: "manual",
      sourceRef: "test",
      importance: 0.6,
      confidence: 0.9
    });

    const backup = await store.createBackup({});

    expect(backup.backupPath).toContain(path.join(tempDir, "backups"));
    expect(path.basename(backup.backupPath)).toMatch(/^memory-\d{8}-\d{6}-\d{3}(?:-\d+)?\.sqlite$/);
    expect(existsSync(backup.backupPath)).toBe(true);
  });

  test("does not overwrite default backups created in quick succession", async () => {
    store.createMemory({
      content: "Backups created quickly should use distinct paths.",
      layer: "recall",
      tags: ["backup"],
      sourceType: "manual",
      sourceRef: "test",
      importance: 0.6,
      confidence: 0.9
    });

    const first = await store.createBackup({});
    const second = await store.createBackup({});

    expect(second.backupPath).not.toBe(first.backupPath);
    expect(existsSync(first.backupPath)).toBe(true);
    expect(existsSync(second.backupPath)).toBe(true);
  });

  test("lists recent audit events across memories", () => {
    const first = store.createMemory({
      content: "First audited memory.",
      layer: "recall",
      tags: ["audit"],
      sourceType: "manual",
      sourceRef: "test",
      importance: 0.5,
      confidence: 0.8
    });
    const second = store.createMemory({
      content: "Second audited memory.",
      layer: "recall",
      tags: ["audit"],
      sourceType: "manual",
      sourceRef: "test",
      importance: 0.5,
      confidence: 0.8
    });
    store.forgetMemory({ memoryId: first.id, reason: "audit test" });

    const events = store.listRecentEvents({ limit: 2 });

    expect(events).toHaveLength(2);
    expect(events[0]?.eventType).toBe("forgotten");
    expect(events[0]?.memoryId).toBe(first.id);
    expect(events[1]?.eventType).toBe("created");
    expect(events[1]?.memoryId).toBe(second.id);
  });

  test("redacts likely secrets from audit event payloads", () => {
    const created = store.createMemory({
      content: "Audit payload redaction should protect notes.",
      layer: "recall",
      tags: ["audit"],
      sourceType: "manual",
      sourceRef: "test",
      importance: 0.5,
      confidence: 0.8
    });

    store.updateMemory({
      memoryId: created.id,
      newContent: "Audit payload redaction should protect update notes.",
      updateNote: "accidentally pasted OPENAI_API_KEY=sk-proj-secret123456"
    });

    const updatedEvent = store.listEvents(created.id).find((event) => event.eventType === "updated");

    expect(updatedEvent?.payload.updateNote).toBe("[REDACTED_SECRET]");
  });

  test("lists active memories with optional layer filtering", () => {
    const core = store.createMemory({
      content: "Core memory for listing.",
      layer: "core",
      tags: ["list"],
      sourceType: "manual",
      sourceRef: "test",
      importance: 0.5,
      confidence: 0.8
    });
    const recall = store.createMemory({
      content: "Recall memory for listing.",
      layer: "recall",
      tags: ["list"],
      sourceType: "manual",
      sourceRef: "test",
      importance: 0.5,
      confidence: 0.8
    });
    store.forgetMemory({ memoryId: recall.id, reason: "filter forgotten" });

    const memories = store.listMemories({ layers: ["core"] });

    expect(memories.map((memory) => memory.id)).toEqual([core.id]);
  });
});
