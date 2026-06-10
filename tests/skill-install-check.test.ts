import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { compareSkillInstall, normalizeSkillText } from "../src/skill-install-check.js";

describe("skill install check", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), "codex-memory-sidecar-skill-check-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("normalizes BOM and line endings before comparing installed skill files", () => {
    expect(normalizeSkillText("\uFEFFline1\r\nline2\rline3\n")).toBe("line1\nline2\nline3\n");
  });

  test("compares repo and installed skill files using normalized text", () => {
    const repo = path.join(tempDir, "repo-skill");
    const installed = path.join(tempDir, "installed-skill");
    mkdirSync(path.join(repo, "agents"), { recursive: true });
    mkdirSync(path.join(installed, "agents"), { recursive: true });

    writeFileSync(path.join(repo, "SKILL.md"), "---\nname: codex-memory-sidecar\n---\nBody\n");
    writeFileSync(path.join(installed, "SKILL.md"), "\uFEFF---\r\nname: codex-memory-sidecar\r\n---\r\nBody\r\n");
    writeFileSync(path.join(repo, "agents", "openai.yaml"), "interface:\n  display_name: Codex Memory Sidecar\n");
    writeFileSync(
      path.join(installed, "agents", "openai.yaml"),
      "\uFEFFinterface:\r\n  display_name: Codex Memory Sidecar\r\n"
    );

    expect(compareSkillInstall(repo, installed)).toEqual({
      ok: true,
      files: [
        {
          file: "SKILL.md",
          exists: true,
          matches: true
        },
        {
          file: path.join("agents", "openai.yaml"),
          exists: true,
          matches: true
        }
      ]
    });
  });

  test("reports mismatch after normalization when installed content is stale", () => {
    const repo = path.join(tempDir, "repo-skill");
    const installed = path.join(tempDir, "installed-skill");
    mkdirSync(path.join(repo, "agents"), { recursive: true });
    mkdirSync(path.join(installed, "agents"), { recursive: true });

    writeFileSync(path.join(repo, "SKILL.md"), "new skill\n");
    writeFileSync(path.join(installed, "SKILL.md"), "old skill\n");
    writeFileSync(path.join(repo, "agents", "openai.yaml"), "new metadata\n");
    writeFileSync(path.join(installed, "agents", "openai.yaml"), "new metadata\n");

    const result = compareSkillInstall(repo, installed);

    expect(result.ok).toBe(false);
    expect(result.files).toContainEqual({
      file: "SKILL.md",
      exists: true,
      matches: false
    });
  });
});
