export type ObservatoryPerformanceInput = {
  active: boolean;
  activeInteraction: boolean;
  autoRotate: boolean;
  denseGraph: boolean;
  focused: boolean;
  hovered: boolean;
  linkCount: number;
  lowPowerMode: boolean;
  mode: "live" | "replay" | "explore";
  nodeCount: number;
  paused: boolean;
  replayPlaying: boolean;
  visible: boolean;
};

export type ObservatoryPerformanceProfile = {
  lod: "full" | "balanced" | "reduced";
  frameDelayMs: number;
  objectRefreshEvery: number;
  particleIntervalMs: number;
};

export function buildObservatoryPerformanceProfile(
  input: ObservatoryPerformanceInput,
): ObservatoryPerformanceProfile {
  const lod = resolveLodLevel(input);

  if (!input.visible || !input.active) {
    return {
      lod,
      frameDelayMs: 900,
      objectRefreshEvery: lod === "reduced" ? 36 : lod === "balanced" ? 24 : 16,
      particleIntervalMs: lod === "reduced" ? 7200 : lod === "balanced" ? 5200 : 3600,
    };
  }

  if (!input.lowPowerMode) {
    return {
      lod: "full",
      frameDelayMs: 0,
      objectRefreshEvery: 5,
      particleIntervalMs: 1150,
    };
  }

  if (input.mode === "replay" && input.replayPlaying && !input.paused) {
    return {
      lod,
      frameDelayMs: lod === "reduced" ? 66 : lod === "balanced" ? 50 : 33,
      objectRefreshEvery: lod === "reduced" ? 36 : lod === "balanced" ? 24 : 16,
      particleIntervalMs: lod === "reduced" ? 7200 : lod === "balanced" ? 5200 : 3600,
    };
  }

  const interactive = input.activeInteraction || input.hovered || input.focused || input.autoRotate;
  if (interactive) {
    return {
      lod,
      frameDelayMs: lod === "reduced" ? 120 : lod === "balanced" ? 90 : 66,
      objectRefreshEvery: lod === "reduced" ? 36 : lod === "balanced" ? 24 : 16,
      particleIntervalMs: lod === "reduced" ? 7200 : lod === "balanced" ? 5200 : 3600,
    };
  }

  return {
    lod,
    frameDelayMs: lod === "reduced" ? 540 : lod === "balanced" ? 420 : 320,
    objectRefreshEvery: lod === "reduced" ? 36 : lod === "balanced" ? 24 : 16,
    particleIntervalMs: lod === "reduced" ? 7200 : lod === "balanced" ? 5200 : 3600,
  };
}

function resolveLodLevel(
  input: Pick<
    ObservatoryPerformanceInput,
    "denseGraph" | "linkCount" | "lowPowerMode" | "nodeCount"
  >,
): ObservatoryPerformanceProfile["lod"] {
  if (!input.lowPowerMode) {
    return "full";
  }
  if (input.nodeCount >= 160 || input.linkCount >= 600) {
    return "reduced";
  }
  if (input.denseGraph || input.nodeCount >= 70 || input.linkCount >= 240) {
    return "balanced";
  }
  return "full";
}
