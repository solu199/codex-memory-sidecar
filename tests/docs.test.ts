import { readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

describe("documentation", () => {
  test("README is written for public Japanese portfolio usage", () => {
    const readme = readFileSync("README.md", "utf8");

    expect(readme).toContain("MCP対応AIエージェント向け");
    expect(readme).toContain("Ollamaなしでも利用できます");
    expect(readme).toContain("Ollamaを使うと");
    expect(readme).toContain("Codex app は利用例のひとつ");
    expect(readme).not.toContain("C:\\Users\\hare1");
    expect(readme).not.toContain("個人利用を前提");
    expect(readme).not.toContain("private package");
  });

  test("README and AGENTS memory protocol include custom instruction bootstrap guidance", () => {
    const readme = readFileSync("README.md", "utf8");
    const protocol = readFileSync("AGENTS-memory-protocol.md", "utf8");

    for (const document of [readme, protocol]) {
      expect(document).toContain("Codex app カスタム指示用ブートストラップ");
      expect(document).toContain("chat starts");
      expect(document).toContain("identity, persona, memory, preferences");
      expect(document).toContain("start_memory_session");
    }
  });

  test("Codex Skill template documents detailed memory operations", () => {
    const readme = readFileSync("README.md", "utf8");
    const skill = readFileSync("skills/codex-memory-sidecar/SKILL.md", "utf8");

    expect(readme).toContain("skills/codex-memory-sidecar/SKILL.md");
    expect(readme).toContain("Codex app のカスタム指示は短く保ち");
    expect(skill).toContain("name: codex-memory-sidecar");
    expect(skill).toContain("start_memory_session");
    expect(skill).toContain("propose_memory_update");
    expect(skill).toContain("propose_directive_update");
    expect(skill).toContain("backup_memory");
    expect(skill).toContain("When a new chat starts");
  });

  test("public safety and contribution documents are present", () => {
    const readme = readFileSync("README.md", "utf8");
    const security = readFileSync("SECURITY.md", "utf8");
    const contributing = readFileSync("CONTRIBUTING.md", "utf8");
    const license = readFileSync("LICENSE", "utf8");

    expect(readme).toContain("SECURITY.md");
    expect(readme).toContain("CONTRIBUTING.md");
    expect(readme).toContain("LICENSE");
    expect(security).toContain("実運用DB");
    expect(security).toContain("秘密情報");
    expect(contributing).toContain("Issue起点");
    expect(contributing).toContain("日本語を基本");
    expect(license).toContain("MIT License");
  });
});
