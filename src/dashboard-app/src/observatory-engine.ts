import type { GraphEdge, GraphEvent, GraphNode, MemoryGraph } from "./types";

type RuntimeNode = GraphNode & {
  name: string;
  cluster: Cluster;
  clusterKey: string;
  color: string;
  createdH: number;
  forgottenH: number;
  accesses: number[];
  searchText: string;
  x?: number;
  y?: number;
  z?: number;
  vx?: number;
  vy?: number;
  vz?: number;
  fx?: number;
  fy?: number;
  fz?: number;
  __obj?: any;
  __sphere?: any;
  __glow?: any;
  __labelTitle?: any;
  __labelAnon?: any;
};

type RuntimeLink = {
  source: number | RuntimeNode;
  target: number | RuntimeNode;
  type: "sim" | "hebb";
  weight: number;
  times?: number[];
};

type Cluster = {
  key: string;
  label: string;
  color: string;
  cx3: number;
  cy3: number;
};

type ObservatoryModel = {
  graph: MemoryGraph;
  nodes: RuntimeNode[];
  links: RuntimeLink[];
  clusters: Cluster[];
  clusterByKey: Map<string, Cluster>;
  nodeById: Map<number, RuntimeNode>;
  adjacentIdsByNodeId: Map<number, Set<number>>;
};

export type ObservatorySettings = {
  active: boolean;
  autoRotate: boolean;
  fogOn: boolean;
  lowPowerMode: boolean;
  mode: "live" | "replay" | "explore";
  paused: boolean;
  replayPlaying: boolean;
  replaySpeed: number;
  search: string;
  showHebb: boolean;
  showSim: boolean;
  showTitles: boolean;
  simH: number;
};

export type ObservatoryEngine = {
  destroy: () => void;
  update: (settings: ObservatorySettings) => void;
};

export function createObservatoryEngine(options: {
  container: HTMLElement;
  graph: MemoryGraph;
  onOpenMemory: (id: number) => void;
  onReplayTimeChange?: (simH: number) => void;
}): ObservatoryEngine {
  const runtime = window as any;
  const container = options.container;
  container.innerHTML = "";

  if (!runtime.ForceGraph3D || !runtime.THREE) {
    renderFallback(container, options.graph);
    return {
      destroy: () => {
        container.innerHTML = "";
      },
      update: () => undefined,
    };
  }

  const THREE = runtime.THREE;
  const UnrealBloomPass = runtime.UnrealBloomPass;
  const model = buildObservatoryModel(options.graph);
  const denseGraph =
    model.links.filter((link) => link.type === "hebb").length > model.nodes.length * 2.5;
  const visualDensityDamping = denseGraph ? 0.62 : 1;
  const state = {
    activeUntil: 0,
    autoCentering: false,
    clusterFilter: null as string | null,
    destroyed: false,
    draggingNode: false,
    focus: null as RuntimeNode | null,
    hover: null as RuntimeNode | null,
    lastFeedHtml: "",
    lastFrameAt: 0,
    lastObjectRefreshKey: "",
    lastParticleT: 0,
    lastReplayBucket: -1,
    lastReplayUiBucket: -1,
    lastReplayTime: null as number | null,
    model,
    onReplayTimeChange: options.onReplayTimeChange,
    settings: defaultSettings(),
    userMovedCamera: false,
    visualDensityDamping,
    viewCenter: { x: 0, y: 0, z: 0 },
  };

  const sharedSphereGeometry = new THREE.SphereGeometry(2.4, 16, 12);
  let graph3d: any;
  try {
    graph3d = new runtime.ForceGraph3D(container, { controlType: "orbit" })
      .backgroundColor("rgba(0,0,0,0)")
      .showNavInfo(false)
      .enablePointerInteraction(true)
      .nodeThreeObject((node: RuntimeNode) => createNodeObject(node, THREE, sharedSphereGeometry))
      .nodeVisibility((node: RuntimeNode) => memVisible(node, state))
      .linkVisibility((link: RuntimeLink) => linkVisible(link, state))
      .linkColor((link: RuntimeLink) => (link.type === "hebb" ? "#b9c8ee" : "#6376b8"))
      .linkWidth((link: RuntimeLink) =>
        link.type === "hebb"
          ? Math.min(0.82, 0.16 + Math.log1p(link.weight) * 0.26) * (denseGraph ? 0.68 : 0.86)
          : 0.12,
      )
      .linkOpacity(denseGraph ? 0.13 : 0.18)
      .linkDirectionalParticles(0)
      .linkDirectionalParticleWidth((link: RuntimeLink) => (link.type === "hebb" ? 3.2 : 2.2))
      .linkDirectionalParticleSpeed(0.075)
      .linkDirectionalParticleColor((link: RuntimeLink) =>
        link.type === "hebb" ? "#ffbf52" : "#22d3ee",
      )
      .warmupTicks(70)
      .cooldownTime(9000)
      .graphData({ nodes: model.nodes, links: model.links });
  } catch (error) {
    sharedSphereGeometry.dispose?.();
    renderFallback(container, options.graph, error);
    return {
      destroy: () => {
        container.innerHTML = "";
      },
      update: () => undefined,
    };
  }

  ensureStatusBar(container);
  const resizeGraph = () => {
    graph3d.width(Math.max(320, container.clientWidth));
    graph3d.height(Math.max(320, container.clientHeight));
  };
  resizeGraph();
  const resizeObserver =
    typeof ResizeObserver !== "undefined" ? new ResizeObserver(resizeGraph) : null;
  resizeObserver?.observe(container);
  window.addEventListener("resize", resizeGraph);

  graph3d.d3Force("center", null);
  graph3d.d3Force("charge").strength(-38);
  graph3d
    .d3Force("link")
    .distance((link: RuntimeLink) => (link.type === "hebb" ? 42 : 70))
    .strength((link: RuntimeLink) => (link.type === "hebb" ? (denseGraph ? 0.06 : 0.22) : 0.02));
  graph3d.d3Force("clusterAnchor", (alpha: number) => {
    for (const node of model.nodes) {
      const anchor = model.clusterByKey.get(node.clusterKey);
      if (!anchor) continue;
      node.vx = (node.vx || 0) + (anchor.cx3 - (node.x || 0)) * (denseGraph ? 0.1 : 0.05) * alpha;
      node.vy = (node.vy || 0) + (anchor.cy3 - (node.y || 0)) * (denseGraph ? 0.1 : 0.05) * alpha;
    }
  });
  graph3d.d3Force("activationDepth", (alpha: number) => {
    for (const node of model.nodes) {
      const zTarget = -240 + 320 * activationScore(node);
      node.vz = (node.vz || 0) + (zTarget - (node.z || 0)) * 0.12 * alpha;
    }
  });

  const scene = graph3d.scene();
  const fog = new THREE.FogExp2(0x070b14, 0.0019);
  scene.fog = fog;
  const composer = graph3d.postProcessingComposer?.();
  if (composer && UnrealBloomPass) {
    const bloom = new UnrealBloomPass();
    bloom.strength = 0.85;
    bloom.radius = 0.6;
    bloom.threshold = 0.18;
    composer.addPass(bloom);
  }

  graph3d.cameraPosition({ x: 0, y: 18, z: 340 });
  const controls = graph3d.controls();
  controls.enableDamping = true;
  controls.dampingFactor = 0.085;
  controls.screenSpacePanning = true;
  controls.zoomToCursor = true;
  controls.autoRotate = false;
  controls.autoRotateSpeed = 0.45;
  controls.addEventListener?.("start", () => {
    if (!state.autoCentering) state.userMovedCamera = true;
    markActive(state, graph3d, 1600);
  });

  graph3d.onNodeDrag(() => {
    if (!state.draggingNode) {
      state.draggingNode = true;
      graph3d.d3ReheatSimulation();
    }
    markActive(state, graph3d, 1200);
  });
  graph3d.onNodeDragEnd((node: RuntimeNode) => {
    state.draggingNode = false;
    markActive(state, graph3d, 1400);
    node.fx = undefined;
    node.fy = undefined;
    node.fz = undefined;
  });
  graph3d.onNodeHover((node: RuntimeNode | null, event?: MouseEvent) => {
    state.hover = node;
    if (node) markActive(state, graph3d, 900);
    showTooltip(node, event, state);
    container.style.cursor = node ? "pointer" : "default";
    refreshNodeObjects(state, graph3d, true);
  });
  graph3d.onNodeClick((node: RuntimeNode) => {
    state.focus = state.focus === node ? null : node;
    markActive(state, graph3d, 1600);
    invalidateVisibility(graph3d);
    state.viewCenter = graphPoint(node);
    controls.target.set(state.viewCenter.x, state.viewCenter.y, state.viewCenter.z);
    graph3d.cameraPosition(
      { x: node.x! * 1.35, y: node.y! * 1.35, z: (node.z || 0) + 160 },
      node,
      900,
    );
    refreshPanels(model, state);
    options.onOpenMemory(node.id);
  });
  graph3d.onBackgroundClick(() => {
    state.focus = null;
    markActive(state, graph3d, 1000);
    invalidateVisibility(graph3d);
    refreshPanels(model, state);
  });

  window.setTimeout(() => {
    centerGraphView(graph3d, controls, model, state, {
      animateMs: 900,
      fit: true,
      userInitiated: false,
    });
  }, 1200);
  window.setTimeout(() => {
    centerGraphView(graph3d, controls, model, state, {
      animateMs: 700,
      fit: true,
      userInitiated: false,
    });
  }, 3400);

  let animationFrame: number | null = null;
  let animationTimeout: number | null = null;
  let frame = 0;
  const schedule = (delay = 0, force = false) => {
    if (state.destroyed) return;
    if (force && animationFrame !== null) {
      cancelAnimationFrame(animationFrame);
      animationFrame = null;
    }
    if (force && animationTimeout !== null) {
      window.clearTimeout(animationTimeout);
      animationTimeout = null;
    }
    if (animationFrame !== null || animationTimeout !== null) return;
    if (delay > 0) {
      animationTimeout = window.setTimeout(() => {
        animationTimeout = null;
        animationFrame = requestAnimationFrame(animate);
      }, delay);
      return;
    }
    animationFrame = requestAnimationFrame(animate);
  };

  const resume = () => {
    state.lastFrameAt = 0;
    graph3d.resumeAnimation?.();
    schedule(0, true);
  };

  const visibilityListener = () => {
    if (document.hidden) {
      graph3d.pauseAnimation?.();
    } else {
      resume();
    }
  };
  document.addEventListener("visibilitychange", visibilityListener);

  const animate = (time: number) => {
    animationFrame = null;
    if (state.destroyed) return;
    if (!isRenderable(state)) {
      graph3d.pauseAnimation?.();
      schedule(frameDelay(state));
      return;
    }
    graph3d.resumeAnimation?.();
    state.lastFrameAt = time;
    controls.autoRotate = state.settings.autoRotate && state.settings.mode !== "replay";
    scene.fog = state.settings.fogOn ? fog : null;
    controls.update();
    updateReplay(time, state, graph3d);
    const particleInterval = state.settings.lowPowerMode ? 3600 : 1150;
    if (
      !state.settings.paused &&
      state.settings.mode === "live" &&
      time - state.lastParticleT > particleInterval
    ) {
      state.lastParticleT = time;
      emitRecentParticle(model, graph3d);
    }
    const objectUpdateEvery = state.settings.lowPowerMode ? 16 : 5;
    if (frame++ % objectUpdateEvery === 0) {
      refreshNodeObjects(state, graph3d, false);
    }
    schedule(frameDelay(state));
  };

  refreshPanels(model, state);
  schedule(0);

  return {
    destroy() {
      state.destroyed = true;
      if (animationFrame !== null) cancelAnimationFrame(animationFrame);
      if (animationTimeout !== null) window.clearTimeout(animationTimeout);
      document.removeEventListener("visibilitychange", visibilityListener);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", resizeGraph);
      sharedSphereGeometry.dispose?.();
      container.innerHTML = "";
    },
    update(settings: ObservatorySettings) {
      const previous = state.settings;
      state.settings = settings;
      controls.autoRotate = settings.autoRotate && settings.mode !== "replay";
      scene.fog = settings.fogOn ? fog : null;
      if (
        previous.mode !== settings.mode ||
        previous.replayPlaying !== settings.replayPlaying ||
        previous.replaySpeed !== settings.replaySpeed ||
        previous.search !== settings.search ||
        previous.showHebb !== settings.showHebb ||
        previous.showSim !== settings.showSim ||
        previous.simH !== settings.simH
      ) {
        if (
          previous.mode !== settings.mode ||
          previous.replayPlaying !== settings.replayPlaying ||
          previous.replaySpeed !== settings.replaySpeed ||
          previous.simH !== settings.simH
        ) {
          state.lastReplayTime = null;
          state.lastReplayBucket = Math.floor(settings.simH * 4);
          state.lastReplayUiBucket = Math.floor(settings.simH * 4);
        }
        invalidateVisibility(graph3d);
        refreshPanels(model, state);
      }
      if (previous.lowPowerMode !== settings.lowPowerMode || previous.active !== settings.active) {
        markActive(state, graph3d, 700);
      }
      if (settings.active) {
        resume();
      } else {
        graph3d.pauseAnimation?.();
      }
    },
  };
}

function defaultSettings(): ObservatorySettings {
  return {
    active: true,
    autoRotate: false,
    fogOn: true,
    lowPowerMode: true,
    mode: "live",
    paused: false,
    replayPlaying: false,
    replaySpeed: 6,
    search: "",
    showHebb: true,
    showSim: true,
    showTitles: true,
    simH: 720,
  };
}

function buildObservatoryModel(graph: MemoryGraph): ObservatoryModel {
  const palette = ["#4fc3f7", "#ffd54f", "#ba68c8", "#81c784", "#ef7b7b", "#4db6ac", "#f48fb1"];
  const layerLabels: Record<string, string> = {
    core: "Core",
    recall: "Recall",
    archival: "Archival",
  };
  const genericTags = new Set(["codex-memory-sidecar", "memory", "mcp", "test"]);
  const tagCounts = new Map<string, number>();
  for (const node of graph.nodes ?? []) {
    for (const tag of node.tags ?? []) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
  }
  const chooseClusterKey = (node: GraphNode) => {
    const tags = [...(node.tags ?? [])].filter((tag) => !genericTags.has(tag));
    tags.sort(
      (left, right) =>
        (tagCounts.get(right) ?? 0) - (tagCounts.get(left) ?? 0) || left.localeCompare(right),
    );
    if (tags[0]) return `tag:${tags[0]}`;
    if (node.sourceType) return `source:${node.sourceType}`;
    return `layer:${node.layer ?? "recall"}`;
  };
  const clusterKeys = [...new Set((graph.nodes ?? []).map((node) => chooseClusterKey(node)))];
  const clusters = clusterKeys.map((key, index) => {
    const angle = (index / Math.max(1, clusterKeys.length)) * Math.PI * 2 - Math.PI / 2;
    const [kind, rawLabel] = key.split(/:(.*)/s);
    return {
      key,
      label: kind === "layer" ? (layerLabels[rawLabel] ?? rawLabel) : rawLabel,
      color: palette[index % palette.length],
      cx3: Math.cos(angle) * 145,
      cy3: Math.sin(angle) * 100,
    };
  });
  const clusterByKey = new Map(clusters.map((cluster) => [cluster.key, cluster]));
  const eventIndexByMemory = new Map<number, number[]>();
  for (const [index, event] of (graph.events ?? []).entries()) {
    const eventH = eventToHour(event, index, graph.events?.length ?? 1);
    for (const memoryId of event.memoryIds ?? []) {
      const items = eventIndexByMemory.get(memoryId) ?? [];
      items.push(eventH);
      eventIndexByMemory.set(memoryId, items);
    }
  }
  const nodes = (graph.nodes ?? []).map((node, index) => {
    const cluster = clusterByKey.get(chooseClusterKey(node)) ?? clusters[0];
    const eventHours = eventIndexByMemory.get(node.id) ?? [];
    const createdH = eventHours[0] ?? index * (720 / Math.max(1, graph.nodes.length - 1));
    const name = shortMemoryTitle(node);
    return {
      ...node,
      name,
      cluster,
      clusterKey: cluster.key,
      color: cluster.color,
      createdH,
      forgottenH: Infinity,
      accesses: [createdH, ...eventHours].sort((a, b) => a - b),
      searchText: [
        name,
        node.summary,
        node.layer,
        node.sourceRef,
        node.projectScope,
        ...(node.tags ?? []),
      ]
        .join(" ")
        .toLowerCase(),
      x: cluster.cx3 + Math.cos(index * 2.399) * 45,
      y: cluster.cy3 + Math.sin(index * 1.711) * 38,
      z: -60 + 180 * Number(node.activation ?? 0),
    } satisfies RuntimeNode;
  });
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const links: RuntimeLink[] = [];
  for (const edge of graph.edges?.similarity ?? []) appendLink(links, nodeById, edge, "sim");
  for (const edge of graph.edges?.hebbian ?? []) appendLink(links, nodeById, edge, "hebb");
  const adjacentIdsByNodeId = new Map<number, Set<number>>();
  for (const link of links) {
    const source = typeof link.source === "object" ? link.source.id : link.source;
    const target = typeof link.target === "object" ? link.target.id : link.target;
    if (!adjacentIdsByNodeId.has(source)) adjacentIdsByNodeId.set(source, new Set());
    if (!adjacentIdsByNodeId.has(target)) adjacentIdsByNodeId.set(target, new Set());
    adjacentIdsByNodeId.get(source)?.add(target);
    adjacentIdsByNodeId.get(target)?.add(source);
  }
  return { graph, nodes, links, clusters, clusterByKey, nodeById, adjacentIdsByNodeId };
}

function appendLink(
  links: RuntimeLink[],
  nodeById: Map<number, RuntimeNode>,
  edge: GraphEdge,
  type: RuntimeLink["type"],
) {
  if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) return;
  links.push({
    source: edge.source,
    target: edge.target,
    type,
    weight: Number(edge.weight ?? (type === "hebb" ? 1 : 0.2)),
    times: edge.latestAt ? [eventToHour({ createdAt: edge.latestAt, memoryIds: [] }, 0, 1)] : [],
  });
}

function createNodeObject(node: RuntimeNode, THREE: any, sphereGeometry: any) {
  const group = new THREE.Group();
  const sphere = new THREE.Mesh(
    sphereGeometry,
    new THREE.MeshBasicMaterial({ color: node.color, transparent: true }),
  );
  const glow = new THREE.Sprite(
    new THREE.SpriteMaterial({
      blending: THREE.AdditiveBlending,
      color: node.color,
      depthWrite: false,
      map: getGlowTexture(THREE),
      transparent: true,
    }),
  );
  glow.scale.set(14, 14, 1);
  const labelTitle = makeTextSprite(node.name, "#d6e2fa", THREE);
  const labelAnon = makeTextSprite(
    `${node.clusterKey}#${String(node.id).padStart(3, "0")}`,
    "#9fb1d8",
    THREE,
  );
  labelTitle.visible = false;
  labelAnon.visible = false;
  group.add(sphere, glow, labelTitle, labelAnon);
  node.__obj = group;
  node.__sphere = sphere;
  node.__glow = glow;
  node.__labelTitle = labelTitle;
  node.__labelAnon = labelAnon;
  return group;
}

let glowTexture: any = null;

function getGlowTexture(THREE: any) {
  if (glowTexture) return glowTexture;
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.3, "rgba(255,255,255,0.45)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  glowTexture = new THREE.CanvasTexture(canvas);
  return glowTexture;
}

function makeTextSprite(text: string, color: string, THREE: any) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return new THREE.Sprite();
  }
  const font = "22px 'Segoe UI', sans-serif";
  ctx.font = font;
  const width = Math.ceil(ctx.measureText(text).width) + 16;
  canvas.width = width;
  canvas.height = 32;
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textBaseline = "middle";
  ctx.fillText(String(text).slice(0, 30), 8, 16);
  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      depthWrite: false,
      map: texture,
      transparent: true,
    }),
  );
  sprite.scale.set(width / 4.4, 32 / 4.4, 1);
  sprite.position.set(0, -7.5, 0);
  return sprite;
}

function refreshNodeObjects(
  state: {
    model: ObservatoryModel;
    settings: ObservatorySettings;
    hover: RuntimeNode | null;
    focus: RuntimeNode | null;
    visualDensityDamping: number;
  },
  graph3d: any,
  force: boolean,
) {
  const key = [
    state.settings.search,
    state.settings.showTitles,
    state.settings.mode,
    state.settings.simH.toFixed(1),
    state.hover?.id ?? "-",
    state.focus?.id ?? "-",
  ].join("|");
  const mutableState = state as typeof state & { lastObjectRefreshKey?: string };
  if (!force && mutableState.lastObjectRefreshKey === key) return;
  mutableState.lastObjectRefreshKey = key;
  for (const node of state.model.nodes) updateNodeObject(node, state, graph3d);
}

function updateNodeObject(node: RuntimeNode, state: any, graph3d: any) {
  if (!node.__obj) return;
  const score = activationScore(node);
  const pulse = state.focus === node || state.hover === node ? 0.45 : 0;
  const total = Math.min(1.3, score * 0.85 + pulse * 1.15);
  const searchMatch = matchesSearch(node, state.settings.search);
  let alpha = searchMatch ? 1 : 0.15;
  if (state.focus && !linkedToFocus(node, state.focus, state.model) && node !== state.focus) {
    alpha *= 0.12;
  }
  if (node.__sphere?.material) {
    node.__sphere.material.opacity = (0.35 + 0.65 * total) * alpha;
    const scale = 0.7 + score * 0.9 + pulse * 1.3;
    node.__sphere.scale.set(scale, scale, scale);
  }
  if (node.__glow?.material) {
    const camera = graph3d?.camera?.();
    const point = graphPoint(node);
    const distance = camera
      ? Math.hypot(
          camera.position.x - point.x,
          camera.position.y - point.y,
          camera.position.z - point.z,
        )
      : 260;
    const nearDamping = 1 - clamp((340 - distance) / 220, 0, 0.55);
    const glowDamping = (state.visualDensityDamping ?? 1) * nearDamping;
    node.__glow.material.opacity = (0.06 + total * 0.36) * alpha * glowDamping;
    const glowScale = (7 + 15 * total) * clamp(glowDamping + 0.16, 0.54, 1);
    node.__glow.scale.set(glowScale, glowScale, 1);
  }
  const labelOpacity = state.hover === node ? alpha : 0;
  const showLabel = labelOpacity > 0.06;
  if (node.__labelTitle && node.__labelAnon) {
    node.__labelTitle.visible = showLabel && state.settings.showTitles;
    node.__labelAnon.visible = showLabel && !state.settings.showTitles;
    node.__labelTitle.material.opacity = labelOpacity;
    node.__labelAnon.material.opacity = labelOpacity;
  }
}

function memVisible(node: RuntimeNode, state: any) {
  if (
    state.settings.mode === "replay" &&
    (node.createdH > state.settings.simH || node.forgottenH <= state.settings.simH)
  ) {
    return false;
  }
  if (state.clusterFilter && node.clusterKey !== state.clusterFilter) return false;
  if (state.focus) {
    return (
      node === state.focus ||
      node.clusterKey === state.focus.clusterKey ||
      linkedToFocus(node, state.focus, state.model)
    );
  }
  return matchesSearch(node, state.settings.search);
}

function linkVisible(link: RuntimeLink, state: any) {
  if (link.type === "sim" && !state.settings.showSim) return false;
  if (link.type === "hebb" && !state.settings.showHebb) return false;
  if (link.type === "hebb" && Number(link.weight ?? 0) < 0.05) return false;
  const source = typeof link.source === "object" ? link.source : null;
  const target = typeof link.target === "object" ? link.target : null;
  if (
    state.clusterFilter &&
    source?.clusterKey !== state.clusterFilter &&
    target?.clusterKey !== state.clusterFilter
  )
    return false;
  if (state.focus && source !== state.focus && target !== state.focus) return false;
  return (!source || memVisible(source, state)) && (!target || memVisible(target, state));
}

function linkedToFocus(node: RuntimeNode, focus: RuntimeNode, model: ObservatoryModel) {
  return model.adjacentIdsByNodeId.get(focus.id)?.has(node.id) ?? false;
}

function matchesSearch(node: RuntimeNode, query: string) {
  const normalized = query.trim().toLowerCase();
  return !normalized || node.searchText.includes(normalized);
}

function updateReplay(time: number, state: any, graph3d: any) {
  if (state.settings.mode !== "replay" || !state.settings.replayPlaying) return;
  if (state.lastReplayTime === null) state.lastReplayTime = time;
  const next = Math.min(
    720,
    state.settings.simH + ((time - state.lastReplayTime) / 1000) * state.settings.replaySpeed,
  );
  state.lastReplayTime = time;
  state.settings = { ...state.settings, simH: next };
  const bucket = Math.floor(next * 4);
  if (bucket !== state.lastReplayBucket) {
    state.lastReplayBucket = bucket;
    invalidateVisibility(graph3d);
    refreshPanels(state.model, state);
  }
  if (bucket !== state.lastReplayUiBucket) {
    state.lastReplayUiBucket = bucket;
    state.onReplayTimeChange?.(next);
  }
}

function emitRecentParticle(model: ObservatoryModel, graph3d: any) {
  const event = (model.graph.events ?? [])[
    Math.floor(Math.random() * Math.max(1, (model.graph.events ?? []).length))
  ];
  if (!event) return;
  const ids = new Set(event.memoryIds ?? []);
  const relatedLinks = model.links
    .map((item) => {
      const source = typeof item.source === "object" ? item.source.id : item.source;
      const target = typeof item.target === "object" ? item.target.id : item.target;
      const matchedEnds = Number(ids.has(source)) + Number(ids.has(target));
      return { item, matchedEnds, weight: Number(item.weight ?? 0) };
    })
    .filter((entry) => entry.matchedEnds > 0)
    .sort((left, right) => right.matchedEnds - left.matchedEnds || right.weight - left.weight)
    .slice(0, 4)
    .map((entry) => entry.item);
  for (const [index, link] of relatedLinks.entries()) {
    window.setTimeout(() => graph3d.emitParticle(link), index * 90);
  }
}

function refreshPanels(model: ObservatoryModel, state: any) {
  const feed = document.getElementById("feed");
  const forecast = document.getElementById("forecast");
  const legend = document.getElementById("legend");
  const stats = document.getElementById("stats");
  const statusbar = document.getElementById("graph-statusbar");
  if (feed) {
    const html = renderObservatoryFeed(model.graph.events ?? [], model.nodeById);
    if (html !== state.lastFeedHtml) {
      feed.innerHTML = html;
      state.lastFeedHtml = html;
    }
  }
  if (forecast) forecast.innerHTML = renderForecastBars(model.nodes);
  if (legend) {
    legend.innerHTML = model.clusters
      .map(
        (cluster) =>
          `<div data-cluster="${escapeHtml(cluster.key)}" class="${state.clusterFilter === cluster.key ? "active" : ""}"><i style="background:${escapeHtml(cluster.color)}"></i><span>${escapeHtml(cluster.label)}</span></div>`,
      )
      .join("");
    for (const item of Array.from(legend.querySelectorAll<HTMLElement>("[data-cluster]"))) {
      item.addEventListener("click", () => {
        state.clusterFilter =
          state.clusterFilter === item.dataset.cluster ? null : (item.dataset.cluster ?? null);
        refreshPanels(model, state);
      });
    }
  }
  if (stats) {
    stats.innerHTML = [
      `nodes: ${model.nodes.length}`,
      `links: ${model.links.length}`,
      `mode: ${state.settings.mode}`,
      `search: ${escapeHtml(state.settings.search || "-")}`,
      `render: ${state.settings.lowPowerMode ? "low power" : "smooth"}`,
    ].join("<br>");
  }
  if (statusbar) {
    statusbar.innerHTML = [
      `<span>${model.nodes.length} memories</span>`,
      `<span>${model.links.length} links</span>`,
      `<span>${state.settings.lowPowerMode ? "low power" : "smooth"}</span>`,
    ].join("");
  }
}

function renderForecastBars(nodes: RuntimeNode[]) {
  const sorted = [...nodes]
    .sort((a, b) => Number(a.retrievability7d ?? 1) - Number(b.retrievability7d ?? 1))
    .slice(0, 7);
  if (!sorted.length)
    return '<div class="fc"><span class="nm">retrievability</span><span class="pc">-</span></div>';
  return sorted
    .map((node) => {
      const value = clamp(Number(node.retrievability7d ?? 0), 0, 1);
      return `<div class="fc"><span class="nm">${escapeHtml(node.name)}</span><span class="bar"><i style="width:${Math.round(value * 100)}%"></i></span><span class="pc">${Math.round(value * 100)}%</span></div>`;
    })
    .join("");
}

function renderObservatoryFeed(events: GraphEvent[], nodeById: Map<number, RuntimeNode>) {
  const items = events.slice(0, 7);
  if (!items.length) {
    return '<li><span class="q">イベント</span><div class="meta">表示できる最近のイベントはありません</div></li>';
  }
  return items
    .map((event) => {
      const names =
        (event.memoryIds ?? []).map((id) => nodeById.get(id)?.name ?? id).join(", ") || "-";
      return `<li><span class="q">${escapeHtml(eventTypeLabel(event.eventType))}</span><div>${escapeHtml(names)}</div><div class="meta">${escapeHtml(formatEventTime(event.createdAt))}</div></li>`;
    })
    .join("");
}

function showTooltip(node: RuntimeNode | null, event: MouseEvent | undefined, state: any) {
  const tooltip = document.getElementById("tooltip");
  if (!tooltip) return;
  if (!node) {
    tooltip.style.display = "none";
    return;
  }
  const reveal = event?.ctrlKey
    ? `<div class="reveal">${escapeHtml(node.summary ?? "")}</div>`
    : "";
  tooltip.innerHTML = `<strong>${escapeHtml(node.name)}</strong><div class="t">layer: ${escapeHtml(node.layer)} / activation: ${Number(node.activation ?? 0).toFixed(2)}</div>${reveal}`;
  tooltip.style.display = "block";
  tooltip.style.left = `${(event?.clientX ?? 0) + 14}px`;
  tooltip.style.top = `${(event?.clientY ?? 0) + 14}px`;
  state.lastObjectRefreshKey = "";
}

function centerGraphView(
  graph3d: any,
  controls: any,
  model: ObservatoryModel,
  state: any,
  options: { animateMs?: number; fit?: boolean; userInitiated?: boolean },
) {
  if (state.userMovedCamera && options.userInitiated === false) return;
  const view = computeGraphView(model, state);
  state.viewCenter = view.center;
  controls.target.set(view.center.x, view.center.y, view.center.z);
  controls.update();
  if (options.fit && typeof graph3d.cameraPosition === "function") {
    const cameraDistance = clamp(view.radius * 1.65 + 135, 205, 360);
    state.autoCentering = true;
    graph3d.cameraPosition(
      {
        x: view.center.x,
        y: view.center.y + 14,
        z: view.center.z + cameraDistance,
      },
      view.center,
      options.animateMs ?? 700,
    );
    window.setTimeout(
      () => {
        state.autoCentering = false;
      },
      (options.animateMs ?? 700) + 80,
    );
  }
}

function computeGraphView(model: ObservatoryModel, state: any) {
  const nodes = model.nodes.filter((node) => memVisible(node, state));
  if (!nodes.length) {
    return { center: { x: 0, y: 0, z: 0 }, radius: 120 };
  }
  const center = nodes.reduce(
    (acc, node) => {
      const point = graphPoint(node);
      acc.x += point.x;
      acc.y += point.y;
      acc.z += point.z;
      return acc;
    },
    { x: 0, y: 0, z: 0 },
  );
  center.x /= nodes.length;
  center.y /= nodes.length;
  center.z /= nodes.length;
  let radius = 0;
  for (const node of nodes) {
    const point = graphPoint(node);
    radius = Math.max(
      radius,
      Math.hypot(point.x - center.x, point.y - center.y, point.z - center.z),
    );
  }
  return { center, radius: Math.max(80, radius) };
}

function frameDelay(state: any) {
  if (!isRenderable(state)) return 900;
  if (!state.settings.lowPowerMode) return 0;
  if (state.settings.mode === "replay" && state.settings.replayPlaying) return 33;
  const active = state.draggingNode || state.autoCentering || performance.now() < state.activeUntil;
  if (active || state.hover || state.focus || state.settings.autoRotate) return 66;
  return 320;
}

function isRenderable(state: any) {
  return state.settings.active && !document.hidden;
}

function markActive(state: any, graph3d: any, durationMs = 1200) {
  state.activeUntil = performance.now() + durationMs;
  graph3d.resumeAnimation?.();
}

function invalidateVisibility(graph3d: any) {
  graph3d.nodeVisibility(graph3d.nodeVisibility()).linkVisibility(graph3d.linkVisibility());
}

function ensureStatusBar(container: HTMLElement) {
  if (container.querySelector("#graph-statusbar")) return;
  const statusbar = document.createElement("div");
  statusbar.id = "graph-statusbar";
  container.appendChild(statusbar);
}

function graphPoint(node: RuntimeNode | null | undefined) {
  return {
    x: finiteNumber(node?.x, 0),
    y: finiteNumber(node?.y, 0),
    z: finiteNumber(node?.z, 0),
  };
}

function finiteNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function activationScore(node: RuntimeNode) {
  return clamp(Number(node.activation ?? 0.18), 0.04, 1);
}

function eventToHour(event: Pick<GraphEvent, "createdAt">, index: number, total: number) {
  if (event?.createdAt) {
    const time = Date.parse(event.createdAt);
    if (Number.isFinite(time)) return clamp((index / Math.max(1, total - 1)) * 720, 0, 720);
  }
  return clamp((index / Math.max(1, total - 1)) * 720, 0, 720);
}

function shortMemoryTitle(node: Pick<GraphNode, "sourceRef" | "summary">) {
  const source = node.sourceRef ? String(node.sourceRef).split(/[\\/]/).pop() : "";
  const summary = String(node.summary ?? source ?? "memory");
  return summary.length > 34 ? `${summary.slice(0, 31)}...` : summary;
}

function eventTypeLabel(eventType: string) {
  return (
    {
      consolidated: "統合",
      created: "作成",
      forgotten: "忘却",
      retrieved: "参照",
      updated: "更新",
    }[eventType] ?? "イベント"
  );
}

function formatEventTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("ja-JP", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
  });
}

function renderFallback(container: HTMLElement, graph: MemoryGraph, error?: unknown) {
  const reason = error instanceof Error ? error.message : error ? String(error) : null;
  container.innerHTML = `<div id="loading">3D runtime unavailable<br>${graph.nodes.length} memories${reason ? `<br><small>${escapeHtml(reason)}</small>` : ""}</div>`;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function escapeHtml(value: unknown) {
  return String(value).replace(/[&<>"']/g, (char) => {
    const replacements: Record<string, string> = {
      "&": "&amp;",
      '"': "&quot;",
      "'": "&#39;",
      "<": "&lt;",
      ">": "&gt;",
    };
    return replacements[char] ?? char;
  });
}
