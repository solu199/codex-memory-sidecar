#!/usr/bin/env node
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";

import { createDashboardServer } from "./dashboard.js";
import type { EmbeddingProvider } from "./embedding.js";
import type { WorkspaceActivity } from "./memory-freshness.js";
import { createToolHandlers } from "./mcp-tools.js";
import { MemoryStore } from "./memory-store.js";

export interface PracticalSmokeResult {
  ok: boolean;
  databasePath: string;
  checks: Record<string, boolean>;
  memoryCount: number;
  eventCount: number;
  dashboardProjectScopes: string[];
  dashboardRecentSources: string[];
  backupPath: string;
  warnings: string[];
}

class DeterministicEmbeddingProvider implements EmbeddingProvider {
  async embed(input: string): Promise<number[]> {
    const normalized = input.toLowerCase();
    return [
      normalized.includes("practical") ? 1 : 0,
      normalized.includes("alpha") ? 1 : 0,
      normalized.includes("beta") ? 1 : 0,
    ];
  }
}

export async function runPracticalSmoke(): Promise<PracticalSmokeResult> {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "codex-memory-sidecar-practical-"));
  const databasePath = path.join(tempDir, "memory.sqlite");
  const projectPath = path.join(tempDir, "project-alpha");
  const store = new MemoryStore(databasePath);
  const embeddingProvider = new DeterministicEmbeddingProvider();
  const workspaceActivity: WorkspaceActivity = {
    commits: [
      {
        hash: "92e5fcb1234567890",
        subject: "Ollama表示と手動MCP例を改善",
        committedAt: new Date("2026-06-20T03:00:20Z"),
      },
    ],
    pullRequests: [
      {
        number: 77,
        title: "Ollama表示と手動MCP例を改善",
        mergedAt: new Date("2026-06-20T03:00:20Z"),
        authorLogin: "solu199",
        externalAuthor: false,
      },
    ],
  };
  const tools = createToolHandlers(store, {
    embeddingProvider,
    workspaceActivity,
    now: new Date("2026-06-20T03:20:00Z"),
  });
  let backupPath = "";

  try {
    const alpha = await tools.writeMemory({
      content: "Practical scoped memory for alpha project.",
      layer: "recall",
      tags: ["practical", "alpha"],
      sourceType: "smoke",
      sourceRef: "npm run smoke:practical",
      projectPath,
    });
    const proposal = await tools.proposeMemoryUpdate({
      content: "Practical scoped memory for alpha project.",
      taskContext: "practical smoke duplicate proposal",
      sourceType: "smoke",
      sourceRef: "npm run smoke:practical",
      projectPath,
    });
    await tools.writeMemory({
      content: "Practical scoped memory for beta project.",
      layer: "recall",
      tags: ["practical", "beta"],
      sourceType: "smoke",
      sourceRef: "npm run smoke:practical",
      projectScope: "beta",
    });
    const directiveProposal = await tools.proposeDirectiveUpdate({
      content:
        "For practical smoke runs, directive memory must be visible in start_memory_session and Dashboard.",
      taskContext: "project directive practical smoke",
      sourceType: "smoke",
      sourceRef: "npm run smoke:practical",
      projectPath,
    });
    const directive = await tools.writeDirective({
      content:
        "For practical smoke runs, directive memory must be visible in start_memory_session and Dashboard.",
      scope: "project",
      projectPath,
      rationale: "Practical smoke validates directive memory surfaces.",
      tags: ["practical", "directive"],
      sourceType: "smoke",
      sourceRef: "npm run smoke:practical",
    });
    const listedDirectives = await tools.listDirectives({ projectPath });

    const scopedSearch = await tools.searchMemory({
      query: "Practical scoped memory",
      projectPath,
      limit: 10,
    });
    const crossProjectSearch = await tools.searchMemory({
      query: "Practical scoped memory",
      projectPath,
      includeCrossProject: true,
      limit: 10,
    });
    const session = await tools.startMemorySession({
      taskDescription: "Practical scoped memory",
      projectPath,
      maxTokens: 200,
    });
    const digest = await tools.memoryDigest({
      taskDescription: "Practical scoped memory",
      projectPath,
      maxTokens: 200,
    });
    const backup = await tools.backupMemory({});
    backupPath = backup.structuredContent.backupPath;
    const retention = await tools.planBackupRetention({ keepCount: 0 });
    const verification = await tools.verifyBackup({ backupPath });
    const inspection = await tools.inspectBackup({
      backupPath,
      projectPath,
      limit: 10,
    });
    const duplicateRule = await tools.writeMemory({
      content: "Call start_memory_session before multi-file implementation work.",
      layer: "core",
      tags: ["consolidation"],
      sourceType: "smoke",
      sourceRef: "npm run smoke:practical",
      projectPath,
    });
    const nearDuplicateRule = await tools.writeMemory({
      content: "Before multi file implementation work, call start memory session.",
      layer: "core",
      tags: ["consolidation"],
      sourceType: "smoke",
      sourceRef: "npm run smoke:practical",
      projectPath,
    });
    const nearDuplicateProposal = await tools.proposeMemoryUpdate({
      content: "Call start memory session before multi file implementation work.",
      taskContext: "daily operation rule",
      sourceType: "smoke",
      sourceRef: "npm run smoke:practical",
      projectPath,
    });
    const consolidation = await tools.consolidateMemory({
      layers: ["core"],
      dryRun: true,
      projectPath,
      maxCandidates: 10,
    });
    const restorePlan = await tools.planBackupRestore({ backupPath });
    const repairDb = new Database(databasePath);
    try {
      repairDb
        .prepare("DELETE FROM memories_fts WHERE rowid = ?")
        .run(alpha.structuredContent.memory.id);
    } finally {
      repairDb.close();
    }
    const repair = await tools.repairMemoryIndex({});
    const audit = await tools.auditMemory({ limit: 20 });
    const dashboard = await fetchDashboardSnapshot(store, embeddingProvider, workspaceActivity);
    const counts = store.countRecords();

    const scopedIds = scopedSearch.structuredContent.memories.map((memory) => memory.id);
    const crossScopeNames = crossProjectSearch.structuredContent.memories.map(
      (memory) => memory.projectScope,
    );
    const dashboardProjectScopes = dashboard.memoryStats.byProjectScope.map(
      (scope) => scope.projectScope,
    );
    const dashboardRecentSources = dashboard.recentMemories.map(
      (memory) => `${memory.sourceType}:${memory.sourceRef}`,
    );
    const checks = {
      writeMemory: alpha.structuredContent.memory.projectScope.startsWith("project:"),
      proposeMemoryUpdate:
        proposal.structuredContent.recommendation === "update" &&
        proposal.structuredContent.wouldWrite === false &&
        proposal.structuredContent.duplicateCandidates.some(
          (candidate) => candidate.memoryId === alpha.structuredContent.memory.id,
        ) &&
        proposal.structuredContent.curation.recommendedLayer === "recall" &&
        proposal.structuredContent.provenance.recognizedRefs.includes("named_run"),
      scopedSearchExcludesBeta:
        scopedIds.length === 1 && scopedIds[0] === alpha.structuredContent.memory.id,
      crossProjectSearchIncludesBeta: crossScopeNames.includes("beta"),
      startMemorySession:
        session.structuredContent.ready === true &&
        session.structuredContent.digest.includes("alpha project") &&
        session.structuredContent.directives.some(
          (item) => item.id === directive.structuredContent.directive.id,
        ) &&
        !JSON.stringify(session.structuredContent).includes("beta project") &&
        session.structuredContent.sessionGuidance.memoryUse === "supporting_context" &&
        session.structuredContent.sessionGuidance.priorityOrder.includes("directive_memory") &&
        session.structuredContent.sessionGuidance.suggestedNextTools.includes("list_directives"),
      directiveMemory:
        directiveProposal.structuredContent.recommendation === "ask_user" &&
        directiveProposal.structuredContent.scopeGuidance.requiresUserChoice === true &&
        listedDirectives.structuredContent.directives.some(
          (item) =>
            item.id === directive.structuredContent.directive.id && item.scope === "project",
        ),
      startMemorySessionBackupRetention:
        session.structuredContent.backupRetention.backupDir === path.join(tempDir, "backups") &&
        session.structuredContent.backupRetention.keepCount === 10 &&
        session.structuredContent.backupRetention.backupCount === 0 &&
        session.structuredContent.backupRetention.prunableCount === 0 &&
        session.structuredContent.backupRetention.wouldDelete === false,
      startMemorySessionMemoryFreshness:
        session.structuredContent.memoryFreshness.status === "stale" &&
        session.structuredContent.autoMemoryCuration.mode === "safe" &&
        session.structuredContent.autoMemoryCuration.autoWrittenMemories.some(
          (item) => item.sourceRef === "pr:#77",
        ) &&
        session.structuredContent.memoryUpdateCandidates.some(
          (candidate) => candidate.sourceRef === "git:92e5fcb",
        ) &&
        session.structuredContent.memoryUpdateCandidates.some(
          (candidate) => candidate.kind === "session",
        ),
      consolidateNearDuplicate:
        consolidation.structuredContent.proposedMerges.some(
          (proposal) =>
            proposal.reason === "near_duplicate_content" &&
            proposal.memoryIds.includes(duplicateRule.structuredContent.memory.id) &&
            proposal.memoryIds.includes(nearDuplicateRule.structuredContent.memory.id),
        ) && store.getMemory(nearDuplicateRule.structuredContent.memory.id)?.status === "active",
      proposeNearDuplicate:
        nearDuplicateProposal.structuredContent.recommendation === "update" &&
        nearDuplicateProposal.structuredContent.duplicateCandidates.some(
          (candidate) => candidate.reason === "near_duplicate_content",
        ) &&
        nearDuplicateProposal.structuredContent.curation.shouldPromoteToCore === true,
      digestUsesScopedMemory:
        digest.structuredContent.digest.includes("alpha project") &&
        !digest.structuredContent.digest.includes("beta project"),
      backupVerified: verification.structuredContent.ok === true,
      backupRetentionDryRun:
        retention.structuredContent.wouldDelete === false &&
        retention.structuredContent.prunable.some((entry) => entry.backupPath === backupPath) &&
        existsSync(backupPath),
      backupRestoreDryRun:
        restorePlan.structuredContent.ok === true &&
        restorePlan.structuredContent.wouldRestore === false &&
        restorePlan.structuredContent.backup.memoryCount <
          restorePlan.structuredContent.current.memoryCount &&
        existsSync(backupPath),
      inspectBackupScoped:
        inspection.structuredContent.memories.some(
          (memory) => memory.id === alpha.structuredContent.memory.id,
        ) && inspection.structuredContent.memories.some((memory) => memory.sourceRef === "pr:#77"),
      repairMemoryIndex:
        repair.structuredContent.repaired === true &&
        repair.structuredContent.before.fts.missingCount === 1 &&
        repair.structuredContent.after.ok === true,
      auditRecorded: audit.structuredContent.events.some(
        (event) => event.eventType === "retrieved",
      ),
      dashboardShowsProjectScopes:
        dashboard.ok === true &&
        dashboardProjectScopes.includes(alpha.structuredContent.memory.projectScope) &&
        dashboardProjectScopes.includes("beta") &&
        dashboardRecentSources.includes("smoke:npm run smoke:practical"),
      dashboardShowsDirectiveMemory:
        dashboard.directives.some((item) =>
          item.content.includes("directive memory must be visible"),
        ) &&
        dashboard.directives.some((item) => item.id === directive.structuredContent.directive.id),
      dashboardShowsMemoryFreshness:
        dashboard.memoryFreshness.status === "stale" &&
        dashboard.autoMemoryCuration.mode === "safe" &&
        dashboard.memoryUpdateCandidates.some((candidate) => candidate.sourceRef === "pr:#77") &&
        dashboard.memoryUpdateCandidates.some((candidate) => candidate.sourceRef === "git:92e5fcb"),
    };

    return {
      ok: Object.values(checks).every(Boolean),
      databasePath,
      checks,
      memoryCount: counts.memoryCount,
      eventCount: counts.eventCount,
      dashboardProjectScopes,
      dashboardRecentSources,
      backupPath,
      warnings: [...alpha.structuredContent.warnings, ...scopedSearch.structuredContent.warnings],
    };
  } finally {
    store.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function fetchDashboardSnapshot(
  store: MemoryStore,
  embeddingProvider: EmbeddingProvider,
  workspaceActivity: WorkspaceActivity,
) {
  const server = createDashboardServer(store, {
    embeddingProvider,
    workspaceActivity,
    now: new Date("2026-06-20T03:20:00Z"),
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected TCP server address.");
    }
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const page = await fetch(baseUrl);
    const html = await page.text();
    if (!html.includes("プロジェクトスコープ")) {
      throw new Error("Dashboard HTML did not include プロジェクトスコープ.");
    }

    const response = await fetch(`${baseUrl}/api/status`);
    return (await response.json()) as {
      ok: boolean;
      memoryStats: {
        byProjectScope: Array<{ projectScope: string }>;
      };
      recentMemories: Array<{ sourceType: string; sourceRef: string }>;
      directives: Array<{ id: number; content: string }>;
      memoryFreshness: { status: string };
      memoryUpdateCandidates: Array<{ sourceRef: string; kind?: string }>;
      autoMemoryCuration: {
        mode: string;
        autoWrittenMemories?: Array<{ sourceRef: string }>;
      };
    };
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

async function main(): Promise<void> {
  const result = await runPracticalSmoke();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main();
}
