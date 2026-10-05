import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { SevdeskClient } from "../src/client.js";
import { createServer } from "../src/server.js";
import { allTools } from "../src/tools/index.js";
import { mockClient, type RecordedRequest } from "./helpers.js";

/** An MCP client connected to the real server; `api` is the sevdesk client the tools use. */
export async function connectServer(api: SevdeskClient, readOnly = false) {
  const server = createServer(api, allTools, { version: "0.0.0-test", readOnly });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return client;
}

export async function createClientPair(
  responder: (req: RecordedRequest, i: number) => Response | Promise<Response>,
  readOnly = false
) {
  const { client: api, requests } = mockClient(responder);
  return { client: await connectServer(api, readOnly), requests };
}
