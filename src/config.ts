import path from "node:path";
import { existsSync, readFileSync } from "node:fs";

export interface MemorySidecarConfig {
  ollamaBaseUrl: string;
  embeddingModel: string;
  maintenanceModel: string;
  databasePath: string;
  defaultSearchLimit: number;
  consolidationDryRun: boolean;
}

interface LoadConfigOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  configPath?: string;
}

const DEFAULTS = {
  ollamaBaseUrl: "http://localhost:11434",
  embeddingModel: "embeddinggemma",
  maintenanceModel: "qwen3",
  databasePath: "data/memory.sqlite",
  defaultSearchLimit: 8,
  consolidationDryRun: true
};

export function loadConfig(options: LoadConfigOptions = {}): MemorySidecarConfig {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const configPath = options.configPath ?? path.join(cwd, "config", "memory-sidecar.toml");
  const fileConfig = existsSync(configPath) ? parseConfigToml(readFileSync(configPath, "utf8")) : {};

  const databasePath =
    env.CODEX_MEMORY_DB ?? stringValue(fileConfig.database_path) ?? DEFAULTS.databasePath;

  return {
    ollamaBaseUrl: env.OLLAMA_BASE_URL ?? stringValue(fileConfig.ollama_base_url) ?? DEFAULTS.ollamaBaseUrl,
    embeddingModel:
      env.CODEX_MEMORY_EMBEDDING_MODEL ?? stringValue(fileConfig.embedding_model) ?? DEFAULTS.embeddingModel,
    maintenanceModel:
      env.CODEX_MEMORY_MAINTENANCE_MODEL ??
      stringValue(fileConfig.maintenance_model) ??
      DEFAULTS.maintenanceModel,
    databasePath: path.isAbsolute(databasePath) ? databasePath : path.join(cwd, databasePath),
    defaultSearchLimit:
      numberValue(env.CODEX_MEMORY_DEFAULT_SEARCH_LIMIT) ??
      numberValue(fileConfig.default_search_limit) ??
      DEFAULTS.defaultSearchLimit,
    consolidationDryRun:
      booleanValue(env.CODEX_MEMORY_CONSOLIDATION_DRY_RUN) ??
      booleanValue(fileConfig.consolidation_dry_run) ??
      DEFAULTS.consolidationDryRun
  };
}

function parseConfigToml(content: string): Record<string, string | number | boolean> {
  const entries: Record<string, string | number | boolean> = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, "").trim();
    if (!line) {
      continue;
    }

    const match = /^([A-Za-z0-9_]+)\s*=\s*(.+)$/.exec(line);
    if (!match) {
      throw new Error(`Unsupported config line: ${rawLine}`);
    }

    entries[match[1] ?? ""] = parseTomlValue(match[2]?.trim() ?? "");
  }

  return entries;
}

function parseTomlValue(value: string): string | number | boolean {
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return Number(value);
  }
  const quoted = /^"([^"]*)"$/.exec(value);
  if (quoted) {
    return quoted[1] ?? "";
  }
  throw new Error(`Unsupported config value: ${value}`);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    if (value.toLowerCase() === "true") {
      return true;
    }
    if (value.toLowerCase() === "false") {
      return false;
    }
  }
  return undefined;
}
