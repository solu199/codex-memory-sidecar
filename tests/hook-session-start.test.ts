import { mkdtempSync } from "node:fs";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, test } from "vitest";

import {
  buildSessionStartAdditionalContext,
  runSessionStartHook,
} from "../src/hook-session-start.js";
import { runHookSessionStartSmoke } from "../src/hook-session-start-smoke.js";
import { MemoryStore } from "../src/memory-store.js";

describe("SessionStart hook adapter", () => {
  test("returns compact directive and memory context", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "codex-memory-hook-test-"));
    const databasePath = path.join(tempDir, "memory.sqlite");
    const projectPath = path.join(tempDir, "project");
    const store = new MemoryStore(databasePath);
    try {
      store.createDirective({
        content: "READMEは日本語で書く。",
        scope: "project",
        projectPath,
        rationale: "Project policy should be visible at session start.",
        tags: ["readme"],
        sourceType: "test",
        sourceRef: "test:hook",
      });
      store.createMemory({
        content: "SessionStart hookはauto-writeを発火させない。",
        layer: "recall",
        projectPath,
        tags: ["hook"],
        sourceType: "test",
        sourceRef: "test:hook",
        summary: "SessionStart hookは読み取り専用の追加コンテキストを返す。",
      });
    } finally {
      store.close();
    }

    const output = await runSessionStartHook({
      cwd: projectPath,
      env: { CODEX_MEMORY_DB: databasePath },
      stdin: '{"source":"startup"}',
      maxChars: 2000,
    });

    expect(output?.hookSpecificOutput.hookEventName).toBe("SessionStart");
    expect(output?.hookSpecificOutput.additionalContext).toContain("READMEは日本語");
    expect(output?.hookSpecificOutput.additionalContext).toContain("読み取り専用");
    expect(output?.hookSpecificOutput.additionalContext.length).toBeLessThanOrEqual(2000);

    const verifyStore = new MemoryStore(databasePath);
    try {
      expect(verifyStore.countRecords().memoryCount).toBe(1);
    } finally {
      verifyStore.close();
    }
  });

  test("does not create a database when the configured database is missing", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "codex-memory-hook-missing-"));
    const databasePath = path.join(tempDir, "missing.sqlite");

    const output = await runSessionStartHook({
      cwd: tempDir,
      env: { CODEX_MEMORY_DB: databasePath },
      stdin: '{"source":"startup"}',
    });

    expect(output).toBeNull();
    expect(existsSync(databasePath)).toBe(false);
  });

  test("builder truncates long contexts", () => {
    const now = new Date();
    const context = buildSessionStartAdditionalContext(
      {
        source: "startup",
        databasePath: "memory.sqlite",
        health: {
          ok: true,
          integrityCheck: "ok",
          fts: { ok: true, expectedCount: 0, indexedCount: 0, missingCount: 0, orphanCount: 0 },
          walCheckpoint: { busy: 0, log: 0, checkpointed: 0 },
          warnings: [],
          checkedAt: now,
        },
        stats: {
          memoryCount: 1,
          eventCount: 1,
          byStatus: { active: 1, superseded: 0, forgotten: 0 },
          byLayer: { core: 0, recall: 1, archival: 0 },
          byProjectScope: [],
          updatedAtRange: { oldest: now, newest: now },
        },
        directives: [],
        memories: [
          {
            id: 1,
            layer: "recall",
            content: "x".repeat(4000),
            summary: "x".repeat(4000),
            tags: [],
            projectScope: "project:test",
            sourceType: "test",
            sourceRef: "test:hook",
            importance: 0.5,
            confidence: 0.5,
            embedding: null,
            createdAt: now,
            updatedAt: now,
            validFrom: now,
            invalidatedAt: null,
            invalidatedByRef: null,
            invalidationReason: null,
            lastAccessedAt: null,
            expiresAt: null,
            status: "active",
          },
        ],
      },
      800,
    );

    expect(context.length).toBeLessThanOrEqual(800);
    expect(context).toContain("truncated");
  });

  test("smoke covers JSON output and read-only behavior", async () => {
    const result = await runHookSessionStartSmoke();

    expect(result.ok).toBe(true);
    expect(result.memoryCount).toBe(1);
    expect(result.additionalContextLength).toBeLessThanOrEqual(2000);
  });
});
