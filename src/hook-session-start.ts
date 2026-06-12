import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { loadConfig } from "./config.js";
import { MemoryStore } from "./memory-store.js";
import type { DatabaseHealth, Directive, Memory, MemoryStats } from "./types.js";

export interface SessionStartHookInput {
  source?: string;
}

export interface SessionStartHookOutput {
  continue: true;
  hookSpecificOutput: {
    hookEventName: "SessionStart";
    additionalContext: string;
  };
}

export interface RunSessionStartHookOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  stdin?: string;
  maxChars?: number;
}

interface SessionStartContext {
  source: string;
  databasePath: string;
  health: DatabaseHealth;
  stats: MemoryStats;
  directives: Directive[];
  memories: Memory[];
}

const DEFAULT_MAX_CHARS = 2000;

export async function runSessionStartHook(
  options: RunSessionStartHookOptions = {},
): Promise<SessionStartHookOutput | null> {
  try {
    const cwd = options.cwd ?? process.cwd();
    const input = parseHookInput(options.stdin ?? (await readStdin()));
    const config = loadConfig({ cwd, env: options.env });

    if (!existsSync(config.databasePath)) {
      return null;
    }

    const store = new MemoryStore(config.databasePath);
    try {
      const context: SessionStartContext = {
        source: input.source ?? "unknown",
        databasePath: config.databasePath,
        health: store.checkDatabaseHealth({
          integrityCheck: true,
          ftsSanityCheck: true,
          walCheckpoint: false,
        }),
        stats: store.getStats(),
        directives: store.listDirectives({ projectPath: cwd, limit: 6 }),
        memories: store.listMemories({ projectPath: cwd, limit: 5 }),
      };
      const additionalContext = buildSessionStartAdditionalContext(
        context,
        options.maxChars ?? DEFAULT_MAX_CHARS,
      );

      if (!additionalContext.trim()) {
        return null;
      }

      return {
        continue: true,
        hookSpecificOutput: {
          hookEventName: "SessionStart",
          additionalContext,
        },
      };
    } finally {
      store.close();
    }
  } catch {
    return null;
  }
}

export function buildSessionStartAdditionalContext(
  context: SessionStartContext,
  maxChars = DEFAULT_MAX_CHARS,
): string {
  const lines = [
    "Codex Memory Sidecar SessionStart context:",
    `- source: ${context.source}`,
    `- database: ${context.health.ok ? "OK" : "WARN"} (${context.databasePath})`,
    `- memories: ${context.stats.byStatus.active} active / ${context.stats.memoryCount} total`,
    `- directives: ${context.directives.length}`,
    "- priority: system/developer > latest user > AGENTS.md > directive memory > normal memory > inference",
    "- use as supporting context; verify against current user instructions, files, docs, and git history.",
    "",
    ...formatDirectives(context.directives),
    ...formatMemories(context.memories),
    ...formatWarnings(context.health.warnings),
  ];

  return truncateContext(lines.join("\n").trim(), maxChars);
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    return "";
  }

  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => {
      resolve(data);
    });
    process.stdin.on("error", reject);
  });
}

function parseHookInput(raw: string): SessionStartHookInput {
  if (!raw.trim()) {
    return {};
  }

  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object") {
    return {};
  }

  const source =
    "source" in parsed && typeof parsed.source === "string" ? parsed.source : undefined;
  return { source };
}

function formatDirectives(directives: Directive[]): string[] {
  if (!directives.length) {
    return ["Directive memory:", "- none"];
  }

  return [
    "Directive memory:",
    ...directives.map(
      (directive) =>
        `- #${directive.id} [${directive.scope}] priority ${directive.priority}: ${singleLine(
          directive.content,
        )} (sourceRef: ${directive.sourceRef})`,
    ),
  ];
}

function formatMemories(memories: Memory[]): string[] {
  if (!memories.length) {
    return ["Recent memories:", "- none"];
  }

  return [
    "Recent memories:",
    ...memories.map(
      (memory) =>
        `- #${memory.id} [${memory.layer}] ${singleLine(memory.summary)} (sourceRef: ${
          memory.sourceRef
        })`,
    ),
  ];
}

function formatWarnings(warnings: string[]): string[] {
  if (!warnings.length) {
    return [];
  }

  return ["Warnings:", ...warnings.map((warning) => `- ${singleLine(warning)}`)];
}

function singleLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncateContext(context: string, maxChars: number): string {
  if (context.length <= maxChars) {
    return context;
  }

  const suffix = "\n- truncated to keep SessionStart context compact.";
  return `${context.slice(0, Math.max(0, maxChars - suffix.length)).trimEnd()}${suffix}`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const output = await runSessionStartHook();
  if (output) {
    process.stdout.write(`${JSON.stringify(output)}\n`);
  }
}
