import os from "node:os";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

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
      consolidationDryRun: true,
      startupIntegrityCheck: true,
      startupFtsSanityCheck: true,
      startupWalCheckpoint: true,
      autoBackupOnStartup: false
    });

    expect(runtime.server.isConnected()).toBe(false);
    expect(runtime.store.getMemory(1)).toBeNull();

    runtime.store.close();
  });

  test("registers the expected MCP tools", async () => {
    const runtime = createMemoryServer({
      ollamaBaseUrl: "http://localhost:11434",
      embeddingModel: "embeddinggemma",
      maintenanceModel: "qwen3",
      databasePath: path.join(tempDir, "memory.sqlite"),
      defaultSearchLimit: 8,
      consolidationDryRun: true,
      startupIntegrityCheck: true,
      startupFtsSanityCheck: true,
      startupWalCheckpoint: true,
      autoBackupOnStartup: false
    });
    const client = new Client({
      name: "codex-memory-sidecar-test",
      version: "0.1.0"
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    try {
      await Promise.all([runtime.server.connect(serverTransport), client.connect(clientTransport)]);
      const result = await client.listTools();

      expect(result.tools.map((tool) => tool.name).sort()).toEqual([
        "audit_memory",
        "backup_memory",
        "consolidate_memory",
        "forget_memory",
        "health_check",
        "inspect_backup",
        "list_memory_summaries",
        "memory_digest",
        "memory_stats",
        "read_memory",
        "search_memory",
        "update_memory",
        "verify_backup",
        "write_memory"
      ]);
    } finally {
      await client.close();
      await runtime.server.close();
      runtime.store.close();
    }
  });
});
