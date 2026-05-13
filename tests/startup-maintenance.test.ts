import os from "node:os";
import path from "node:path";
import { existsSync, mkdtempSync, rmSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { MemoryStore } from "../src/memory-store.js";
import { runStartupMaintenance } from "../src/startup-maintenance.js";

describe("runStartupMaintenance", () => {
  let tempDir: string;
  let store: MemoryStore;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), "codex-memory-sidecar-startup-"));
    store = new MemoryStore(path.join(tempDir, "memory.sqlite"));
  });

  afterEach(() => {
    store.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("checks database health without creating a backup by default", async () => {
    store.createMemory({
      content: "Startup maintenance should check local health.",
      layer: "recall",
      tags: ["startup"],
      sourceType: "manual",
      sourceRef: "test"
    });

    const result = await runStartupMaintenance(store, {
      startupIntegrityCheck: true,
      startupFtsSanityCheck: true,
      startupWalCheckpoint: true,
      autoBackupOnStartup: false
    });

    expect(result.ok).toBe(true);
    expect(result.databaseHealth.ok).toBe(true);
    expect(result.databaseHealth.integrityCheck).toBe("ok");
    expect(result.backup).toBeNull();
    expect(result.warnings).toEqual([]);
  });

  test("creates and verifies a startup backup when enabled", async () => {
    store.createMemory({
      content: "Startup backup should be verified immediately.",
      layer: "recall",
      tags: ["startup"],
      sourceType: "manual",
      sourceRef: "test"
    });

    const result = await runStartupMaintenance(store, {
      startupIntegrityCheck: true,
      startupFtsSanityCheck: true,
      startupWalCheckpoint: true,
      autoBackupOnStartup: true
    });

    expect(result.ok).toBe(true);
    expect(result.backup?.verification.ok).toBe(true);
    expect(result.backup?.verification.integrityCheck).toBe("ok");
    expect(result.backup?.verification.schemaOk).toBe(true);
    expect(result.backup?.backupPath).toContain(path.join(tempDir, "backups"));
    expect(existsSync(result.backup?.backupPath ?? "")).toBe(true);
  });
});
