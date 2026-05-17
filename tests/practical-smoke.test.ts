import { describe, expect, test } from "vitest";

import { runPracticalSmoke } from "../src/practical-smoke.js";

describe("runPracticalSmoke", () => {
  test("checks the minimal practical flow on a temporary database", async () => {
    const result = await runPracticalSmoke();

    expect(result.ok).toBe(true);
    expect(result.checks).toMatchObject({
      writeMemory: true,
      proposeMemoryUpdate: true,
      scopedSearchExcludesBeta: true,
      crossProjectSearchIncludesBeta: true,
      startMemorySession: true,
      consolidateNearDuplicate: true,
      proposeNearDuplicate: true,
      digestUsesScopedMemory: true,
      backupVerified: true,
      backupRetentionDryRun: true,
      backupRestoreDryRun: true,
      inspectBackupScoped: true,
      repairMemoryIndex: true,
      auditRecorded: true,
      dashboardShowsProjectScopes: true
    });
    expect(result.memoryCount).toBe(4);
    expect(result.eventCount).toBeGreaterThan(0);
    expect(result.warnings).toEqual([]);
  });
});
