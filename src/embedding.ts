export interface EmbeddingProvider {
  embed(input: string): Promise<number[]>;
}

interface OllamaEmbeddingProviderOptions {
  baseUrl: string;
  model: string;
  fetch?: typeof globalThis.fetch;
}

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(options: OllamaEmbeddingProviderOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.model = options.model;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }

  async embed(input: string): Promise<number[]> {
    const response = await this.fetchImpl(`${this.baseUrl}/api/embed`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        input
      })
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Ollama embedding request failed (${response.status}): ${body}`);
    }

    const json = (await response.json()) as unknown;
    const embedding = readEmbedding(json);
    if (!embedding) {
      throw new Error("Ollama embedding response did not include an embedding vector.");
    }

    return embedding;
  }
}

export function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length !== right.length) {
    throw new Error(`Embedding dimension mismatch: ${left.length} != ${right.length}`);
  }

  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dot += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }

  if (leftMagnitude === 0 || rightMagnitude === 0) {
    return 0;
  }

  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

function readEmbedding(json: unknown): number[] | null {
  if (!isRecord(json)) {
    return null;
  }

  if (isNumberArray(json.embedding)) {
    return json.embedding;
  }

  if (Array.isArray(json.embeddings) && isNumberArray(json.embeddings[0])) {
    return json.embeddings[0];
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => typeof item === "number" && Number.isFinite(item));
}
