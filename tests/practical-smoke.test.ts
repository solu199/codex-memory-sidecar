import { describe, expect, test } from "vitest";

import { runPracticalSmoke } from "../src/practical-smoke.js";

describe("runPracticalSmoke", () => {
  test("checks the minimal practical flow on a temporary database", async () => {
    const result = await runPracticalSmoke();

    expect(result.ok).toBe(true);
    expect(result.checks).toMatchObject({
      writeMemory: true,
      scopedSearchExcludesBeta: true,
      crossProjectSearchIncludesBeta: true,
      digestUsesScopedMemory: true,
      backupVerified: true,
      inspectBackupScoped: true,
      auditRecorded: true,
      dashboardShowsProjectScopes: true
    });
    expect(result.memoryCount).toBe(2);
    expect(result.eventCount).toBeGreaterThan(0);
    expect(result.warnings).toEqual([]);
  });
});
