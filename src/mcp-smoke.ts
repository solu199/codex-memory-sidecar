#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { loadConfig, type MemorySidecarConfig } from "./config.js";
import { createMemoryServer } from "./server.js";

export interface McpSmokeOptions {
  databasePath?: string;
}

export interface McpSmokeResult {
  ok: boolean;
  toolNames: string[];
  healthCheck: {
    ok: boolean;
    database: {
      ok: boolean;
      memoryCount: number;
      eventCount: number;
    };
    embedding: {
      ok: boolean;
      dimensions: number;
      error: string | null;
    };
    warnings: string[];
  };
}

export async function runMcpSmoke(options: McpSmokeOptions = {}): Promise<McpSmokeResult> {
  const config = {
    ...loadConfig(),
    ...(options.databasePath ? { databasePath: options.databasePath } : {})
  } satisfies MemorySidecarConfig;
  const runtime = createMemoryServer(config);
  const client = new Client({
    name: "codex-memory-sidecar-smoke",
    version: "0.1.0"
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  try {
    await Promise.all([runtime.server.connect(serverTransport), client.connect(clientTransport)]);
    const tools = await client.listTools();
    const health = await client.callTool({
      name: "health_check",
      arguments: {}
    });
    const healthCheck = health.structuredContent as McpSmokeResult["healthCheck"];

    return {
      ok: tools.tools.length > 0 && healthCheck.database.ok,
      toolNames: tools.tools.map((tool) => tool.name).sort(),
      healthCheck
    };
  } finally {
    await client.close();
    await runtime.server.close();
    runtime.store.close();
  }
}

async function main(): Promise<void> {
  const result = await runMcpSmoke();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main();
}
