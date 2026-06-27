import type { GraphNode, ObservatoryFilterOptions, ObservatoryFilters } from "./types.js";

export function buildObservatoryFilterOptions(nodes: GraphNode[]): ObservatoryFilterOptions {
  return {
    layers: uniqueSorted(nodes.map((node) => node.layer)),
    projectScopes: uniqueSorted(nodes.map((node) => node.projectScope)),
    tags: uniqueSorted(nodes.flatMap((node) => node.tags)),
  };
}

export function matchesObservatoryFilters(node: GraphNode, filters: ObservatoryFilters): boolean {
  if (!filters.includeSuperseded && node.status === "superseded") {
    return false;
  }
  if (!filters.includeForgotten && node.status === "forgotten") {
    return false;
  }
  if (filters.layers.length && !filters.layers.includes(node.layer)) {
    return false;
  }
  if (filters.projectScopes.length && !filters.projectScopes.includes(node.projectScope)) {
    return false;
  }
  if (filters.tags.length && !filters.tags.some((tag) => node.tags.includes(tag))) {
    return false;
  }
  return true;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right));
}
