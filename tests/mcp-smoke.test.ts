import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { runMcpSmoke } from "../src/mcp-smoke.js";

describe("runMcpSmoke", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), "codex-memory-sidecar-mcp-smoke-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("checks registered tools and calls health_check through MCP", async () => {
    const result = await runMcpSmoke({
      databasePath: path.join(tempDir, "memory.sqlite"),
    });

    expect(result.ok).toBe(true);
    expect(result.toolNames).toContain("write_memory");
    expect(result.toolNames).toContain("write_directive");
    expect(result.toolNames).toContain("list_directives");
    expect(result.toolNames).toContain("propose_directive_update");
    expect(result.toolNames).toContain("disable_directive");
    expect(result.toolNames).toContain("inspect_backup");
    expect(result.toolNames).toContain("memory_stats");
    expect(result.toolNames).toContain("plan_backup_retention");
    expect(result.toolNames).toContain("plan_backup_restore");
    expect(result.toolNames).toContain("propose_memory_update");
    expect(result.toolNames).toContain("repair_memory_index");
    expect(result.toolNames).toContain("start_memory_session");
    expect(result.healthCheck.database.ok).toBe(true);
    expect(result.startMemorySession.ready).toBe(true);
    expect(result.startMemorySession.backupRetention).toMatchObject({
      backupCount: 0,
      prunableCount: 0,
      wouldDelete: false,
    });
    expect(result.startMemorySession.sessionGuidance).toMatchObject({
      memoryUse: "supporting_context",
    });
    expect(result.startMemorySession.sessionGuidance.suggestedNextTools).toContain("audit_memory");
  }, 20_000);
});
