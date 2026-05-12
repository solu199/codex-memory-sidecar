import os from "node:os";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { createMemoryServer } from "../src/server.js";

describe("createMemoryServer", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), "codex-memory-sidecar-server-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("creates a server and store from resolved config", () => {
    const runtime = createMemoryServer({
      ollamaBaseUrl: "http://localhost:11434",
      embeddingModel: "embeddinggemma",
      maintenanceModel: "qwen3",
      databasePath: path.join(tempDir, "memory.sqlite"),
      defaultSearchLimit: 8,
      consolidationDryRun: true
    });

    expect(runtime.server.isConnected()).toBe(false);
    expect(runtime.store.getMemory(1)).toBeNull();

    runtime.store.close();
  });
});
