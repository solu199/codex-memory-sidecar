export interface SourceRefAnalysis {
  quality: "weak" | "strong";
  recognizedRefs: string[];
  suggestions: string[];
}

const GENERIC_REFS = new Set(["test", "manual", "chat", "codex-chat", "note", "memory"]);

export function analyzeSourceRef(sourceRef: string): SourceRefAnalysis {
  const recognizedRefs: string[] = [];

  pushIf(recognizedRefs, "pr", /(?:^|[\s/])(?:pr|pull request)\s*(?::\s*)?#?\d+\b/i.test(sourceRef));
  pushIf(recognizedRefs, "issue", /(?:^|[\s/])issue\s*(?::\s*)?#?\d+\b/i.test(sourceRef));
  pushIf(recognizedRefs, "commit", /(?:^|\b)(?:git:)?[0-9a-f]{7,40}\b/i.test(sourceRef));
  pushIf(
    recognizedRefs,
    "doc_path",
    /(?:^|[\\/])(?:docs|src|tests|config)[\\/][^\s]+|[^\s]+\.(?:md|ts|tsx|js|json|toml)\b/i.test(sourceRef)
  );
  pushIf(recognizedRefs, "session", /(?:^|[\s/])session:[a-z0-9_.:-]+/i.test(sourceRef));
  pushIf(recognizedRefs, "named_run", /\b(?:chat|evaluation|smoke|test)[:-][a-z0-9_.-]+/i.test(sourceRef));

  const suggestions: string[] = [];
  if (!recognizedRefs.length || GENERIC_REFS.has(sourceRef.trim().toLowerCase())) {
    suggestions.push(
      "Use a sourceRef like pr:#123, issue:#123, git:<hash>, session:<id>, a doc path, or a named chat/evaluation id."
    );
  }

  return {
    quality: suggestions.length ? "weak" : "strong",
    recognizedRefs,
    suggestions
  };
}

function pushIf(items: string[], item: string, condition: boolean): void {
  if (condition && !items.includes(item)) {
    items.push(item);
  }
}
