# Lint Formatter And Roadmap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Codex Memory Sidecar に lint / formatter を導入し、追加資料で挙がった中期改善を安全にIssue化・ロードマップ化する。

**Architecture:** lint / formatter は TypeScript の既存構成に合わせ、ESLint と Prettier をnpm scriptsとして追加する。中期改善は今回のPRで大規模実装せず、公式Codex Hooks確認済みの設計メモと優先度付きロードマップ、GitHub Issueへ分離する。

**Tech Stack:** TypeScript, Vitest, ESLint, Prettier, GitHub Issues, Codex Hooks.

---

### Task 1: Tooling Contract Test

**Files:**

- Create: `tests/tooling.test.ts`
- Modify: `package.json`
- Create: `eslint.config.js`
- Create: `.prettierrc.json`
- Create: `.prettierignore`

- [ ] **Step 1: Write the failing tooling contract test**

```ts
import { existsSync, readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

describe("tooling configuration", () => {
  test("package exposes lint and format scripts", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(pkg.scripts.lint).toBe("eslint .");
    expect(pkg.scripts["format:check"]).toBe("prettier . --check");
    expect(pkg.scripts.format).toBe("prettier . --write");
  });

  test("ESLint and Prettier configuration files are present", () => {
    expect(existsSync("eslint.config.js")).toBe(true);
    expect(existsSync(".prettierrc.json")).toBe(true);
    expect(existsSync(".prettierignore")).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test -- tests/tooling.test.ts`
Expected: FAIL because `lint`, `format:check`, `format`, and config files do not exist yet.

- [ ] **Step 3: Add ESLint / Prettier dependencies and scripts**

Run: `npm install --save-dev eslint @eslint/js typescript-eslint prettier`

Update `package.json` scripts:

```json
{
  "lint": "eslint .",
  "format:check": "prettier . --check",
  "format": "prettier . --write"
}
```

- [ ] **Step 4: Add minimal config files**

`eslint.config.js` should lint TypeScript source, tests, and config files while ignoring generated/local directories.

`.prettierrc.json` should keep formatting conservative: 2 spaces, semicolons, double quotes, trailing commas.

`.prettierignore` should exclude generated/local directories such as `dist`, `node_modules`, `data`, and coverage.

- [ ] **Step 5: Run the test and verify it passes**

Run: `npm test -- tests/tooling.test.ts`
Expected: PASS.

---

### Task 2: Roadmap Documentation

**Files:**

- Create: `docs/technical-roadmap.md`
- Modify: `README.md`
- Test: `tests/docs.test.ts`

- [ ] **Step 1: Add a failing docs test**

Extend `tests/docs.test.ts` so it expects:

```ts
expect(readme).toContain("docs/technical-roadmap.md");
expect(roadmap).toContain("SessionStart hook");
expect(roadmap).toContain("porter + trigram");
expect(roadmap).toContain("node:sqlite");
expect(roadmap).toContain("bi-temporal");
```

- [ ] **Step 2: Run the docs test and verify it fails**

Run: `npm test -- tests/docs.test.ts`
Expected: FAIL because the roadmap file and README link do not exist yet.

- [ ] **Step 3: Create `docs/technical-roadmap.md`**

Include these sections:

- lint / formatter baseline
- search quality: porter + trigram + RRF
- Codex SessionStart hook adapter
- `node:sqlite` migration investigation
- bi-temporal memory invalidation
- recency scoring / progressive disclosure
- recall benchmark CI
- Codex plugin packaging

- [ ] **Step 4: Link roadmap from README**

Add `docs/technical-roadmap.md` to the "まず読む場所" section.

- [ ] **Step 5: Run docs test and verify it passes**

Run: `npm test -- tests/docs.test.ts`
Expected: PASS.

---

### Task 3: Verification

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Create/Modify docs and tests from previous tasks.

- [ ] **Step 1: Run formatting check**

Run: `npm run format:check`
Expected: PASS.

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 3: Run build and tests**

Run:

```powershell
npm run build
npm test
npm run smoke:mcp
npm run smoke:practical
```

Expected: all PASS.

---

### Task 4: GitHub Issue Split

**Files:**

- No code files required.

- [ ] **Step 1: Create one implementation Issue for lint / formatter**

Title: `lint/formatterを導入して品質ゲートを整備する`

- [ ] **Step 2: Create medium-term roadmap Issues**

Create focused Issues for:

- `porter + trigram + RRF` search
- read-only `SessionStart hook` adapter with `smoke:hook`
- `node:sqlite` migration investigation
- bi-temporal memory invalidation
- recall benchmark CI

- [ ] **Step 3: Reference the Issues from PR body**

Use `Closes` for the lint/formatter Issue and `Refs` for roadmap Issues.

---

### Task 5: Completion Gate

**Files:**

- Git state.

- [ ] **Step 1: Show final diff and verification results to the user**

Expected: concise summary of files changed, commands run, and Issue numbers.

- [ ] **Step 2: Ask before committing**

Expected: do not commit until the user explicitly approves.
