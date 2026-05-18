import { describe, expect, test } from "vitest";

import { runComparisonSmoke } from "../src/comparison-smoke.js";

describe("runComparisonSmoke", () => {
  test("checks a repeatable utility comparison flow on a temporary database", async () => {
    const result = await runComparisonSmoke();

    expect(result.ok).toBe(true);
    expect(result.checks.noMcpBaselineHasPrimarySources).toBe(true);
    expect(result.checks.startSessionGuidance).toBe(true);
    expect(result.checks.fullOperationFindsComparisonMemory).toBe(true);
    expect(result.checks.provenanceGuidanceStrong).toBe(true);
    expect(result.checks.searchKeepsEmbeddingsHiddenByDefault).toBe(true);
    expect(result.checks.auditRecorded).toBe(true);
    expect(result.evaluationMatrix).toEqual([
      expect.objectContaining({ condition: "mcp_off" }),
      expect.objectContaining({ condition: "start_session_only" }),
      expect.objectContaining({ condition: "full_mcp_operation" })
    ]);
    expect(result.recommendations).toEqual(
      expect.arrayContaining([
        "Use MCP as supporting context, not as a replacement for README/docs/git/current files."
      ])
    );
  });
});
