import { describe, expect, test } from "vitest";

import { buildSearchSurfaceSignals, hasTypoRecoverySignal } from "../src/search-rerank.js";

describe("search rerank helpers", () => {
  test("scores nearby ordered matches above scattered matches", () => {
    const nearby = buildSearchSurfaceSignals(
      "dashboard stale process",
      "Dashboard stale process troubleshooting is captured in one short note.",
    );
    const scattered = buildSearchSurfaceSignals(
      "dashboard stale process",
      "Dashboard guidance exists. Much later we mention stale output. Process checks are elsewhere.",
    );

    expect(nearby.total).toBeGreaterThan(scattered.total);
    expect(nearby.proximity).toBeGreaterThan(scattered.proximity);
  });

  test("detects small typo recovery opportunities without matching unrelated text", () => {
    const recovered = buildSearchSurfaceSignals(
      "dashbaord stale proces",
      "Dashboard stale process troubleshooting is captured in one short note.",
    );
    const unrelated = buildSearchSurfaceSignals(
      "dashbaord stale proces",
      "Backup verification and repair steps are tracked separately.",
    );

    expect(hasTypoRecoverySignal(recovered)).toBe(true);
    expect(recovered.typo).toBeGreaterThan(0.5);
    expect(hasTypoRecoverySignal(unrelated)).toBe(false);
    expect(unrelated.total).toBeLessThan(recovered.total);
  });
});
