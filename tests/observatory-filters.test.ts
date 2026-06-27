import { describe, expect, test } from "vitest";

import {
  buildObservatoryFilterOptions,
  matchesObservatoryFilters,
} from "../src/dashboard-app/src/observatory-filters.js";
import type { GraphNode } from "../src/dashboard-app/src/types.js";

describe("observatory filters", () => {
  test("matches composite layer, project scope, tag, and invalidated filters", () => {
    const node: GraphNode = {
      id: 1,
      layer: "recall",
      status: "superseded",
      summary: "Alpha memory",
      tags: ["alpha", "ops"],
      projectScope: "project-a",
      sourceType: "manual",
      sourceRef: "test",
      importance: 0.5,
      confidence: 0.5,
    };

    expect(
      matchesObservatoryFilters(node, {
        layers: ["recall"],
        projectScopes: ["project-a"],
        tags: ["alpha"],
        includeSuperseded: true,
        includeForgotten: false,
      }),
    ).toBe(true);
    expect(
      matchesObservatoryFilters(node, {
        layers: ["core"],
        projectScopes: ["project-a"],
        tags: ["alpha"],
        includeSuperseded: true,
        includeForgotten: false,
      }),
    ).toBe(false);
    expect(
      matchesObservatoryFilters(node, {
        layers: ["recall"],
        projectScopes: ["project-a"],
        tags: ["alpha"],
        includeSuperseded: false,
        includeForgotten: false,
      }),
    ).toBe(false);
  });

  test("builds sorted filter options from graph nodes", () => {
    const options = buildObservatoryFilterOptions([
      {
        id: 2,
        layer: "core",
        status: "active",
        summary: "Beta memory",
        tags: ["beta", "ops"],
        projectScope: "project-b",
        sourceType: "manual",
        sourceRef: "test:b",
        importance: 0.5,
        confidence: 0.5,
      },
      {
        id: 1,
        layer: "recall",
        status: "active",
        summary: "Alpha memory",
        tags: ["alpha", "ops"],
        projectScope: "project-a",
        sourceType: "manual",
        sourceRef: "test:a",
        importance: 0.5,
        confidence: 0.5,
      },
    ]);

    expect(options.layers).toEqual(["core", "recall"]);
    expect(options.projectScopes).toEqual(["project-a", "project-b"]);
    expect(options.tags).toEqual(["alpha", "beta", "ops"]);
  });
});
