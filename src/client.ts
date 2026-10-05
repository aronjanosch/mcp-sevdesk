import createClient from "openapi-fetch";
import type { paths } from "./generated/sevdesk-api.js";

export interface SevdeskClientOptions {
  baseUrl?: string;
  /** Replaceable for tests; defaults to the global fetch. */
  fetch?: typeof fetch;
  /** Per-attempt timeout in milliseconds. */
  timeoutMs?: number;
  /** How often a failed request is retried (429 for every method, 5xx / network errors only for GET). */
  maxRetries?: number;
  /** Base delay for the exponential backoff in milliseconds. */
  retryBaseDelayMs?: number;
}

const DEFAULTS = {
  baseUrl: "https://my.sevdesk.de/api/v1",
  timeoutMs: 30_000,
  maxRetries: 3,
  retryBaseDelayMs: 500,
};
const MAX_RETRY_DELAY_MS = 10_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Delay before the next attempt: the Retry-After header if present, else exponential backoff with jitter. */
function retryDelay(response: Response | undefined, attempt: number, baseMs: number): number {
  const retryAfter = Number(response?.headers.get("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(retryAfter * 1000, MAX_RETRY_DELAY_MS);
  }
  return Math.min(baseMs * 2 ** attempt + Math.random() * baseMs, MAX_RETRY_DELAY_MS);
}

/**
 * sevdesk answers with 429 under load but does not document its limits, so every request
 * gets a timeout and a bounded retry. A 429 means the request was rejected and is safe to
 * repeat for every method; 5xx and network errors are only repeated for GET, because a POST
 * or PUT may already have been processed.
 */
function createResilientFetch(options: Required<Omit<SevdeskClientOptions, "baseUrl">>): typeof fetch {
  return (async (input: Request) => {
    for (let attempt = 0; ; attempt++) {
      const canRetry = attempt < options.maxRetries;
      const isGet = input.method === "GET";
      let response: Response;

      try {
        response = await options.fetch(input.clone(), { signal: AbortSignal.timeout(options.timeoutMs) });
      } catch (error) {
        if (canRetry && isGet) {
          await sleep(retryDelay(undefined, attempt, options.retryBaseDelayMs));
          continue;
        }
        if (error instanceof Error && error.name === "TimeoutError") {
          throw new Error(`sevdesk request timed out after ${options.timeoutMs} ms (${input.method} ${new URL(input.url).pathname})`);
        }
        throw error;
      }

      const retryable = response.status === 429 || (isGet && response.status >= 500 && response.status !== 501);
      if (retryable && canRetry) {
        await sleep(retryDelay(response, attempt, options.retryBaseDelayMs));
        continue;
      }
      return response;
    }
  }) as typeof fetch;
}

export function createSevdeskClient(apiToken: string, options: SevdeskClientOptions = {}) {
  const resolved = {
    fetch: options.fetch ?? globalThis.fetch,
    timeoutMs: options.timeoutMs ?? DEFAULTS.timeoutMs,
    maxRetries: options.maxRetries ?? DEFAULTS.maxRetries,
    retryBaseDelayMs: options.retryBaseDelayMs ?? DEFAULTS.retryBaseDelayMs,
  };

  return createClient<paths>({
    baseUrl: options.baseUrl ?? DEFAULTS.baseUrl,
    headers: {
      Authorization: apiToken,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    fetch: createResilientFetch(resolved),
  });
}

export type SevdeskClient = ReturnType<typeof createSevdeskClient>;
