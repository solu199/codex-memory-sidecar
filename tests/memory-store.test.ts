import os from "node:os";
import path from "node:path";
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, test } from "vitest";
import Database from "better-sqlite3";

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

  test("creates indexes for common status layer and recency queries", () => {
    const db = new Database(path.join(tempDir, "memory.sqlite"), { readonly: true, fileMustExist: true });
    try {
      const indexes = db.prepare("PRAGMA index_list(memories)").all() as { name: string }[];

      expect(indexes.map((index) => index.name)).toEqual(
        expect.arrayContaining([
          "idx_memories_status_updated",
          "idx_memories_layer_status",
          "idx_memories_active_embedding_candidates"
        ])
      );
    } finally {
      db.close();
    }
  });

  test("checks active database integrity and FTS consistency", () => {
    store.createMemory({
      content: "Database health should include FTS consistency.",
      layer: "recall",
      tags: ["health"],
      sourceType: "manual",
      sourceRef: "test",
      importance: 0.5,
      confidence: 0.8
    });

    const health = store.checkDatabaseHealth();

    expect(health.ok).toBe(true);
    expect(health.integrityCheck).toBe("ok");
    expect(health.fts).toMatchObject({
      ok: true,
      expectedCount: 1,
      indexedCount: 1,
      missingCount: 0,
      orphanCount: 0
    });
    expect(health.walCheckpoint.busy).toBe(0);
    expect(health.warnings).toEqual([]);
    expect(health.checkedAt).toBeInstanceOf(Date);
  });

  test("reports missing FTS rows in database health", () => {
    const created = store.createMemory({
      content: "Missing FTS rows should be visible.",
      layer: "recall",
      tags: ["health"],
      sourceType: "manual",
      sourceRef: "test",
      importance: 0.5,
      confidence: 0.8
    });
    const db = new Database(path.join(tempDir, "memory.sqlite"));
    try {
      db.prepare("DELETE FROM memories_fts WHERE rowid = ?").run(created.id);
    } finally {
      db.close();
    }

    const health = store.checkDatabaseHealth();

    expect(health.ok).toBe(false);
    expect(health.fts).toMatchObject({
      ok: false,
      expectedCount: 1,
      indexedCount: 0,
      missingCount: 1,
      orphanCount: 0
    });
    expect(health.warnings).toContain("FTS index is missing 1 active memory row(s).");
  });

  test("updates a memory while preserving event history", () => {
    const created = store.createMemory({
      content: "Use JavaScript for the memory sidecar.",
      layer: "recall",
      tags: ["decision"],
      sourceType: "manual",
      sourceRef: "test",
      embedding: [1, 0],
      importance: 0.5,
      confidence: 0.6
    });

    const updated = store.updateMemory({
      memoryId: created.id,
      newContent: "Use TypeScript for the memory sidecar.",
      updateNote: "Design default changed.",
      embedding: [0, 1]
    });

    expect(updated.content).toBe("Use TypeScript for the memory sidecar.");
    expect(updated.embedding).toEqual([0, 1]);
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

  test("applies tag filters before final keyword search limit", () => {
    store.createMemory({
      content: "Shared search phrase.",
      layer: "recall",
      tags: ["other"],
      sourceType: "manual",
      sourceRef: "test",
      importance: 0.9,
      confidence: 0.9
    });
    const tagged = store.createMemory({
      content: "Shared search phrase.",
      layer: "recall",
      tags: ["target"],
      sourceType: "manual",
      sourceRef: "test",
      importance: 0.1,
      confidence: 0.9
    });

    const results = store.searchMemory({
      query: "shared search phrase",
      tags: ["target"],
      limit: 1
    });

    expect(results.map((result) => result.memory.id)).toEqual([tagged.id]);
  });

  test("scopes keyword search to the requested project plus global memories", () => {
    const global = store.createMemory({
      content: "Shared scoped lookup policy.",
      layer: "core",
      tags: ["scope"],
      sourceType: "manual",
      sourceRef: "test"
    });
    const sameProject = store.createMemory({
      content: "Shared scoped lookup policy for project alpha.",
      layer: "recall",
      tags: ["scope"],
      sourceType: "manual",
      sourceRef: "test",
      projectScope: "alpha"
    });
    store.createMemory({
      content: "Shared scoped lookup policy for project beta.",
      layer: "recall",
      tags: ["scope"],
      sourceType: "manual",
      sourceRef: "test",
      projectScope: "beta"
    });

    const results = store.searchMemory({
      query: "shared scoped lookup policy",
      projectScope: "alpha",
      limit: 10
    });

    expect(results.map((result) => result.memory.id)).toEqual([global.id, sameProject.id]);
    expect(results.map((result) => result.memory.projectScope)).toEqual(["global", "alpha"]);
  });

  test("scopes hybrid search before vector scoring", () => {
    const sameProject = store.createMemory({
      content: "Semantic scoped memory for alpha.",
      layer: "recall",
      tags: ["scope"],
      sourceType: "manual",
      sourceRef: "test",
      projectScope: "alpha",
      embedding: [1, 0, 0]
    });
    store.createMemory({
      content: "Semantic scoped memory for beta.",
      layer: "recall",
      tags: ["scope"],
      sourceType: "manual",
      sourceRef: "test",
      projectScope: "beta",
      embedding: [1, 0, 0]
    });

    const results = store.searchMemory({
      query: "semantic scoped",
      queryEmbedding: [1, 0, 0],
      projectScope: "alpha",
      limit: 10
    });

    expect(results.map((result) => result.memory.id)).toEqual([sameProject.id]);
  });

  test("records one retrieved audit event per keyword search", () => {
    const first = store.createMemory({
      content: "Shared audit lookup phrase.",
      layer: "recall",
      tags: ["audit"],
      sourceType: "manual",
      sourceRef: "test",
      importance: 0.9,
      confidence: 0.9
    });
    const second = store.createMemory({
      content: "Shared audit lookup phrase with another detail.",
      layer: "recall",
      tags: ["audit"],
      sourceType: "manual",
      sourceRef: "test",
      importance: 0.4,
      confidence: 0.9
    });

    const results = store.searchMemory({ query: "shared audit lookup phrase", limit: 2 });
    const retrievedEvents = store.listRecentEvents({ limit: 10 }).filter((event) => event.eventType === "retrieved");

    expect(results.map((result) => result.memory.id)).toEqual([first.id, second.id]);
    expect(retrievedEvents).toHaveLength(1);
    expect(retrievedEvents[0]?.memoryId).toBe(first.id);
    expect(retrievedEvents[0]?.payload).toEqual({
      query: "shared audit lookup phrase",
      resultCount: 2,
      memoryIds: [first.id, second.id]
    });
    expect(store.getMemory(first.id)?.lastAccessedAt).toBeInstanceOf(Date);
    expect(store.getMemory(second.id)?.lastAccessedAt).toBeInstanceOf(Date);
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

  test("records one retrieved audit event per hybrid search", () => {
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
    const second = store.createMemory({
      content: "Use local embeddings for memory recall.",
      layer: "recall",
      tags: ["ollama"],
      sourceType: "manual",
      sourceRef: "test",
      importance: 0.5,
      confidence: 0.9,
      embedding: [0.9, 0.1, 0]
    });

    const results = store.searchMemory({
      query: "semantic lookup",
      queryEmbedding: [0.95, 0.05, 0],
      limit: 2
    });
    const retrievedEvents = store.listRecentEvents({ limit: 10 }).filter((event) => event.eventType === "retrieved");

    expect(results.map((result) => result.memory.id)).toEqual([first.id, second.id]);
    expect(retrievedEvents).toHaveLength(1);
    expect(retrievedEvents[0]?.memoryId).toBe(first.id);
    expect(retrievedEvents[0]?.payload).toEqual({
      query: "semantic lookup",
      hybrid: true,
      resultCount: 2,
      memoryIds: [first.id, second.id]
    });
    expect(store.getMemory(first.id)?.lastAccessedAt).toBeInstanceOf(Date);
    expect(store.getMemory(second.id)?.lastAccessedAt).toBeInstanceOf(Date);
  });

  test("caps the non-keyword hybrid candidate pool before vector scoring", () => {
    const staleCandidate = store.createMemory({
      content: "High importance but unrelated vector candidate.",
      layer: "recall",
      tags: ["candidate"],
      sourceType: "manual",
      sourceRef: "test",
      importance: 0.9,
      confidence: 0.9,
      embedding: [0, 1, 0]
    });
    store.createMemory({
      content: "Low importance vector-only note.",
      layer: "recall",
      tags: ["candidate"],
      sourceType: "manual",
      sourceRef: "test",
      importance: 0.1,
      confidence: 0.9,
      embedding: [1, 0, 0]
    });

    const results = store.searchMemory({
      query: "semantic lookup",
      queryEmbedding: [1, 0, 0],
      limit: 5,
      hybridCandidateLimit: 1
    });

    expect(results.map((result) => result.memory.id)).toEqual([staleCandidate.id]);
  });

  test("keeps keyword matches in hybrid search even outside the vector candidate pool", () => {
    store.createMemory({
      content: "High importance unrelated vector candidate.",
      layer: "recall",
      tags: ["candidate"],
      sourceType: "manual",
      sourceRef: "test",
      importance: 0.9,
      confidence: 0.9,
      embedding: [0, 1, 0]
    });
    const keywordCandidate = store.createMemory({
      content: "Hybrid keyword rescue candidate.",
      layer: "recall",
      tags: ["candidate"],
      sourceType: "manual",
      sourceRef: "test",
      importance: 0.1,
      confidence: 0.9,
      embedding: [1, 0, 0]
    });

    const results = store.searchMemory({
      query: "hybrid keyword rescue",
      queryEmbedding: [0, 1, 0],
      limit: 5,
      hybridCandidateLimit: 1
    });

    expect(results.map((result) => result.memory.id)).toContain(keywordCandidate.id);
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

  test("plans default backup retention without deleting files", () => {
    const backupDir = path.join(tempDir, "backups");
    const oldest = createBackupFixture(backupDir, "memory-20260514-010000-000.sqlite", "oldest", new Date("2026-05-14T01:00:00Z"));
    const middle = createBackupFixture(backupDir, "memory-20260514-020000-000.sqlite", "middle", new Date("2026-05-14T02:00:00Z"));
    const newest = createBackupFixture(backupDir, "memory-20260514-030000-000.sqlite", "newest", new Date("2026-05-14T03:00:00Z"));

    const plan = store.planBackupRetention({ keepCount: 2 });

    expect(plan.backupDir).toBe(backupDir);
    expect(plan.keepCount).toBe(2);
    expect(plan.backups.map((backup) => backup.backupPath)).toEqual([newest, middle, oldest]);
    expect(plan.kept.map((backup) => backup.backupPath)).toEqual([newest, middle]);
    expect(plan.prunable.map((backup) => backup.backupPath)).toEqual([oldest]);
    expect(plan.prunable[0]?.sizeBytes).toBe(Buffer.byteLength("oldest"));
    expect(plan.prunable[0]?.mtime).toEqual(new Date("2026-05-14T01:00:00Z"));
    expect(existsSync(oldest)).toBe(true);
    expect(existsSync(middle)).toBe(true);
    expect(existsSync(newest)).toBe(true);
  });

  test("plans retention only for default backup file names", () => {
    const backupDir = path.join(tempDir, "backups");
    const defaultBackup = createBackupFixture(
      backupDir,
      "memory-20260514-010000-000.sqlite",
      "default",
      new Date("2026-05-14T01:00:00Z")
    );
    createBackupFixture(backupDir, "memory-manual.sqlite", "manual", new Date("2026-05-14T02:00:00Z"));
    createBackupFixture(backupDir, "not-memory-20260514-030000-000.sqlite", "other", new Date("2026-05-14T03:00:00Z"));

    const plan = store.planBackupRetention({ keepCount: 0 });

    expect(plan.backups.map((backup) => backup.backupPath)).toEqual([defaultBackup]);
    expect(plan.kept).toEqual([]);
    expect(plan.prunable.map((backup) => backup.backupPath)).toEqual([defaultBackup]);
  });

  test("verifies a readable SQLite backup without modifying the active store", async () => {
    const created = store.createMemory({
      content: "Backup verification should be read-only.",
      layer: "recall",
      tags: ["backup"],
      sourceType: "manual",
      sourceRef: "test",
      importance: 0.6,
      confidence: 0.9
    });
    const backup = await store.createBackup({});

    const result = store.verifyBackup({ backupPath: backup.backupPath });

    expect(result.backupPath).toBe(backup.backupPath);
    expect(result.ok).toBe(true);
    expect(result.memoryCount).toBe(1);
    expect(result.eventCount).toBe(1);
    expect(result.integrityCheck).toBe("ok");
    expect(result.schemaOk).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(result.checkedAt).toBeInstanceOf(Date);
    expect(store.getMemory(created.id)?.content).toBe("Backup verification should be read-only.");
  });

  test("reports invalid backup schema without modifying the active store", () => {
    const created = store.createMemory({
      content: "Backup schema verification should be read-only.",
      layer: "recall",
      tags: ["backup"],
      sourceType: "manual",
      sourceRef: "test",
      importance: 0.6,
      confidence: 0.9
    });
    const invalidBackupPath = path.join(tempDir, "invalid-backup.sqlite");
    const invalidDb = new Database(invalidBackupPath);
    invalidDb.exec("CREATE TABLE unrelated (id INTEGER PRIMARY KEY)");
    invalidDb.close();

    const result = store.verifyBackup({ backupPath: invalidBackupPath });

    expect(result.ok).toBe(false);
    expect(result.memoryCount).toBe(0);
    expect(result.eventCount).toBe(0);
    expect(result.integrityCheck).toBe("ok");
    expect(result.schemaOk).toBe(false);
    expect(result.warnings).toContain("Backup is missing required table: memories");
    expect(result.warnings).toContain("Backup is missing required table: memory_events");
    expect(store.getMemory(created.id)?.content).toBe("Backup schema verification should be read-only.");
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

  test("redacts audit payload values with sensitive key names", () => {
    const created = store.createMemory({
      content: "Audit payload redaction should also inspect payload keys.",
      layer: "recall",
      tags: ["audit"],
      sourceType: "manual",
      sourceRef: "test",
      importance: 0.5,
      confidence: 0.8
    });

    store.updateMemory({
      memoryId: created.id,
      newContent: "Audit payload redaction should also inspect payload keys.",
      updateNote: JSON.stringify({
        accessToken: "short-token",
        nested: {
          apiKey: "abc123"
        }
      })
    });

    const updatedEvent = store.listEvents(created.id).find((event) => event.eventType === "updated");

    expect(JSON.parse(updatedEvent?.payload.updateNote as string)).toEqual({
      accessToken: "[REDACTED_SECRET]",
      nested: {
        apiKey: "[REDACTED_SECRET]"
      }
    });
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

function createBackupFixture(backupDir: string, fileName: string, content: string, mtime: Date): string {
  mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, fileName);
  writeFileSync(backupPath, content);
  utimesSync(backupPath, mtime, mtime);
  return backupPath;
}
