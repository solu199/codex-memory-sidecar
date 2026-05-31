import { readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

describe("documentation", () => {
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
