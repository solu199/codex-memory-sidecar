#!/usr/bin/env node
import path from "node:path";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { registerMemoryTools } from "./mcp-tools.js";
import { MemoryStore } from "./memory-store.js";

const databasePath = process.env.CODEX_MEMORY_DB ?? path.join(process.cwd(), "data", "memory.sqlite");
const store = new MemoryStore(databasePath);

const server = new McpServer({
  name: "codex-memory-sidecar",
  version: "0.1.0"
});

registerMemoryTools(server, store);

const transport = new StdioServerTransport();
await server.connect(transport);

process.on("SIGINT", async () => {
  store.close();
  await server.close();
  process.exit(0);
});
