#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { loadConfig } from "./config.js";
import { createMemoryServer } from "./server.js";
import { runStartupMaintenance } from "./startup-maintenance.js";

const config = loadConfig();
const runtime = createMemoryServer(config);
const startup = await runStartupMaintenance(runtime.store, config);
for (const warning of startup.warnings) {
  console.error(`codex-memory-sidecar startup warning: ${warning}`);
}

const transport = new StdioServerTransport();
await runtime.server.connect(transport);

process.on("SIGINT", async () => {
  runtime.store.close();
  await runtime.server.close();
  process.exit(0);
});
