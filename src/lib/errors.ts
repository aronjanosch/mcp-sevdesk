export class SevdeskApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details: unknown
  ) {
    super(message);
    this.name = "SevdeskApiError";
  }
}

function extractMessage(error: unknown): string {
  if (typeof error === "string") return error.trim();
  if (error && typeof error === "object") {
    const body = error as Record<string, any>;
    const message = body.error?.message ?? body.message ?? body.error;
    if (typeof message === "string") return message;
    return JSON.stringify(error);
  }
  return "";
}

const HINTS: Record<number, string> = {
  401: "Check that SEVDESK_API_TOKEN is valid.",
  403: "The API token is not allowed to do this.",
  404: "The requested object does not exist.",
  429: "Rate limit reached, even after retries. Try again in a moment.",
};

interface FetchResult<T> {
  data?: T;
  error?: unknown;
  response: Response;
}

/** Return the data of an openapi-fetch result or throw a readable SevdeskApiError. */
export function unwrap<T>(result: FetchResult<T>): T {
  if (result.error !== undefined || !result.response.ok) {
    const { status, statusText } = result.response;
    const detail = extractMessage(result.error);
    const hint = HINTS[status];
    throw new SevdeskApiError(
      `sevdesk API error (HTTP ${status}${statusText ? ` ${statusText}` : ""})${detail ? `: ${detail}` : ""}${hint ? ` ${hint}` : ""}`,
      status,
      result.error
    );
  }
  return result.data as T;
}
