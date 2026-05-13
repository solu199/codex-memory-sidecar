#!/usr/bin/env node
import os from "node:os";
import path from "node:path";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { EmbeddingProvider } from "./embedding.js";
import { OllamaEmbeddingProvider } from "./embedding.js";
import { createToolHandlers } from "./mcp-tools.js";
import { MemoryStore } from "./memory-store.js";

export interface OllamaSmokeOptions {
  databasePath: string;
  embeddingProvider: EmbeddingProvider;
}

export interface OllamaSmokeResult {
  ok: boolean;
  embeddingDimensions: number;
  topMemorySummary: string;
  warnings: string[];
}

export async function runOllamaSmoke(options: OllamaSmokeOptions): Promise<OllamaSmokeResult> {
  const store = new MemoryStore(options.databasePath);
  try {
    const tools = createToolHandlers(store, { embeddingProvider: options.embeddingProvider });
    const created = await tools.writeMemory({
      content: "Ollama smoke test memory: local embeddings should be available.",
      layer: "recall",
      tags: ["smoke", "ollama"],
      sourceType: "smoke",
      sourceRef: "npm run smoke:ollama"
    });
    await tools.writeMemory({
      content: "Unrelated memory about manual backup verification.",
      layer: "recall",
      tags: ["smoke"],
      sourceType: "smoke",
      sourceRef: "npm run smoke:ollama"
    });

    const result = await tools.searchMemory({
      query: "Ollama smoke local embeddings",
      limit: 1
    });

    const warnings = [...created.structuredContent.warnings, ...result.structuredContent.warnings];
    const storedCreated = store.getMemory(created.structuredContent.memory.id);

    return {
      ok:
        warnings.length === 0 &&
        storedCreated?.embedding !== null &&
        result.structuredContent.memories[0]?.id === created.structuredContent.memory.id,
      embeddingDimensions: storedCreated?.embedding?.length ?? 0,
      topMemorySummary: result.structuredContent.memories[0]?.summary ?? "",
      warnings
    };
  } finally {
    store.close();
  }
}

async function main(): Promise<void> {
  const databasePath = path.join(os.tmpdir(), `codex-memory-sidecar-smoke-${Date.now()}.sqlite`);
  try {
    const result = await runOllamaSmoke({
      databasePath,
      embeddingProvider: new OllamaEmbeddingProvider({
        baseUrl: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434",
        model: process.env.CODEX_MEMORY_EMBEDDING_MODEL ?? "embeddinggemma"
      })
    });

    if (!result.ok) {
      console.error(JSON.stringify(result, null, 2));
      process.exitCode = 1;
      return;
    }

    console.log(JSON.stringify(result, null, 2));
  } finally {
    rmSync(databasePath, { force: true });
    rmSync(`${databasePath}-shm`, { force: true });
    rmSync(`${databasePath}-wal`, { force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main();
}
