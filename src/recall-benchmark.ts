#!/usr/bin/env node
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { EmbeddingProvider } from "./embedding.js";
import { createToolHandlers } from "./mcp-tools.js";
import { MemoryStore } from "./memory-store.js";
import { analyzeSourceRef } from "./source-ref.js";

type SearchMode = "keyword" | "semantic";

interface BenchmarkMemoryFixture {
  key: string;
  content: string;
  tags: string[];
  sourceRef: string;
  importance: number;
}

interface BenchmarkQueryFixture {
  query: string;
  expectedKeys: string[];
}

interface SearchModeResult {
  mode: SearchMode;
  recallAt3: number;
  precisionAt3: number;
  sourceRefQuality: number;
  duplicateSuppression: boolean;
  warnings: string[];
  cases: Array<{
    query: string;
    expectedKeys: string[];
    hitKeys: string[];
    recallAt3: number;
    precisionAt3: number;
  }>;
}

export interface RecallBenchmarkResult {
  ok: boolean;
  databasePath: string;
  thresholds: {
    minRecallAt3: number;
    minPrecisionAt3: number;
    minSourceRefQuality: number;
  };
  modes: SearchModeResult[];
}

const PROJECT_PATH_SEGMENT = "project-alpha";
const MIN_RECALL_AT_3 = 0.85;
const MIN_PRECISION_AT_3 = 0.4;
const MIN_SOURCE_REF_QUALITY = 1;

const memoryFixtures: BenchmarkMemoryFixture[] = [
  {
    key: "directive-dashboard",
    content:
      "Directive memory changes must be visible on the Dashboard after MCP server restart. If UI updates look stale, check for stale dashboard processes before changing code.",
    tags: ["directive", "dashboard", "stale-process"],
    sourceRef: "issue:#87 / pr:#90",
    importance: 0.85,
  },
  {
    key: "auto-curation",
    content:
      "Auto memory curation has off, review, and safe modes. Safe mode only auto-writes high-confidence non-duplicate candidates with strong sourceRef and secret detection pass.",
    tags: ["auto-curation", "memory-freshness"],
    sourceRef: "pr:#82",
    importance: 0.8,
  },
  {
    key: "backup-repair",
    content:
      "Before risky repair, create a memory backup and verify it. repair_memory_index should rebuild FTS after backup verification succeeds.",
    tags: ["backup", "repair", "fts"],
    sourceRef: "docs/daily-operations.md",
    importance: 0.75,
  },
  {
    key: "source-ref",
    content:
      "Use auditable sourceRef values such as pr:#123, issue:#123, git hashes, session ids, docs paths, or named evaluation ids when saving memory.",
    tags: ["source-ref", "provenance"],
    sourceRef: "git:0347ffd0f3cc7ffb47befa231d2071110d713758",
    importance: 0.78,
  },
  {
    key: "ollama-optional",
    content:
      "Ollama is optional. Without Ollama, SQLite FTS trigram and short-term LIKE fallback still support write, search, digest, and start session flows.",
    tags: ["ollama", "fts", "fallback"],
    sourceRef: "README.md",
    importance: 0.7,
  },
];

const queryFixtures: BenchmarkQueryFixture[] = [
  {
    query: "Dashboard directive stale process",
    expectedKeys: ["directive-dashboard"],
  },
  {
    query: "safe auto memory write sourceRef duplicate secret",
    expectedKeys: ["auto-curation", "source-ref"],
  },
  {
    query: "backup verify repair FTS index",
    expectedKeys: ["backup-repair"],
  },
  {
    query: "Ollamaなし SQLite FTS fallback search",
    expectedKeys: ["ollama-optional"],
  },
];

class BenchmarkEmbeddingProvider implements EmbeddingProvider {
  async embed(input: string): Promise<number[]> {
    const normalized = input.toLowerCase();
    return [
      scoreTerms(normalized, ["dashboard", "directive", "stale", "ui"]),
      scoreTerms(normalized, ["auto", "curation", "safe", "duplicate", "secret"]),
      scoreTerms(normalized, ["backup", "repair", "fts", "verify", "index"]),
      scoreTerms(normalized, ["sourceref", "source", "provenance", "pr", "issue", "git"]),
      scoreTerms(normalized, ["ollama", "sqlite", "fallback", "search"]),
    ];
  }
}

export async function runRecallBenchmark(): Promise<RecallBenchmarkResult> {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "codex-memory-sidecar-recall-"));
  const databasePath = path.join(tempDir, "memory.sqlite");

  try {
    const keyword = await runMode(
      "keyword",
      databasePath,
      path.join(tempDir, PROJECT_PATH_SEGMENT),
    );
    const semantic = await runMode(
      "semantic",
      databasePath,
      path.join(tempDir, `${PROJECT_PATH_SEGMENT}-semantic`),
    );
    const modes = [keyword, semantic];
    const ok = modes.every(
      (mode) =>
        mode.recallAt3 >= MIN_RECALL_AT_3 &&
        mode.precisionAt3 >= MIN_PRECISION_AT_3 &&
        mode.sourceRefQuality >= MIN_SOURCE_REF_QUALITY &&
        mode.duplicateSuppression,
    );

    return {
      ok,
      databasePath,
      thresholds: {
        minRecallAt3: MIN_RECALL_AT_3,
        minPrecisionAt3: MIN_PRECISION_AT_3,
        minSourceRefQuality: MIN_SOURCE_REF_QUALITY,
      },
      modes,
    };
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function runMode(
  mode: SearchMode,
  databasePath: string,
  projectPath: string,
): Promise<SearchModeResult> {
  const store = new MemoryStore(databasePath);
  const embeddingProvider = mode === "semantic" ? new BenchmarkEmbeddingProvider() : undefined;
  const tools = createToolHandlers(store, {
    embeddingProvider,
    embeddingRequired: false,
    autoMemoryWrite: "off",
  });
  const memoryIdsByKey = new Map<number, string>();

  try {
    for (const fixture of memoryFixtures) {
      const result = await tools.writeMemory({
        content: fixture.content,
        layer: "recall",
        tags: fixture.tags,
        sourceType: "benchmark",
        sourceRef: fixture.sourceRef,
        projectPath,
        importance: fixture.importance,
        confidence: 0.9,
      });
      memoryIdsByKey.set(result.structuredContent.memory.id, fixture.key);
    }

    const cases = [];
    const warnings: string[] = [];

    for (const fixture of queryFixtures) {
      const search = await tools.searchMemory({
        query: fixture.query,
        projectPath,
        limit: 3,
      });
      warnings.push(...search.structuredContent.warnings);
      const hitKeys = search.structuredContent.memories
        .map((memory) => memoryIdsByKey.get(memory.id))
        .filter((key): key is string => Boolean(key));
      const relevantHits = hitKeys.filter((key) => fixture.expectedKeys.includes(key)).length;

      cases.push({
        query: fixture.query,
        expectedKeys: fixture.expectedKeys,
        hitKeys,
        recallAt3: relevantHits / fixture.expectedKeys.length,
        precisionAt3: hitKeys.length ? relevantHits / hitKeys.length : 0,
      });
    }

    const duplicateProposal = await tools.proposeMemoryUpdate({
      content:
        "Safe auto memory curation writes only high confidence, non duplicate candidates with strong sourceRef and no detected secrets.",
      taskContext: "recall benchmark duplicate suppression",
      sourceType: "benchmark",
      sourceRef: "evaluation:recall-benchmark",
      projectPath,
    });

    return {
      mode,
      recallAt3: average(cases.map((item) => item.recallAt3)),
      precisionAt3: average(cases.map((item) => item.precisionAt3)),
      sourceRefQuality: sourceRefQuality(),
      duplicateSuppression:
        duplicateProposal.structuredContent.recommendation === "update" &&
        duplicateProposal.structuredContent.duplicateCandidates.length > 0,
      warnings,
      cases,
    };
  } finally {
    store.close();
  }
}

function sourceRefQuality(): number {
  const analyses = memoryFixtures.map((fixture) => analyzeSourceRef(fixture.sourceRef));
  return analyses.filter((analysis) => analysis.quality === "strong").length / analyses.length;
}

function average(values: number[]): number {
  if (!values.length) {
    return 0;
  }
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(4));
}

function scoreTerms(input: string, terms: string[]): number {
  const hits = terms.filter((term) => input.includes(term)).length;
  return hits / terms.length;
}

async function main(): Promise<void> {
  const result = await runRecallBenchmark();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main();
}
