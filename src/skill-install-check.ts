#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
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

const checkedFiles = ["SKILL.md", path.join("agents", "openai.yaml")];

export function normalizeSkillText(input: string): string {
  return input.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
}

export function compareSkillInstall(
  repoSkillDir: string,
  installedSkillDir: string,
): SkillInstallCheckResult {
  const files = checkedFiles.map((file) => {
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
