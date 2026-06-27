#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface SkillInstallCheckResult {
  ok: boolean;
  files: Array<{
    file: string;
    exists: boolean;
    matches: boolean;
  }>;
}

export function normalizeSkillText(input: string): string {
  return input.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
}

function listSkillFiles(skillDir: string, currentDir = skillDir): string[] {
  const entries = readdirSync(currentDir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name);
    const relativePath = path.relative(skillDir, fullPath);

    if (entry.isDirectory()) {
      files.push(...listSkillFiles(skillDir, fullPath));
      continue;
    }

    files.push(relativePath);
  }

  return files.sort((left, right) => left.localeCompare(right));
}

export function compareSkillInstall(
  repoSkillDir: string,
  installedSkillDir: string,
): SkillInstallCheckResult {
  const files = listSkillFiles(repoSkillDir).map((file) => {
    const sourcePath = path.join(repoSkillDir, file);
    const installedPath = path.join(installedSkillDir, file);
    const exists = existsSync(sourcePath) && existsSync(installedPath);
    const matches =
      exists &&
      normalizeSkillText(readFileSync(sourcePath, "utf8")) ===
        normalizeSkillText(readFileSync(installedPath, "utf8"));

    return {
      file,
      exists,
      matches,
    };
  });

  return {
    ok: files.every((file) => file.exists && file.matches),
    files,
  };
}

function defaultRepoSkillDir(): string {
  const currentFile = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(currentFile), "..", "..", "skills", "codex-memory-sidecar");
}

function defaultInstalledSkillDir(): string {
  return path.join(os.homedir(), ".agents", "skills", "codex-memory-sidecar");
}

function readOption(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return null;
  }
  return process.argv[index + 1] ?? null;
}

function main(): void {
  const repoSkillDir = readOption("--repo") ?? defaultRepoSkillDir();
  const installedSkillDir = readOption("--installed") ?? defaultInstalledSkillDir();
  const result = compareSkillInstall(repoSkillDir, installedSkillDir);

  console.log(
    JSON.stringify(
      {
        ...result,
        repoSkillDir,
        installedSkillDir,
      },
      null,
      2,
    ),
  );

  if (!result.ok) {
    process.exitCode = 1;
  }
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  main();
}
