import os from "node:os";
import path from "node:path";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), "codex-memory-sidecar-config-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("returns stable defaults when no config file exists", () => {
    const config = loadConfig({ cwd: tempDir, env: {} });

    expect(config.ollamaBaseUrl).toBe("http://localhost:11434");
    expect(config.embeddingModel).toBe("embeddinggemma");
    expect(config.maintenanceModel).toBe("qwen3");
    expect(config.databasePath).toBe(path.join(tempDir, "data", "memory.sqlite"));
    expect(config.defaultSearchLimit).toBe(8);
    expect(config.consolidationDryRun).toBe(true);
  });

  test("loads supported settings from config/memory-sidecar.toml", () => {
    mkdirSync(path.join(tempDir, "config"));
    writeFileSync(
      path.join(tempDir, "config", "memory-sidecar.toml"),
      [
        'ollama_base_url = "http://localhost:11435"',
        'embedding_model = "all-minilm"',
        'maintenance_model = "gemma3"',
        'database_path = "custom/memory.sqlite"',
        "default_search_limit = 12",
        "consolidation_dry_run = false"
      ].join("\n")
    );

    const config = loadConfig({ cwd: tempDir, env: {} });

    expect(config.ollamaBaseUrl).toBe("http://localhost:11435");
    expect(config.embeddingModel).toBe("all-minilm");
    expect(config.maintenanceModel).toBe("gemma3");
    expect(config.databasePath).toBe(path.join(tempDir, "custom", "memory.sqlite"));
    expect(config.defaultSearchLimit).toBe(12);
    expect(config.consolidationDryRun).toBe(false);
  });

  test("lets environment variables override file settings", () => {
    mkdirSync(path.join(tempDir, "config"));
    writeFileSync(path.join(tempDir, "config", "memory-sidecar.toml"), 'database_path = "file.sqlite"');

    const config = loadConfig({
      cwd: tempDir,
      env: {
        CODEX_MEMORY_DB: path.join(tempDir, "env.sqlite"),
        OLLAMA_BASE_URL: "http://127.0.0.1:11434",
        CODEX_MEMORY_EMBEDDING_MODEL: "qwen3-embedding"
      }
    });

    expect(config.databasePath).toBe(path.join(tempDir, "env.sqlite"));
    expect(config.ollamaBaseUrl).toBe("http://127.0.0.1:11434");
    expect(config.embeddingModel).toBe("qwen3-embedding");
  });
});
