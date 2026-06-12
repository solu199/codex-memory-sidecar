import { describe, expect, test } from "vitest";

import { buildMemoryFreshness } from "../src/memory-freshness.js";

describe("memory freshness", () => {
  test("reports stale memory when recent workspace activity is newer than the latest memory", () => {
    const report = buildMemoryFreshness({
      latestMemoryUpdatedAt: new Date("2026-05-18T03:35:59.530Z"),
      memoryCount: 3,
      activity: {
        commits: [
          {
            hash: "92e5fcb1234567890",
            subject: "Ollama表示と手動MCP例を改善",
            committedAt: new Date("2026-06-11T03:00:20Z"),
          },
        ],
        issues: [
          {
            number: 78,
            title: "メモリ鮮度と保存候補の導線を改善する",
            updatedAt: new Date("2026-06-11T03:15:00Z"),
            authorLogin: "outside-reviewer",
            externalAuthor: true,
          },
        ],
        pullRequests: [
          {
            number: 77,
            title: "Ollama表示と手動MCP例を改善",
            mergedAt: new Date("2026-06-11T03:00:20Z"),
            authorLogin: "solu199",
            externalAuthor: false,
          },
        ],
      },
      now: new Date("2026-06-11T03:20:00Z"),
    });

    expect(report.freshness).toMatchObject({
      status: "stale",
      latestMemoryUpdatedAt: "2026-05-18T03:35:59.530Z",
      latestWorkspaceActivityAt: "2026-06-11T03:15:00.000Z",
      daysSinceLatestMemoryUpdate: 23,
      daysBehindWorkspaceActivity: 23,
      candidateCount: 3,
    });
    expect(report.candidates).toEqual([
      expect.objectContaining({
        kind: "issue",
        sourceRef: "issue:#78",
        authorLogin: "outside-reviewer",
        externalAuthor: true,
        suggestedTool: "propose_memory_update",
      }),
      expect.objectContaining({
        kind: "pull_request",
        sourceRef: "pr:#77",
        authorLogin: "solu199",
        externalAuthor: false,
        suggestedTool: "propose_memory_update",
      }),
      expect.objectContaining({
        kind: "commit",
        sourceRef: "git:92e5fcb",
        suggestedTool: "propose_memory_update",
      }),
    ]);
  });

  test("reports fresh memory without noisy candidates when memory is current", () => {
    const report = buildMemoryFreshness({
      latestMemoryUpdatedAt: new Date("2026-06-11T03:18:00Z"),
      memoryCount: 4,
      activity: {
        commits: [
          {
            hash: "abc123456789",
            subject: "最近の作業を保存",
            committedAt: new Date("2026-06-11T03:10:00Z"),
          },
        ],
      },
      now: new Date("2026-06-11T03:20:00Z"),
    });

    expect(report.freshness).toMatchObject({
      status: "fresh",
      daysSinceLatestMemoryUpdate: 0,
      daysBehindWorkspaceActivity: 0,
      candidateCount: 0,
    });
    expect(report.candidates).toEqual([]);
  });
});
