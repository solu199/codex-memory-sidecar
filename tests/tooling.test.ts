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
    expect(ci).toContain("npm run smoke:hook");
    expect(ci).toContain("npm run bench:recall");
    expect(ci.indexOf("npm run format:check")).toBeLessThan(ci.indexOf("npm run build"));
    expect(ci.indexOf("npm run lint")).toBeLessThan(ci.indexOf("npm run build"));
    expect(ci.indexOf("npm run smoke:practical")).toBeLessThan(ci.indexOf("npm run smoke:hook"));
    expect(ci.indexOf("npm run smoke:hook")).toBeLessThan(ci.indexOf("npm run bench:recall"));
  });
});
