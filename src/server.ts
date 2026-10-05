import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SevdeskClient } from "./client.js";
import { toText } from "./lib/format.js";
import { annotationsFor, filterTools, type ToolMap } from "./lib/tool.js";

export interface ServerOptions {
  name?: string;
  version: string;
  readOnly?: boolean;
}

/** Build the MCP server. In read-only mode, tools that can change data are not registered at all. */
export function createServer(client: SevdeskClient, tools: ToolMap, options: ServerOptions): McpServer {
  const server = new McpServer(
    { name: options.name ?? "mcp-sevdesk", version: options.version },
    {
      instructions: options.readOnly
        ? "sevdesk accounting server in READ-ONLY mode: only lookup tools are available, nothing can be created, changed or deleted."
        : "sevdesk accounting server. Tools marked destructive (delete, cancel, enshrine, send) cannot be undone - confirm with the user first.",
    }
  );

  for (const [name, tool] of Object.entries(filterTools(tools, options.readOnly ?? false))) {
    server.registerTool(
      name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema.shape,
        annotations: annotationsFor(tool),
      },
      async (args: unknown) => {
        try {
          const result = await tool.handler(client, args);
          return { content: [{ type: "text" as const, text: toText(result) }] };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
        }
      }
    );
  }

  return server;
}
