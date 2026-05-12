import { describe, expect, test, vi } from "vitest";

import { cosineSimilarity, OllamaEmbeddingProvider } from "../src/embedding.js";

describe("cosineSimilarity", () => {
  test("returns 1 for identical vectors and 0 for zero vectors", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1);
    expect(cosineSimilarity([0, 0], [1, 2])).toBe(0);
  });

  test("throws when vector dimensions do not match", () => {
    expect(() => cosineSimilarity([1], [1, 2])).toThrow(/dimension/i);
  });
});

describe("OllamaEmbeddingProvider", () => {
  test("reads embeddings from Ollama /api/embed responses", async () => {
    const fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ embeddings: [[0.1, 0.2, 0.3]] })
    })) as unknown as typeof globalThis.fetch;
    const provider = new OllamaEmbeddingProvider({
      baseUrl: "http://localhost:11434",
      model: "embeddinggemma",
      fetch
    });

    await expect(provider.embed("hello")).resolves.toEqual([0.1, 0.2, 0.3]);
  });

  test("supports legacy /api/embeddings response shape", async () => {
    const fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ embedding: [0.4, 0.5] })
    })) as unknown as typeof globalThis.fetch;
    const provider = new OllamaEmbeddingProvider({
      baseUrl: "http://localhost:11434",
      model: "all-minilm",
      fetch
    });

    await expect(provider.embed("hello")).resolves.toEqual([0.4, 0.5]);
  });

  test("throws a useful error when Ollama rejects the request", async () => {
    const fetch = vi.fn(async () => ({
      ok: false,
      status: 404,
      text: async () => "model not found"
    })) as unknown as typeof globalThis.fetch;
    const provider = new OllamaEmbeddingProvider({
      baseUrl: "http://localhost:11434",
      model: "missing",
      fetch
    });

    await expect(provider.embed("hello")).rejects.toThrow(/model not found/);
  });
});
