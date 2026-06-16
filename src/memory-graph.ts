import type { Memory, MemoryEvent } from "./types.js";
import type { MemoryStore } from "./memory-store.js";

export interface MemoryGraphOptions {
  now?: Date;
  limit?: number;
  similarityThreshold?: number;
  maxSimilarityEdges?: number;
  eventLimit?: number;
}

export interface MemoryGraphNode {
  id: number;
  label: string;
  layer: Memory["layer"];
  status: Memory["status"];
  summary: string;
  tags: string[];
  projectScope: string;
  sourceType: string;
  sourceRef: string;
  importance: number;
  confidence: number;
  activation: number;
  retrievability7d: number;
  x: number;
  y: number;
  privacy: "summary-only";
  updatedAt: string;
}

export interface MemoryGraphEdge {
  source: number;
  target: number;
  kind: "similarity" | "hebbian";
  weight: number;
}

export interface SimilarityMemoryGraphEdge extends MemoryGraphEdge {
  kind: "similarity";
  similarity: number;
}

export interface HebbianMemoryGraphEdge extends MemoryGraphEdge {
  kind: "hebbian";
  coRetrievalCount: number;
  lastCoRetrievedAt: string;
}

export interface MemoryGraph {
  generatedAt: string;
  nodes: MemoryGraphNode[];
  clusters: MemoryGraphCluster[];
  edges: {
    similarity: SimilarityMemoryGraphEdge[];
    hebbian: HebbianMemoryGraphEdge[];
  };
  events: MemoryGraphEvent[];
  privacy: {
    contentIncluded: false;
    eventPayloadIncluded: false;
  };
}

export interface MemoryGraphCluster {
  id: string;
  kind: "layer" | "tag" | "projectScope";
  label: string;
  nodeCount: number;
}

export interface MemoryGraphEvent {
  id: number;
  eventType: MemoryEvent["eventType"];
  memoryIds: number[];
  createdAt: string;
}

const DEFAULT_SIMILARITY_THRESHOLD = 0.75;
const DEFAULT_MAX_SIMILARITY_EDGES = 120;
const DEFAULT_MEMORY_LIMIT = 200;
const DEFAULT_EVENT_LIMIT = 100;
const HEBBIAN_DECAY_DAYS = 14;

export function buildMemoryGraph(
  store: MemoryStore,
  options: MemoryGraphOptions = {},
): MemoryGraph {
  const now = options.now ?? new Date();
  const memories = store.listMemories({
    limit: options.limit ?? DEFAULT_MEMORY_LIMIT,
  });
  const events = store.listRecentEvents({ limit: options.eventLimit ?? DEFAULT_EVENT_LIMIT });
  const nodes = memories.map((memory, index) =>
    serializeGraphNode(memory, index, memories.length, now),
  );
  const nodeIds = new Set(nodes.map((node) => node.id));

  return {
    generatedAt: now.toISOString(),
    nodes,
    clusters: buildClusters(memories),
    edges: {
      similarity: buildSimilarityEdges(memories, nodeIds, options),
      hebbian: buildHebbianEdges(events, nodeIds, now),
    },
    events: buildSafeEvents(events, nodeIds),
    privacy: {
      contentIncluded: false,
      eventPayloadIncluded: false,
    },
  };
}

function serializeGraphNode(
  memory: Memory,
  index: number,
  total: number,
  now: Date,
): MemoryGraphNode {
  const angle = total <= 1 ? 0 : (index / total) * Math.PI * 2;
  const radius = 0.35 + 0.45 * hashUnit(`${memory.layer}:${memory.projectScope}:${memory.id}`);
  const activation = activationScore(memory, now);
  return {
    id: memory.id,
    label: `${memory.layer}#${memory.id}`,
    layer: memory.layer,
    status: memory.status,
    summary: memory.summary,
    tags: memory.tags,
    projectScope: memory.projectScope,
    sourceType: memory.sourceType,
    sourceRef: memory.sourceRef,
    importance: memory.importance,
    confidence: memory.confidence,
    activation,
    retrievability7d: retrievability(memory, now, 7),
    x: round(Math.cos(angle) * radius),
    y: round(Math.sin(angle) * radius),
    privacy: "summary-only",
    updatedAt: memory.updatedAt.toISOString(),
  };
}

function buildClusters(memories: Memory[]): MemoryGraphCluster[] {
  const clusters = new Map<string, MemoryGraphCluster>();
  const add = (kind: MemoryGraphCluster["kind"], label: string) => {
    const id = `${kind === "projectScope" ? "project" : kind}:${label}`;
    const existing = clusters.get(id);
    if (existing) {
      existing.nodeCount += 1;
      return;
    }
    clusters.set(id, {
      id,
      kind,
      label,
      nodeCount: 1,
    });
  };

  for (const memory of memories) {
    add("layer", memory.layer);
    add("projectScope", memory.projectScope);
    for (const tag of memory.tags) {
      add("tag", tag);
    }
  }

  return [...clusters.values()].sort(
    (left, right) =>
      right.nodeCount - left.nodeCount ||
      left.kind.localeCompare(right.kind) ||
      left.label.localeCompare(right.label),
  );
}

function buildSimilarityEdges(
  memories: Memory[],
  nodeIds: Set<number>,
  options: MemoryGraphOptions,
): SimilarityMemoryGraphEdge[] {
  const threshold = options.similarityThreshold ?? DEFAULT_SIMILARITY_THRESHOLD;
  const edges: SimilarityMemoryGraphEdge[] = [];

  for (let leftIndex = 0; leftIndex < memories.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < memories.length; rightIndex += 1) {
      const left = memories[leftIndex];
      const right = memories[rightIndex];
      if (!left || !right || !nodeIds.has(left.id) || !nodeIds.has(right.id)) {
        continue;
      }
      const similarity = cosineSimilarity(left.embedding, right.embedding);
      if (similarity < threshold) {
        continue;
      }
      edges.push({
        source: Math.min(left.id, right.id),
        target: Math.max(left.id, right.id),
        kind: "similarity",
        similarity: round(similarity),
        weight: round(similarity),
      });
    }
  }

  return edges
    .sort((left, right) => right.weight - left.weight || left.source - right.source)
    .slice(0, options.maxSimilarityEdges ?? DEFAULT_MAX_SIMILARITY_EDGES);
}

function buildHebbianEdges(
  events: MemoryEvent[],
  nodeIds: Set<number>,
  now: Date,
): HebbianMemoryGraphEdge[] {
  const edges = new Map<
    string,
    {
      source: number;
      target: number;
      coRetrievalCount: number;
      decayedWeight: number;
      lastCoRetrievedAt: Date;
    }
  >();

  for (const event of events) {
    if (event.eventType !== "retrieved") {
      continue;
    }
    const memoryIds = readMemoryIds(event.payload).filter((id) => nodeIds.has(id));
    for (let leftIndex = 0; leftIndex < memoryIds.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < memoryIds.length; rightIndex += 1) {
        const left = memoryIds[leftIndex];
        const right = memoryIds[rightIndex];
        if (left === undefined || right === undefined || left === right) {
          continue;
        }
        const source = Math.min(left, right);
        const target = Math.max(left, right);
        const key = `${source}:${target}`;
        const existing = edges.get(key);
        const ageDays = Math.max(0, now.getTime() - event.createdAt.getTime()) / 86_400_000;
        const decayed = Math.exp(-ageDays / HEBBIAN_DECAY_DAYS);
        edges.set(key, {
          source,
          target,
          coRetrievalCount: (existing?.coRetrievalCount ?? 0) + 1,
          decayedWeight: (existing?.decayedWeight ?? 0) + decayed,
          lastCoRetrievedAt:
            existing && existing.lastCoRetrievedAt > event.createdAt
              ? existing.lastCoRetrievedAt
              : event.createdAt,
        });
      }
    }
  }

  return [...edges.values()]
    .map((edge) => ({
      source: edge.source,
      target: edge.target,
      kind: "hebbian" as const,
      coRetrievalCount: edge.coRetrievalCount,
      weight: round(edge.decayedWeight),
      lastCoRetrievedAt: edge.lastCoRetrievedAt.toISOString(),
    }))
    .sort((left, right) => right.weight - left.weight || left.source - right.source);
}

function buildSafeEvents(events: MemoryEvent[], nodeIds: Set<number>): MemoryGraphEvent[] {
  return events
    .map((event) => {
      const memoryIds =
        event.eventType === "retrieved"
          ? readMemoryIds(event.payload).filter((id) => nodeIds.has(id))
          : event.memoryId && nodeIds.has(event.memoryId)
            ? [event.memoryId]
            : [];
      return {
        id: event.id,
        eventType: event.eventType,
        memoryIds,
        createdAt: event.createdAt.toISOString(),
      };
    })
    .filter((event) => event.memoryIds.length > 0)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

function readMemoryIds(payload: Record<string, unknown>): number[] {
  const value = payload.memoryIds;
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is number => Number.isInteger(item));
}

function activationScore(memory: Memory, now: Date): number {
  const accessTimes = [memory.createdAt, memory.lastAccessedAt, memory.updatedAt].filter(
    (value): value is Date => value instanceof Date,
  );
  const sum = accessTimes.reduce((total, timestamp) => {
    const ageHours = Math.max(1, (now.getTime() - timestamp.getTime()) / 3_600_000);
    return total + Math.pow(ageHours, -0.5);
  }, 0);
  const baseLevel = Math.log(Math.max(sum, 0.0001));
  return round(1 / (1 + Math.exp(-baseLevel)));
}

function retrievability(memory: Memory, now: Date, daysAhead: number): number {
  const lastAccessedAt = memory.lastAccessedAt ?? memory.updatedAt ?? memory.createdAt;
  const accessCount = [memory.createdAt, memory.lastAccessedAt, memory.updatedAt].filter(
    Boolean,
  ).length;
  const stabilityDays = Math.min(45, 0.8 * Math.pow(1.8, Math.max(0, accessCount - 1)));
  const elapsedDays = Math.max(0, now.getTime() - lastAccessedAt.getTime()) / 86_400_000;
  return round(Math.exp(-(elapsedDays + daysAhead) / stabilityDays));
}

function cosineSimilarity(left: number[] | null, right: number[] | null): number {
  if (!left?.length || !right?.length || left.length !== right.length) {
    return 0;
  }

  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dot += leftValue * rightValue;
    leftNorm += leftValue * leftValue;
    rightNorm += rightValue * rightValue;
  }

  if (leftNorm === 0 || rightNorm === 0) {
    return 0;
  }
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

function hashUnit(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0xffffffff;
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
