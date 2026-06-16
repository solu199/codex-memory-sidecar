import { createHash } from "node:crypto";
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
    const prettier = JSON.parse(readFileSync(".prettierrc.json", "utf8")) as {
      endOfLine?: string;
    };

    expect(existsSync("eslint.config.js")).toBe(true);
    expect(existsSync(".prettierrc.json")).toBe(true);
    expect(existsSync(".prettierignore")).toBe(true);
    expect(prettier.endOfLine).toBe("auto");
  });

  test("CI runs format and lint checks before build and tests", () => {
    const ci = readFileSync(".github/workflows/ci.yml", "utf8");

    expect(ci).toContain("npm run format:check");
    expect(ci).toContain("npm run lint");
    expect(ci).toContain("npm run check:observatory-bundle");
    expect(ci).toContain("npm run smoke:hook");
    expect(ci).toContain("npm run bench:recall");
    expect(ci.indexOf("npm run format:check")).toBeLessThan(ci.indexOf("npm run build"));
    expect(ci.indexOf("npm run lint")).toBeLessThan(ci.indexOf("npm run build"));
    expect(ci.indexOf("npm run check:observatory-bundle")).toBeLessThan(
      ci.indexOf("npm run build"),
    );
    expect(ci.indexOf("npm run smoke:practical")).toBeLessThan(ci.indexOf("npm run smoke:hook"));
    expect(ci.indexOf("npm run smoke:hook")).toBeLessThan(ci.indexOf("npm run bench:recall"));
  });

  test("Memory Observatory bundle provenance is reproducible and documented", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    const notice = readFileSync("vendor/observatory-3d.bundle.NOTICE.md", "utf8");
    const gitAttributes = readFileSync(".gitattributes", "utf8");
    const checksum = readFileSync("vendor/observatory-3d.bundle.sha256", "utf8").trim();
    const bundle = readFileSync("vendor/observatory-3d.bundle.js");
    const bundleSource = bundle.toString("utf8");
    const digest = createHash("sha256").update(bundle).digest("hex");

    expect(pkg.scripts["build:observatory-bundle"]).toBe(
      "node scripts/build-observatory-bundle.mjs",
    );
    expect(pkg.scripts["check:observatory-bundle"]).toBe(
      "node scripts/check-observatory-bundle.mjs",
    );
    expect(pkg.devDependencies.esbuild).toBeDefined();
    expect(pkg.devDependencies["3d-force-graph"]).toBeDefined();
    expect(pkg.devDependencies.three).toBeDefined();
    expect(existsSync("scripts/build-observatory-bundle.mjs")).toBe(true);
    expect(existsSync("scripts/check-observatory-bundle.mjs")).toBe(true);
    expect(existsSync("scripts/observatory-3d-entry.mjs")).toBe(true);
    expect(gitAttributes).toContain("vendor/observatory-3d.bundle.js text eol=lf");
    expect(gitAttributes).toContain("vendor/observatory-3d.bundle.sha256 text eol=lf");
    expect(checksum).toBe(`${digest}  observatory-3d.bundle.js`);
    expect(bundleSource).not.toMatch(/[ \t]+$/m);
    expect(notice).toContain("3d-force-graph");
    expect(notice).toContain("three");
    expect(notice).toContain("MIT");
    expect(notice).toContain("npm run build:observatory-bundle");
    expect(notice).toContain("npm run check:observatory-bundle");
    expect(notice).toContain("observatory-3d.bundle.sha256");
    expect(notice).toContain("Issue #109");
  });

  test("Dashboard React/Vite app build is wired into the package build", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts: Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies: Record<string, string>;
    };

    expect(pkg.scripts["build:dashboard-app"]).toBe("vite build --config vite.dashboard.config.ts");
    expect(pkg.scripts.build).toBe("tsc -p tsconfig.json && npm run build:dashboard-app");
    expect(pkg.scripts.dashboard).toBe("npm run build && node dist/src/dashboard.js");
    expect(pkg.dependencies?.react ?? pkg.devDependencies.react).toBeDefined();
    expect(pkg.dependencies?.["react-dom"] ?? pkg.devDependencies["react-dom"]).toBeDefined();
    expect(pkg.devDependencies.vite).toBeDefined();
    expect(existsSync("vite.dashboard.config.ts")).toBe(true);
    expect(existsSync("src/dashboard-app/index.html")).toBe(true);
    expect(existsSync("src/dashboard-app/src/main.tsx")).toBe(true);
  });
});
