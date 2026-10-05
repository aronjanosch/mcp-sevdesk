#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createSevdeskClient } from "./client.js";
import { isReadOnlyMode } from "./lib/tool.js";
import { createServer } from "./server.js";
import { allTools } from "./tools/index.js";

const API_TOKEN = process.env.SEVDESK_API_TOKEN;

if (!API_TOKEN) {
  console.error("Error: SEVDESK_API_TOKEN environment variable is required");
  console.error("Please set it to your sevdesk API token");
  process.exit(1);
}

const { version } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf-8")
) as { version: string };

const readOnly = isReadOnlyMode(process.env, process.argv.slice(2));
const server = createServer(createSevdeskClient(API_TOKEN), allTools, { version, readOnly });

async function main() {
  await server.connect(new StdioServerTransport());
  console.error(`sevdesk MCP server running on stdio${readOnly ? " (read-only)" : ""}`);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
