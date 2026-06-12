import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { runSessionStartHook } from "./hook-session-start.js";
import { MemoryStore } from "./memory-store.js";

interface HookSmokeResult {
  ok: true;
  additionalContextLength: number;
  memoryCount: number;
  eventCount: number;
  warnings: string[];
}

export async function runHookSessionStartSmoke(): Promise<HookSmokeResult> {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "codex-memory-sidecar-hook-"));
  const databasePath = path.join(tempDir, "memory.sqlite");
  const projectPath = path.join(tempDir, "project");

  const store = new MemoryStore(databasePath);
  try {
    store.createDirective({
      content: "READMEは日本語で書き、公開前に実ファイルとgit履歴で裏取りする。",
      scope: "project",
      projectPath,
      rationale: "SessionStart hook smoke needs directive memory context.",
      tags: ["smoke", "hook"],
      sourceType: "test",
      sourceRef: "smoke:hook",
    });
    store.createMemory({
      content:
        "SessionStart hook adapterはauto-writeを発火させず、短い追加コンテキストだけを返す。",
      layer: "recall",
      projectPath,
      tags: ["hook", "session-start"],
      sourceType: "test",
      sourceRef: "smoke:hook",
      importance: 0.7,
      confidence: 0.9,
      summary: "SessionStart hook adapterは読み取り専用の短い追加コンテキストを返す。",
    });
  } finally {
    store.close();
  }

  const output = await runSessionStartHook({
    cwd: projectPath,
    env: { CODEX_MEMORY_DB: databasePath },
    stdin: JSON.stringify({ source: "startup" }),
    maxChars: 2000,
  });

  if (!output) {
    throw new Error("SessionStart hook smoke did not return hook output.");
  }

  const additionalContext = output.hookSpecificOutput.additionalContext;
  if (output.hookSpecificOutput.hookEventName !== "SessionStart") {
    throw new Error("Unexpected hook event name.");
  }
  if (!additionalContext.includes("READMEは日本語")) {
    throw new Error("Directive memory was not included in hook context.");
  }
  if (!additionalContext.includes("読み取り専用")) {
    throw new Error("Recent memory was not included in hook context.");
  }
  if (additionalContext.length > 2000) {
    throw new Error("Hook context exceeded compact size limit.");
  }

  const verifyStore = new MemoryStore(databasePath);
  try {
    const counts = verifyStore.countRecords();
    const health = verifyStore.checkDatabaseHealth({ walCheckpoint: false });
    if (counts.memoryCount !== 1) {
      throw new Error("SessionStart hook unexpectedly changed memory count.");
    }

    return {
      ok: true,
      additionalContextLength: additionalContext.length,
      memoryCount: counts.memoryCount,
      eventCount: counts.eventCount,
      warnings: health.warnings,
    };
  } finally {
    verifyStore.close();
  }
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const result = await runHookSessionStartSmoke();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
