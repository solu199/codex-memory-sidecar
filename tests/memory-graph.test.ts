import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { buildMemoryGraph } from "../src/memory-graph.js";
import { MemoryStore } from "../src/memory-store.js";

describe("memory graph", () => {
  let tempDir: string;
  let store: MemoryStore;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), "codex-memory-sidecar-graph-"));
    store = new MemoryStore(path.join(tempDir, "memory.sqlite"));
  });

  afterEach(() => {
    store.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("builds privacy-safe nodes with activation and forgetting forecast", () => {
    const now = new Date("2026-06-13T00:00:00.000Z");
    const memory = store.createMemory({
      content: "Private memory body must not be exposed in graph data.",
      summary: "Graph-safe summary",
      layer: "recall",
      tags: ["dashboard", "graph"],
      sourceType: "manual",
      sourceRef: "test:graph",
      embedding: [1, 0, 0],
    });

    const graph = buildMemoryGraph(store, { now });

    expect(graph.generatedAt).toBe(now.toISOString());
    expect(graph.nodes).toEqual([
      expect.objectContaining({
        id: memory.id,
        label: "recall#1",
        layer: "recall",
        summary: "Graph-safe summary",
        tags: ["dashboard", "graph"],
        sourceType: "manual",
        sourceRef: "test:graph",
        activation: expect.any(Number),
        retrievability7d: expect.any(Number),
        privacy: "summary-only",
      }),
    ]);
    expect(graph.nodes[0]?.activation).toBeGreaterThanOrEqual(0);
    expect(graph.nodes[0]?.activation).toBeLessThanOrEqual(1);
    expect(graph.nodes[0]?.retrievability7d).toBeGreaterThanOrEqual(0);
    expect(graph.nodes[0]?.retrievability7d).toBeLessThanOrEqual(1);
    expect(JSON.stringify(graph)).not.toContain("Private memory body");
    expect(JSON.stringify(graph)).not.toContain("payload");
  });

  test("creates similarity and hebbian co-retrieval edges without storing dashboard observations", () => {
    const first = store.createMemory({
      content: "Alpha private content.",
      summary: "Alpha summary",
      layer: "recall",
      tags: ["alpha"],
      sourceType: "manual",
      sourceRef: "test:first",
      embedding: [1, 0, 0],
    });
    const second = store.createMemory({
      content: "Beta private content.",
      summary: "Beta summary",
      layer: "recall",
      tags: ["beta"],
      sourceType: "manual",
      sourceRef: "test:second",
      embedding: [0.95, 0.05, 0],
    });
    store.createMemory({
      content: "Gamma private content.",
      summary: "Gamma summary",
      layer: "archival",
      tags: ["gamma"],
      sourceType: "manual",
      sourceRef: "test:third",
      embedding: [0, 1, 0],
    });

    store.searchMemory({ query: "Alpha Beta", limit: 2 });
    const beforeEventCount = store.countRecords().eventCount;

    const graph = buildMemoryGraph(store, {
      similarityThreshold: 0.9,
      now: new Date("2026-06-13T00:00:00.000Z"),
    });

    expect(graph.edges.similarity).toEqual([
      expect.objectContaining({
        source: first.id,
        target: second.id,
        kind: "similarity",
        weight: expect.any(Number),
      }),
    ]);
    expect(graph.edges.hebbian).toEqual([
      expect.objectContaining({
        source: expect.any(Number),
        target: expect.any(Number),
        kind: "hebbian",
        coRetrievalCount: 1,
        weight: expect.any(Number),
      }),
    ]);
    expect(new Set([graph.edges.hebbian[0]?.source, graph.edges.hebbian[0]?.target])).toEqual(
      new Set([first.id, second.id]),
    );
    expect(store.countRecords().eventCount).toBe(beforeEventCount);
  });

  test("summarizes clusters and safe replay events without exposing event payloads", () => {
    const first = store.createMemory({
      content: "Cluster alpha private body.",
      summary: "Cluster alpha summary",
      layer: "recall",
      tags: ["alpha", "dashboard"],
      sourceType: "manual",
      sourceRef: "test:cluster-alpha",
      projectScope: "project-alpha",
      embedding: [1, 0, 0],
    });
    const second = store.createMemory({
      content: "Cluster beta private body.",
      summary: "Cluster beta summary",
      layer: "core",
      tags: ["beta"],
      sourceType: "manual",
      sourceRef: "test:cluster-beta",
      projectScope: "project-beta",
      embedding: [0, 1, 0],
    });

    store.searchMemory({ query: "Cluster", includeCrossProject: true, limit: 2 });

    const graph = buildMemoryGraph(store, {
      now: new Date("2026-06-13T00:00:00.000Z"),
    });

    expect(graph.clusters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "layer:recall",
          kind: "layer",
          label: "recall",
          nodeCount: 1,
        }),
        expect.objectContaining({
          id: "tag:alpha",
          kind: "tag",
          label: "alpha",
          nodeCount: 1,
        }),
        expect.objectContaining({
          id: "project:project-beta",
          kind: "projectScope",
          label: "project-beta",
          nodeCount: 1,
        }),
      ]),
    );
    expect(graph.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "created",
          memoryIds: [first.id],
          createdAt: expect.any(String),
        }),
        expect.objectContaining({
          eventType: "retrieved",
          memoryIds: expect.arrayContaining([first.id, second.id]),
          createdAt: expect.any(String),
        }),
      ]),
    );
    expect(JSON.stringify(graph.events)).not.toContain("query");
    expect(JSON.stringify(graph.events)).not.toContain("payload");
    expect(graph.privacy).toMatchObject({
      contentIncluded: false,
      eventPayloadIncluded: false,
    });
  });
});
