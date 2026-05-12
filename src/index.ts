#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { loadConfig } from "./config.js";
import { createMemoryServer } from "./server.js";

const runtime = createMemoryServer(loadConfig());

const transport = new StdioServerTransport();
await runtime.server.connect(transport);

process.on("SIGINT", async () => {
  runtime.store.close();
  await runtime.server.close();
  process.exit(0);
});
