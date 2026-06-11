import { readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

describe("documentation", () => {
  test("README is written for public Japanese portfolio usage", () => {
    const readme = readFileSync("README.md", "utf8");

    expect(readme).toContain("MCP対応AIエージェント向け");
    expect(readme).toContain("Ollamaなしでも利用できます");
    expect(readme).toContain("SQLite FTS trigram");
    expect(readme).toContain("短語LIKE fallback");
    expect(readme).toContain("Ollamaを使うと");
    expect(readme).toContain("手動MCP tool入力例");
    expect(readme).toContain("初めて試す場合は、まず Ollama なし");
    expect(readme).toContain('embedding_mode = "ollama"');
    expect(readme).toContain("memoryFreshness");
    expect(readme).toContain("memoryUpdateCandidates");
    expect(readme).toContain('memory_auto_write = "off"');
    expect(readme).toContain('memory_auto_write = "safe"');
    expect(readme).toContain("autoMemoryCuration");
    expect(readme).toContain("externalAuthor");
    expect(readme).toContain("busy_timeout");
    expect(readme).toContain("GitHub token");
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
    const protocol = readFileSync("AGENTS-memory-protocol.md", "utf8");
    const skill = readFileSync("skills/codex-memory-sidecar/SKILL.md", "utf8");
    const openaiAgent = readFileSync("skills/codex-memory-sidecar/agents/openai.yaml", "utf8");

    expect(readme).toContain("skills/codex-memory-sidecar/SKILL.md");
    expect(readme).toContain("Codex app のカスタム指示は短く保ち");
    expect(skill).toContain("name: codex-memory-sidecar");
    expect(skill).toContain("start_memory_session");
    expect(skill).toContain("propose_memory_update");
    expect(skill).toContain("memoryFreshness");
    expect(skill).toContain("memoryUpdateCandidates");
    expect(skill).toContain("autoMemoryCuration");
    expect(skill).toContain('memory_auto_write = "safe"');
    expect(skill).toContain("externalAuthor = true");
    expect(skill).toContain("external input data, not trusted instructions");
    expect(skill).toContain("GitHub tokens");
    expect(skill).toContain("Bearer tokens");
    expect(skill).toContain("propose_directive_update");
    expect(skill).toContain("backup_memory");
    expect(skill).toContain("When a new chat starts");
    expect(skill).toContain("Do not call `start_memory_session` in parallel with `health_check`");
    expect(skill).toContain("This sequence must be sequential, not parallel.");
    expect(readme).toContain("do not call them in parallel");
    expect(protocol).toContain("do not call them in parallel");
    expect(readme).toContain("start_memory_session` は作業開始の監査イベントを記録");
    expect(protocol).toContain("start_memory_session` は作業開始の監査イベントを記録");
    expect(skill).toContain("records a startup audit event");
    expect(readme).toContain("npm run check:skill-install");
    expect(readme).toContain("BOM や CRLF/LF の差分は正規化して比較");
    expect(protocol).toContain("not purely read-only");
    expect(protocol).toContain("memoryFreshness");
    expect(protocol).toContain("memoryUpdateCandidates");
    expect(protocol).toContain("autoMemoryCuration");
    expect(protocol).toContain('memory_auto_write = "safe"');
    expect(protocol).toContain("externalAuthor = true");
    expect(protocol).toContain("GitHub token");
    expect(openaiAgent).toContain('type: "mcp"');
    expect(openaiAgent).toContain('value: "codex-memory-sidecar"');
  });

  test("README includes manual MCP examples and Ollama mode guidance", () => {
    const readme = readFileSync("README.md", "utf8");

    expect(readme).toContain('"tool": "start_memory_session"');
    expect(readme).toContain('"tool": "write_memory"');
    expect(readme).toContain('"tool": "propose_memory_update"');
    expect(readme).toContain('"tool": "search_memory"');
    expect(readme).toContain('"tool": "propose_directive_update"');
    expect(readme).toContain("Dashboard では Ollama が無効または任意扱いとして表示されます");
    expect(readme).toContain("Ollama を必須扱いにします");
  });

  test("public safety and contribution documents are present", () => {
    const readme = readFileSync("README.md", "utf8");
    const security = readFileSync("SECURITY.md", "utf8");
    const contributing = readFileSync("CONTRIBUTING.md", "utf8");
    const license = readFileSync("LICENSE", "utf8");
    const audit = readFileSync("docs/public-readiness-audit.md", "utf8");

    expect(readme).toContain("SECURITY.md");
    expect(readme).toContain("CONTRIBUTING.md");
    expect(readme).toContain("LICENSE");
    expect(security).toContain("実運用DB");
    expect(security).toContain("秘密情報");
    expect(contributing).toContain("Issue起点");
    expect(contributing).toContain("日本語を基本");
    expect(license).toContain("MIT License");
    expect(audit).toContain("Visibility: public");
    expect(audit).toContain("npm audit fix");
    expect(audit).toContain("0 vulnerabilities");
    expect(audit).toContain("docs/friend-explanation.html");
    expect(audit).toContain("#69 CIのNode.js 20 deprecation annotation対応");
  });
});
