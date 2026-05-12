import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test, vi } from "vitest";

import { runOllamaSmoke } from "../src/ollama-smoke.js";

describe("runOllamaSmoke", () => {
  let tempDir: string;

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("writes and searches memory through an embedding provider", async () => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), "codex-memory-sidecar-smoke-test-"));
    const embed = vi
      .fn()
      .mockResolvedValueOnce([1, 0])
      .mockResolvedValueOnce([0, 1])
      .mockResolvedValueOnce([1, 0]);

    const result = await runOllamaSmoke({
      databasePath: path.join(tempDir, "memory.sqlite"),
      embeddingProvider: { embed }
    });

    expect(result.ok).toBe(true);
    expect(result.embeddingDimensions).toBe(2);
    expect(result.warnings).toEqual([]);
    expect(result.topMemorySummary).toContain("smoke");
    expect(embed).toHaveBeenCalledTimes(3);
  });

  test("fails when any embedding request falls back with a warning", async () => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), "codex-memory-sidecar-smoke-test-"));
    const embed = vi
      .fn()
      .mockResolvedValueOnce([1, 0])
      .mockResolvedValueOnce([0, 1])
      .mockRejectedValueOnce(new Error("Ollama offline during search"));

    const result = await runOllamaSmoke({
      databasePath: path.join(tempDir, "memory.sqlite"),
      embeddingProvider: { embed }
    });

    expect(result.ok).toBe(false);
    expect(result.warnings).toEqual(["Embedding unavailable: Ollama offline during search"]);
  });
});
