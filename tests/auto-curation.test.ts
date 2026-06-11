import { describe, expect, test } from "vitest";

import { buildAutoCurationResult, evaluateMemoryCandidate } from "../src/auto-curation.js";
import type { MemoryUpdateCandidate } from "../src/memory-freshness.js";
import type { Memory } from "../src/types.js";

const baseCandidate: MemoryUpdateCandidate = {
  kind: "pull_request",
  title: "メモリ鮮度と保存候補を表示",
  summary: "PR #79: メモリ鮮度と保存候補を表示",
  sourceType: "github-pr",
  sourceRef: "pr:#79",
  occurredAt: "2026-06-11T03:37:13.000Z",
  reason: "マージ済みPRの実装結果や運用上の学びが通常メモリに未反映の可能性があります。",
  suggestedTool: "propose_memory_update"
};

describe("auto memory curation", () => {
  test("marks high-confidence audited PR candidates for safe auto-write", () => {
    const evaluation = evaluateMemoryCandidate(baseCandidate, []);

    expect(evaluation).toMatchObject({
      decision: "auto_write",
      score: expect.any(Number),
      provenance: {
        quality: "strong",
        recognizedRefs: ["pr"]
      },
      safety: {
        secretDetected: false
      }
    });
    expect(evaluation.score).toBeGreaterThanOrEqual(0.82);
    expect(evaluation.content).toContain("PR #79");
    expect(evaluation.tags).toContain("auto-curated");
  });

  test("downgrades duplicates to review instead of auto-writing", () => {
    const existing = memory({
      id: 1,
      content: "PR memory candidate: PR #79: メモリ鮮度と保存候補を表示. Reason: already saved.",
      sourceRef: "pr:#79"
    });

    const evaluation = evaluateMemoryCandidate(baseCandidate, [existing]);

    expect(evaluation.decision).toBe("review");
    expect(evaluation.duplicateCandidates).toEqual([
      expect.objectContaining({
        memoryId: 1,
        reason: "same_source_ref"
      })
    ]);
  });

  test("review mode never auto-writes even when a candidate is strong", () => {
    const result = buildAutoCurationResult({
      mode: "review",
      candidates: [baseCandidate],
      existingMemories: [],
      now: new Date("2026-06-11T03:40:00Z")
    });

    expect(result.autoWriteCandidates).toEqual([]);
    expect(result.reviewCandidates).toHaveLength(1);
    expect(result.reviewCandidates[0]).toEqual(
      expect.objectContaining({
        decision: "review"
      })
    );
  });

  test("skips candidates that look like secrets", () => {
    const result = buildAutoCurationResult({
      mode: "safe",
      candidates: [
        {
          ...baseCandidate,
          title: "Do not save token",
          summary: "PR #80: accidentally pasted OPENAI_API_KEY=sk-proj-secret123456",
          sourceRef: "pr:#80"
        }
      ],
      existingMemories: []
    });

    expect(result.skippedCandidates).toHaveLength(1);
    expect(result.skippedCandidates[0]?.safety.secretDetected).toBe(true);
  });
});

function memory(input: { id: number; content: string; sourceRef: string }): Memory {
  const now = new Date("2026-06-11T03:00:00Z");
  return {
    id: input.id,
    layer: "recall",
    content: input.content,
    summary: input.content,
    tags: [],
    projectScope: "project:test",
    sourceType: "github-pr",
    sourceRef: input.sourceRef,
    importance: 0.7,
    confidence: 0.85,
    embedding: null,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: null,
    expiresAt: null,
    status: "active"
  };
}
