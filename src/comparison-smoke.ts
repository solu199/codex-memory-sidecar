#!/usr/bin/env node
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { EmbeddingProvider } from "./embedding.js";
import { createToolHandlers } from "./mcp-tools.js";
import { MemoryStore } from "./memory-store.js";

type ComparisonCondition = "mcp_off" | "start_session_only" | "full_mcp_operation";

export interface ComparisonSmokeResult {
  ok: boolean;
  databasePath: string;
  checks: Record<string, boolean>;
  evaluationMatrix: Array<{
    condition: ComparisonCondition;
    purpose: string;
    primarySources: string[];
    expectedStrength: string;
  }>;
  recommendations: string[];
  warnings: string[];
}

class DeterministicEmbeddingProvider implements EmbeddingProvider {
  async embed(input: string): Promise<number[]> {
    const normalized = input.toLowerCase();
    return [
      normalized.includes("comparison") ? 1 : 0,
      normalized.includes("session") ? 1 : 0,
      normalized.includes("provenance") ? 1 : 0
    ];
  }
}

export async function runComparisonSmoke(): Promise<ComparisonSmokeResult> {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "codex-memory-sidecar-comparison-"));
  const databasePath = path.join(tempDir, "memory.sqlite");
  const projectPath = path.join(tempDir, "project-alpha");
  const store = new MemoryStore(databasePath);
  const tools = createToolHandlers(store, { embeddingProvider: new DeterministicEmbeddingProvider() });

  try {
    await tools.writeMemory({
      content:
        "Codex Memory Sidecar comparison evaluation: MCP is strongest as supporting context for startup safety, prior chat-derived operational memory, and audit trails; README/docs/git/current files remain the source of truth.",
      layer: "core",
      tags: ["comparison-evaluation", "provenance"],
      sourceType: "evaluation",
      sourceRef: "evaluation:comparison-smoke",
      projectPath,
      importance: 0.8,
      confidence: 0.85
    });

    const noMcpBaseline = buildEvaluationMatrix()[0];
    const session = await tools.startMemorySession({
      taskDescription: "comparison evaluation session provenance",
      projectPath,
      maxTokens: 300
    });
    const search = await tools.searchMemory({
      query: "comparison evaluation provenance",
      projectPath,
      limit: 5
    });
    const proposal = await tools.proposeMemoryUpdate({
      content:
        "Use MCP as supporting context, not as a replacement for README/docs/git/current files.",
      taskContext: "comparison evaluation durable rule",
      sourceType: "evaluation",
      sourceRef: "evaluation:comparison-smoke / docs/daily-operations.md",
      projectPath
    });
    const audit = await tools.auditMemory({ limit: 20 });

    const checks = {
      noMcpBaselineHasPrimarySources:
        noMcpBaseline?.condition === "mcp_off" &&
        noMcpBaseline.primarySources.includes("README/docs") &&
        noMcpBaseline.primarySources.includes("git history"),
      startSessionGuidance:
        session.structuredContent.ready === true &&
        session.structuredContent.sessionGuidance.memoryUse === "supporting_context" &&
        session.structuredContent.sessionGuidance.mustVerify.some((item: string) => item.includes("README/docs")),
      fullOperationFindsComparisonMemory:
        search.structuredContent.memories.length > 0 &&
        search.structuredContent.memories[0]?.summary.includes("comparison evaluation"),
      provenanceGuidanceStrong:
        proposal.structuredContent.provenance.quality === "strong" &&
        proposal.structuredContent.provenance.recognizedRefs.includes("named_run") &&
        proposal.structuredContent.provenance.recognizedRefs.includes("doc_path"),
      searchKeepsEmbeddingsHiddenByDefault:
        search.structuredContent.memories.every((memory) => memory.embedding === null),
      auditRecorded: audit.structuredContent.events.some((event) => event.eventType === "retrieved")
    };

    return {
      ok: Object.values(checks).every(Boolean),
      databasePath,
      checks,
      evaluationMatrix: buildEvaluationMatrix(),
      recommendations: [
        "Use MCP as supporting context, not as a replacement for README/docs/git/current files.",
        "Use start_memory_session to check health, backup retention, and memory availability before nontrivial work.",
        "Use propose_memory_update before saving evaluation outcomes so weak sourceRef values can be improved first."
      ],
      warnings: [
        ...session.structuredContent.warnings,
        ...search.structuredContent.warnings,
        ...proposal.structuredContent.warnings
      ]
    };
  } finally {
    store.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function buildEvaluationMatrix(): ComparisonSmokeResult["evaluationMatrix"] {
  return [
    {
      condition: "mcp_off",
      purpose: "Establish what README/docs/git/current files can answer without memory.",
      primarySources: ["README/docs", "actual files", "git history"],
      expectedStrength: "Current implementation facts and exact provenance."
    },
    {
      condition: "start_session_only",
      purpose: "Check startup safety, relevant summaries, backup retention, and over-trust guidance.",
      primarySources: ["start_memory_session"],
      expectedStrength: "Fast startup context and safety status."
    },
    {
      condition: "full_mcp_operation",
      purpose: "Use search, audit, and propose flows to evaluate whether memory improves future work.",
      primarySources: ["search_memory", "audit_memory", "propose_memory_update"],
      expectedStrength: "Prior chat-derived operational memory, auditability, and durable lesson capture."
    }
  ];
}

async function main(): Promise<void> {
  const result = await runComparisonSmoke();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main();
}
