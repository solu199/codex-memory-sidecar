import type { DashboardStatus, MemoryDetail, MemoryGraph } from "./types";

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(path);
  const body = (await response.json()) as unknown;
  if (!response.ok) {
    const message =
      typeof body === "object" && body && "error" in body
        ? String((body as { error: unknown }).error)
        : `${path} failed with ${response.status}`;
    throw new Error(message);
  }
  return body as T;
}

export async function fetchDashboardStatus(): Promise<DashboardStatus> {
  return fetchJson<DashboardStatus>("/api/status");
}

export async function fetchMemoryGraph(): Promise<MemoryGraph> {
  return fetchJson<MemoryGraph>("/api/graph");
}

export async function fetchMemoryDetail(
  id: number,
  options: { includeContent?: boolean } = {},
): Promise<MemoryDetail> {
  const suffix = options.includeContent ? "?includeContent=true" : "";
  const response = await fetchJson<
    { ok: true; memory: MemoryDetail } | { ok: false; error: string }
  >(`/api/memories/${id}${suffix}`);
  if (!response.ok) {
    throw new Error(response.error);
  }
  return response.memory;
}
