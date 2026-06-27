import { describe, expect, test } from "vitest";

import { runRecallBenchmark } from "../src/recall-benchmark.js";

describe("recall benchmark", () => {
  test("passes the lightweight memory evaluation gates", async () => {
    const result = await runRecallBenchmark();

    expect(result.ok).toBe(true);
    expect(result.modes.map((mode) => mode.mode)).toEqual(["keyword", "semantic"]);
    for (const mode of result.modes) {
      expect(mode.recallAt3).toBeGreaterThanOrEqual(result.thresholds.minRecallAt3);
      expect(mode.precisionAt3).toBeGreaterThanOrEqual(result.thresholds.minPrecisionAt3);
      expect(mode.sourceRefQuality).toBe(1);
      expect(mode.duplicateSuppression).toBe(true);
      expect(mode.cases).toHaveLength(6);
    }
  });
});
