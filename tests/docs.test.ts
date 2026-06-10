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
});
