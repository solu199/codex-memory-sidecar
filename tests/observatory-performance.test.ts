import { describe, expect, test } from "vitest";

import { buildObservatoryPerformanceProfile } from "../src/dashboard-app/src/observatory-performance.js";

describe("observatory performance profile", () => {
  test("uses reduced LOD for dense large graphs in low-power mode", () => {
    const profile = buildObservatoryPerformanceProfile({
      active: true,
      activeInteraction: false,
      autoRotate: false,
      denseGraph: true,
      focused: false,
      hovered: false,
      linkCount: 920,
      lowPowerMode: true,
      mode: "live",
      nodeCount: 220,
      paused: false,
      replayPlaying: false,
      visible: true,
    });

    expect(profile.lod).toBe("reduced");
    expect(profile.frameDelayMs).toBe(540);
    expect(profile.objectRefreshEvery).toBe(36);
    expect(profile.particleIntervalMs).toBe(7200);
  });

  test("keeps immediate cadence when low-power mode is off", () => {
    const profile = buildObservatoryPerformanceProfile({
      active: true,
      activeInteraction: false,
      autoRotate: false,
      denseGraph: false,
      focused: false,
      hovered: false,
      linkCount: 120,
      lowPowerMode: false,
      mode: "live",
      nodeCount: 48,
      paused: false,
      replayPlaying: false,
      visible: true,
    });

    expect(profile.lod).toBe("full");
    expect(profile.frameDelayMs).toBe(0);
    expect(profile.objectRefreshEvery).toBe(5);
    expect(profile.particleIntervalMs).toBe(1150);
  });

  test("uses replay-friendly cadence while replay is running", () => {
    const profile = buildObservatoryPerformanceProfile({
      active: true,
      activeInteraction: false,
      autoRotate: false,
      denseGraph: false,
      focused: false,
      hovered: false,
      linkCount: 260,
      lowPowerMode: true,
      mode: "replay",
      nodeCount: 96,
      paused: false,
      replayPlaying: true,
      visible: true,
    });

    expect(profile.lod).toBe("balanced");
    expect(profile.frameDelayMs).toBe(50);
    expect(profile.objectRefreshEvery).toBe(24);
    expect(profile.particleIntervalMs).toBe(5200);
  });
});
