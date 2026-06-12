import { describe, expect, test } from "vitest";

import { analyzeSourceRef } from "../src/source-ref.js";

describe("analyzeSourceRef", () => {
  test("recognizes canonical sourceRef formats used by auto curation", () => {
    expect(analyzeSourceRef("pr:#82")).toMatchObject({
      quality: "strong",
      recognizedRefs: ["pr"],
      suggestions: [],
    });
    expect(analyzeSourceRef("issue:#83")).toMatchObject({
      quality: "strong",
      recognizedRefs: ["issue"],
      suggestions: [],
    });
    expect(analyzeSourceRef("git:e21243de47c497ee0bc0fcd02f83fa92037bea4a")).toMatchObject({
      quality: "strong",
      recognizedRefs: ["commit"],
      suggestions: [],
    });
    expect(analyzeSourceRef("session:2026-06-11T16:31:39.408Z")).toMatchObject({
      quality: "strong",
      recognizedRefs: ["session"],
      suggestions: [],
    });
  });

  test("keeps existing human-readable provenance formats traceable", () => {
    expect(
      analyzeSourceRef("PR #44 / commit ba91c1f / docs/memory-digest-protocol.md"),
    ).toMatchObject({
      quality: "strong",
      recognizedRefs: ["pr", "commit", "doc_path"],
      suggestions: [],
    });
  });

  test("suggests stronger references for generic values", () => {
    expect(analyzeSourceRef("test")).toMatchObject({
      quality: "weak",
      recognizedRefs: [],
      suggestions: [
        "Use a sourceRef like pr:#123, issue:#123, git:<hash>, session:<id>, a doc path, or a named chat/evaluation id.",
      ],
    });
  });
});
