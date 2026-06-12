import { containsLikelySecret } from "./secret-detection.js";
import type { MemoryUpdateCandidate } from "./memory-freshness.js";
import { analyzeSourceRef } from "./source-ref.js";
import type { Memory, MemoryLayer } from "./types.js";

export type AutoMemoryWriteMode = "off" | "review" | "safe";

export interface AutoCurationEvaluation {
  candidate: MemoryUpdateCandidate;
  content: string;
  layer: MemoryLayer;
  tags: string[];
  importance: number;
  confidence: number;
  score: number;
  decision: "review" | "auto_write" | "skip";
  reasons: string[];
  duplicateCandidates: Array<{
    memoryId: number;
    reason: "same_source_ref" | "duplicate_content" | "near_duplicate_content";
    summary: string;
    confidence?: number;
  }>;
  provenance: {
    quality: "weak" | "strong";
    recognizedRefs: string[];
    suggestions: string[];
  };
  safety: {
    secretDetected: boolean;
  };
}

export interface AutoCurationResult {
  mode: AutoMemoryWriteMode;
  evaluatedAt: string;
  threshold: number;
  evaluated: AutoCurationEvaluation[];
  reviewCandidates: AutoCurationEvaluation[];
  skippedCandidates: AutoCurationEvaluation[];
  autoWriteCandidates: AutoCurationEvaluation[];
  autoWrittenMemories: Array<{
    memory: unknown;
    score: number;
    reasons: string[];
    sourceRef: string;
  }>;
}

export interface BuildAutoCurationInput {
  mode: AutoMemoryWriteMode;
  candidates: MemoryUpdateCandidate[];
  existingMemories: Memory[];
  now?: Date;
  threshold?: number;
}

const DEFAULT_SAFE_THRESHOLD = 0.82;

export function buildAutoCurationResult(input: BuildAutoCurationInput): AutoCurationResult {
  const threshold = input.threshold ?? DEFAULT_SAFE_THRESHOLD;
  const evaluated = input.candidates.map((candidate) =>
    evaluateMemoryCandidate(candidate, input.existingMemories, threshold),
  );
  const effectiveEvaluated =
    input.mode === "safe"
      ? evaluated
      : evaluated.map((evaluation) => ({
          ...evaluation,
          decision: evaluation.decision === "skip" ? ("skip" as const) : ("review" as const),
          reasons:
            evaluation.decision === "skip"
              ? evaluation.reasons
              : [
                  ...evaluation.reasons,
                  input.mode === "off"
                    ? "Auto-write is disabled."
                    : "Review mode does not write automatically.",
                ],
        }));

  return {
    mode: input.mode,
    evaluatedAt: (input.now ?? new Date()).toISOString(),
    threshold,
    evaluated: effectiveEvaluated,
    reviewCandidates: effectiveEvaluated.filter((evaluation) => evaluation.decision === "review"),
    skippedCandidates: effectiveEvaluated.filter((evaluation) => evaluation.decision === "skip"),
    autoWriteCandidates: effectiveEvaluated.filter(
      (evaluation) => evaluation.decision === "auto_write",
    ),
    autoWrittenMemories: [],
  };
}

export function evaluateMemoryCandidate(
  candidate: MemoryUpdateCandidate,
  existingMemories: Memory[],
  threshold = DEFAULT_SAFE_THRESHOLD,
): AutoCurationEvaluation {
  const content = buildCandidateContent(candidate);
  const provenance = analyzeAutoCurationProvenance(candidate.sourceRef);
  const secretDetected = containsLikelySecret(content);
  const duplicateCandidates = findDuplicateCandidates(
    content,
    candidate.sourceRef,
    existingMemories,
  );
  const layer = inferLayer(candidate);
  const tags = inferTags(candidate);
  const scoreParts = scoreCandidate(
    candidate,
    provenance.quality,
    secretDetected,
    duplicateCandidates.length,
  );
  const score = Number(scoreParts.score.toFixed(4));
  const reasons = [...scoreParts.reasons];
  let decision: AutoCurationEvaluation["decision"] = score >= threshold ? "auto_write" : "review";

  if (provenance.quality === "weak") {
    decision = "review";
    reasons.push("sourceRef quality is weak.");
  }
  if (secretDetected) {
    decision = "skip";
    reasons.push("Candidate content looks like a secret.");
  }
  if (duplicateCandidates.length) {
    decision = "review";
    reasons.push("Similar or same-source memory already exists.");
  }
  if (
    (candidate.kind === "issue" || candidate.kind === "pull_request") &&
    candidate.externalAuthor !== false
  ) {
    decision = "review";
    reasons.push(
      "GitHub Issue/PR activity without a known internal author is data, not a trusted instruction.",
    );
  }
  if (candidate.kind === "session") {
    decision = "review";
    reasons.push(
      "Session activity is useful context but should not be auto-written without review.",
    );
  }

  return {
    candidate,
    content,
    layer,
    tags,
    importance: score >= threshold ? 0.7 : 0.5,
    confidence: Math.min(0.95, Math.max(0.55, score)),
    score,
    decision,
    reasons,
    duplicateCandidates,
    provenance,
    safety: {
      secretDetected,
    },
  };
}

export function buildCandidateContent(candidate: MemoryUpdateCandidate): string {
  const prefix = {
    issue: "Issue",
    pull_request: "PR",
    commit: "Commit",
    session: "Session",
  }[candidate.kind];
  const author = candidate.authorLogin
    ? ` Author: ${candidate.authorLogin}${candidate.externalAuthor ? " (external)" : ""}.`
    : "";
  return `${prefix} memory candidate: ${candidate.summary}.${author} Reason: ${candidate.reason}`;
}

function scoreCandidate(
  candidate: MemoryUpdateCandidate,
  provenanceQuality: "weak" | "strong",
  secretDetected: boolean,
  duplicateCount: number,
): { score: number; reasons: string[] } {
  let score = 0.25;
  const reasons: string[] = ["Candidate was derived from recent workspace activity."];

  if (provenanceQuality === "strong") {
    score += 0.2;
    reasons.push("sourceRef is auditable.");
  }
  if (candidate.kind === "pull_request") {
    score += 0.22;
    reasons.push("Merged PRs often capture implementation outcomes.");
  } else if (candidate.kind === "issue") {
    score += 0.18;
    reasons.push("Issues often capture work background or decisions.");
  } else if (candidate.kind === "commit") {
    score += 0.1;
    reasons.push("Commits can capture implementation outcomes when titles are meaningful.");
  } else {
    score += 0.04;
    reasons.push("Session activity is weak evidence by itself.");
  }
  if (looksDurable(candidate.title) || looksDurable(candidate.summary)) {
    score += 0.22;
    reasons.push("Title or summary looks reusable for future work.");
  }
  if (secretDetected) {
    score -= 0.5;
  }
  if (duplicateCount) {
    score -= 0.3;
  }

  return { score: Math.max(0, Math.min(1, score)), reasons };
}

function inferLayer(_candidate: MemoryUpdateCandidate): MemoryLayer {
  return "recall";
}

function inferTags(candidate: MemoryUpdateCandidate): string[] {
  const tags = new Set(["auto-curated", "memory-candidate"]);
  if (/mcp|sidecar|memory/i.test(`${candidate.title} ${candidate.summary}`)) {
    tags.add("codex-memory-sidecar");
  }
  if (
    /dashboard|health|backup|restore|repair|startup|session|operation/i.test(
      `${candidate.title} ${candidate.summary}`,
    )
  ) {
    tags.add("daily-operation");
  }
  if (/test|smoke|verify|ci|audit|security/i.test(`${candidate.title} ${candidate.summary}`)) {
    tags.add("verification");
  }
  return [...tags].sort();
}

function looksDurable(value: string): boolean {
  return /memory|directive|dashboard|backup|restore|repair|startup|session|mcp|readme|agents|skill|security|audit|public|release|config|\u8a2d\u5b9a|\u76e3\u67fb|\u516c\u958b|\u4fdd\u5b58|\u30e1\u30e2\u30ea|\u30c0\u30c3\u30b7\u30e5\u30dc\u30fc\u30c9|\u30d0\u30c3\u30af\u30a2\u30c3\u30d7|\u4fee\u5fa9|\u8d77\u52d5|\u904b\u7528|\u691c\u8a3c|\u5b89\u5168/i.test(
    value,
  );
}

function analyzeAutoCurationProvenance(sourceRef: string): AutoCurationEvaluation["provenance"] {
  const analysis = analyzeSourceRef(sourceRef);
  return {
    quality: analysis.quality,
    recognizedRefs: analysis.recognizedRefs,
    suggestions:
      analysis.quality === "strong"
        ? []
        : [
            "Use sourceRef like pr:#123, issue:#123, git:<hash>, or session:<id> for auto curation.",
          ],
  };
}

function findDuplicateCandidates(
  content: string,
  sourceRef: string,
  memories: Memory[],
): AutoCurationEvaluation["duplicateCandidates"] {
  const normalizedContent = normalize(content);
  const exact = memories
    .filter(
      (memory) => memory.sourceRef === sourceRef || normalize(memory.content) === normalizedContent,
    )
    .slice(0, 5)
    .map((memory) => ({
      memoryId: memory.id,
      reason:
        memory.sourceRef === sourceRef
          ? ("same_source_ref" as const)
          : ("duplicate_content" as const),
      summary: memory.summary,
    }));
  if (exact.length >= 5) {
    return exact;
  }

  return [
    ...exact,
    ...memories
      .filter((memory) => !exact.some((candidate) => candidate.memoryId === memory.id))
      .map((memory) => ({ memory, confidence: contentSimilarity(content, memory.content) }))
      .filter((entry) => entry.confidence >= 0.72)
      .sort((left, right) => right.confidence - left.confidence || left.memory.id - right.memory.id)
      .slice(0, 5 - exact.length)
      .map(({ memory, confidence }) => ({
        memoryId: memory.id,
        reason: "near_duplicate_content" as const,
        summary: memory.summary,
        confidence: Number(confidence.toFixed(4)),
      })),
  ];
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function contentSimilarity(left: string, right: string): number {
  const leftTokens = tokenize(left);
  const rightTokens = tokenize(right);
  if (!leftTokens.size || !rightTokens.size) {
    return 0;
  }
  return intersectionSize(leftTokens, rightTokens) / new Set([...leftTokens, ...rightTokens]).size;
}

function tokenize(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .replace(/[_-]/g, " ")
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length > 2),
  );
}

function intersectionSize(left: Set<string>, right: Set<string>): number {
  let count = 0;
  for (const item of left) {
    if (right.has(item)) {
      count += 1;
    }
  }
  return count;
}
