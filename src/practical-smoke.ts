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
    const invalidated = await tools.writeMemory({
      content: "Temporary practical memory that should keep invalidation metadata.",
      layer: "recall",
      tags: ["practical", "invalidation"],
      sourceType: "smoke",
      sourceRef: "npm run smoke:practical",
      projectPath,
    });
    const invalidation = await tools.forgetMemory({
      memoryId: invalidated.structuredContent.memory.id,
      reason: "practical invalidation smoke",
      invalidatedByRef: "issue:#116",
    });
    const invalidationAudit = await tools.auditMemory({
      memoryId: invalidated.structuredContent.memory.id,
      limit: 1,
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
      invalidationMetadata:
        invalidation.structuredContent.memory.status === "forgotten" &&
        typeof invalidation.structuredContent.memory.invalidatedAt === "string" &&
        invalidation.structuredContent.memory.invalidatedByRef === "issue:#116" &&
        invalidation.structuredContent.memory.invalidationReason ===
          "practical invalidation smoke" &&
        invalidationAudit.structuredContent.events[0]?.payload?.invalidatedByRef === "issue:#116",
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
      dashboardShowsMemoryObservatory:
        dashboard.graph.nodes.length > 0 &&
        dashboard.html.includes('id="root"') &&
        dashboard.html.includes("/dashboard-assets/assets/") &&
        dashboard.html.includes('type="module"') &&
        dashboard.appScript.includes("Memory Observatory") &&
        dashboard.appScript.includes("observatory-3d.bundle.js") &&
        dashboard.appScript.includes("data-view-target") &&
        dashboard.appScript.includes("memory-content-reveal") &&
        dashboard.graph.nodes.every((node) => node.privacy === "summary-only") &&
        dashboard.graph.clusters.length > 0 &&
        dashboard.graph.events.every((event) => !("payload" in event)) &&
        dashboard.graph.privacy.contentIncluded === false &&
        dashboard.graph.privacy.eventPayloadIncluded === false &&
        !JSON.stringify(dashboard.graph).includes("payload"),
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
    if (
      !html.includes('id="root"') ||
      !html.includes("/dashboard-assets/assets/") ||
      !html.includes('type="module"')
    ) {
      throw new Error("Dashboard HTML did not include the React app shell.");
    }
    const scriptMatch = html.match(/src="(\/dashboard-assets\/assets\/[^"]+\.js)"/);
    if (!scriptMatch) {
      throw new Error("Dashboard HTML did not include the React app bundle.");
    }
    const appScript = await (await fetch(`${baseUrl}${scriptMatch[1]}`)).text();
    if (
      !appScript.includes("Memory Observatory") ||
      !appScript.includes("observatory-3d.bundle.js") ||
      !appScript.includes("memory-content-reveal")
    ) {
      throw new Error("Dashboard app bundle did not include expected app affordances.");
    }

    const response = await fetch(`${baseUrl}/api/status`);
    const graphResponse = await fetch(`${baseUrl}/api/graph`);
    const status = (await response.json()) as {
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
    const graph = (await graphResponse.json()) as {
      nodes: Array<{ id: number; summary: string; privacy: "summary-only" }>;
      clusters: Array<{ id: string; kind: string; label: string; nodeIds: number[] }>;
      events: Array<{ id: number; eventType: string; memoryIds: number[]; createdAt: string }>;
      edges: {
        similarity: Array<unknown>;
        hebbian: Array<unknown>;
      };
      privacy: {
        contentIncluded: false;
        eventPayloadIncluded: false;
      };
    };
    return { ...status, appScript, graph, html };
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
