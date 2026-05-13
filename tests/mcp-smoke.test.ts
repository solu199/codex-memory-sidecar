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
      databasePath: path.join(tempDir, "memory.sqlite")
    });

    expect(result.ok).toBe(true);
    expect(result.toolNames).toContain("write_memory");
    expect(result.toolNames).toContain("inspect_backup");
    expect(result.toolNames).toContain("memory_stats");
    expect(result.healthCheck.database.ok).toBe(true);
  });
});
