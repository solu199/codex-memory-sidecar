import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { MemorySidecarConfig } from "./config.js";
import { OllamaEmbeddingProvider } from "./embedding.js";
import { registerMemoryTools } from "./mcp-tools.js";
import { MemoryStore } from "./memory-store.js";

export interface MemoryServerRuntime {
  server: McpServer;
  store: MemoryStore;
}

export function createMemoryServer(config: MemorySidecarConfig): MemoryServerRuntime {
  const store = new MemoryStore(config.databasePath);
  const server = new McpServer({
    name: "codex-memory-sidecar",
    version: "0.1.0"
  });
  const embeddingProvider =
    config.embeddingMode === "off"
      ? undefined
      : new OllamaEmbeddingProvider({
          baseUrl: config.ollamaBaseUrl,
          model: config.embeddingModel
        });

  registerMemoryTools(server, store, {
    embeddingProvider,
    embeddingRequired: config.embeddingMode === "ollama",
    autoMemoryWrite: config.memoryAutoWrite
  });

  return { server, store };
}
