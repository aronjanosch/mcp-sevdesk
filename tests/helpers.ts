import { createSevdeskClient } from "../src/client.js";

export interface RecordedRequest {
  method: string;
  url: URL;
  body: any;
  headers: Headers;
}

type Responder = (request: RecordedRequest, callIndex: number) => Response | Promise<Response>;

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

/** A sevdesk client that talks to a scripted fake instead of the network. */
export function mockClient(responder: Responder, options: { maxRetries?: number; retryBaseDelayMs?: number; timeoutMs?: number } = {}) {
  const requests: RecordedRequest[] = [];

  const fakeFetch = (async (input: Request, init?: RequestInit) => {
    const text = await input.clone().text();
    const recorded: RecordedRequest = {
      method: input.method,
      url: new URL(input.url),
      body: text ? JSON.parse(text) : undefined,
      headers: input.headers,
    };
    requests.push(recorded);
    const response = await responder(recorded, requests.length - 1);
    if (init?.signal?.aborted) throw init.signal.reason;
    return response;
  }) as typeof fetch;

  const client = createSevdeskClient("test-token", {
    fetch: fakeFetch,
    retryBaseDelayMs: 1,
    ...options,
  });
  return { client, requests };
}
