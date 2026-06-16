import { existsSync, readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

describe("documentation", () => {
  test("README is written for public Japanese portfolio usage", () => {
    const readme = readFileSync("README.md", "utf8");

    expect(readme).toContain("MCP対応AIエージェント向け");
    expect(readme).toContain("Ollamaなしでも利用できます");
    expect(readme).toContain("SQLite FTS trigram");
    expect(readme).toContain("porter と RRF");
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
    expect(readme).toContain("Codex app 環境での利用を主に検証");
    expect(readme).toContain(
      "現時点で実運用として継続的にテストしている対象は Codex app / Codex 環境",
    );
    expect(readme).toContain("他の MCP 対応クライアントでも同じ考え方で使える可能性");
    expect(readme).toContain("Codex app 以外の MCP クライアントでは");
    expect(readme).toContain("docs/assets/dashboard-overview.png");
    expect(readme).toContain("3分セットアップ");
    expect(readme).toContain("docs/daily-operations.md");
    expect(readme).toContain("docs/session-start-hook.md");
    expect(readme).toContain("docs/bi-temporal-invalidation-design.md");
    expect(readme).toContain("docs/memory-observatory.md");
    expect(readme).toContain("CHANGELOG.md");
    expect(readme).not.toContain("C:\\Users\\hare1");
    expect(readme).not.toContain("個人利用を前提");
    expect(readme).not.toContain("private package");
  });

  test("public release readiness materials are present", () => {
    const readme = readFileSync("README.md", "utf8");
    const changelog = readFileSync("CHANGELOG.md", "utf8");
    const releaseDraft = readFileSync(".github/releases/v0.1.0.md", "utf8");
    const metadata = readFileSync("docs/github-repository-metadata.md", "utf8");
    const roadmap = readFileSync("docs/technical-roadmap.md", "utf8");

    expect(existsSync("docs/assets/dashboard-overview.png")).toBe(true);
    expect(readme).toContain("Codex Memory Sidecar Dashboard");
    expect(readme).toContain("Memory Observatory");
    expect(existsSync("docs/memory-observatory.md")).toBe(true);
    expect(changelog).toContain("## [0.1.0] - 2026-06-12");
    expect(changelog).toContain("初回公開準備版");
    expect(releaseDraft).toContain("# v0.1.0 - 初回公開準備版");
    expect(releaseDraft).toContain("#91");
    expect(releaseDraft).toContain("#92");
    expect(releaseDraft).toContain("#93");
    expect(metadata).toContain("AIエージェント向けのローカルMCPメモリ基盤");
    expect(metadata).toContain("gh repo edit");
    expect(metadata).toContain("ユーザー承認後");
    expect(readme).toContain("docs/technical-roadmap.md");
    expect(readme).toContain("docs/memory-evaluation.md");
    expect(roadmap).toContain("SessionStart hook");
    expect(roadmap).toContain("porter + trigram");
    expect(roadmap).toContain("node:sqlite");
    expect(roadmap).toContain("bi-temporal");
    expect(roadmap).toContain("docs/bi-temporal-invalidation-design.md");
    expect(roadmap).toContain("#95");
    expect(roadmap).toContain("#100");
  });

  test("node:sqlite migration investigation is documented", () => {
    const investigation = readFileSync("docs/node-sqlite-migration.md", "utf8");

    expect(investigation).toContain("Issue: #98");
    expect(investigation).toContain("すぐ置き換えない");
    expect(investigation).toContain("Active development");
    expect(investigation).toContain("Node.js 22.16.0");
    expect(investigation).toContain("FTS5 trigram");
    expect(investigation).toContain("WAL checkpoint");
    expect(investigation).toContain("backup(db, backupPath)");
    expect(investigation).toContain("SqliteDatabaseAdapter");
  });

  test("memory evaluation benchmark is documented", () => {
    const readme = readFileSync("README.md", "utf8");
    const evaluation = readFileSync("docs/memory-evaluation.md", "utf8");

    expect(readme).toContain("npm run bench:recall");
    expect(evaluation).toContain("Issue: #100");
    expect(evaluation).toContain("recallAt3");
    expect(evaluation).toContain("precisionAt3");
    expect(evaluation).toContain("sourceRefQuality");
    expect(evaluation).toContain("duplicateSuppression");
    expect(evaluation).toContain("Ollamaなし相当");
    expect(evaluation).toContain("SQLite FTS trigram / porter");
    expect(evaluation).toContain("CI");
  });

  test("SessionStart hook adapter is documented", () => {
    const readme = readFileSync("README.md", "utf8");
    const hook = readFileSync("docs/session-start-hook.md", "utf8");

    expect(readme).toContain("npm run smoke:hook");
    expect(readme).toContain("docs/session-start-hook.md");
    expect(hook).toContain("Issue: #97");
    expect(hook).toContain("SessionStart");
    expect(hook).toContain("additionalContext");
    expect(hook).toContain("auto-write を発火させません");
    expect(hook).toContain("exit 0");
    expect(hook).toContain("hooks.json");
  });

  test("bi-temporal invalidation design is documented", () => {
    const design = readFileSync("docs/bi-temporal-invalidation-design.md", "utf8");

    expect(design).toContain("Issue: #99");
    expect(design).toContain("valid_from");
    expect(design).toContain("invalidated_at");
    expect(design).toContain("invalidated_by_ref");
    expect(design).toContain("superseded");
    expect(design).toContain("forgotten");
    expect(design).toContain("migration");
    expect(design).toContain("backup compatibility");
    expect(design).toContain("Dashboard");
    expect(design).toContain("PR 分割");
    expect(design).toContain("Graphiti");
    expect(design).toContain("Temporal Knowledge Graph");
  });

  test("Memory Observatory is documented as a privacy-safe Dashboard graph", () => {
    const readme = readFileSync("README.md", "utf8");
    const observatory = readFileSync("docs/memory-observatory.md", "utf8");

    expect(readme).toContain("/api/graph");
    expect(readme).toContain("本文と audit payload は返さず");
    expect(observatory).toContain("Memory Observatory");
    expect(observatory).toContain("/api/graph");
    expect(observatory).toContain("contentIncluded: false");
    expect(observatory).toContain("eventPayloadIncluded: false");
    expect(observatory).toContain("Dashboard の再読み込みだけで検索履歴が増えたり");
    expect(observatory).toContain("通常メモリ本文を表示しません");
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
    const exampleConfig = readFileSync("config/memory-sidecar.example.toml", "utf8");

    expect(readme).toContain('"tool": "start_memory_session"');
    expect(readme).toContain('"tool": "write_memory"');
    expect(readme).toContain('"tool": "propose_memory_update"');
    expect(readme).toContain('"tool": "search_memory"');
    expect(readme).toContain('"tool": "propose_directive_update"');
    expect(readme).toContain("Dashboard では Ollama が無効または任意扱いとして表示されます");
    expect(readme).toContain("Ollama を必須扱いにします");
    expect(exampleConfig).toContain('embedding_mode = "auto"');
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
    expect(audit).toContain("npm audit");
    expect(audit).toContain("npm audit --omit=dev");
    expect(audit).toContain("0 vulnerabilities");
    expect(audit).toContain("docs/friend-explanation.html");
    expect(audit).toContain("#69 CIのNode.js 20 deprecation annotation対応");
  });
});
