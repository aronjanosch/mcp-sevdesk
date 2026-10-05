import { z } from "zod";
import { compact, objectsOf } from "./format.js";

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 500;

/** Spread into the inputSchema of every list tool. */
export const paginationShape = {
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_LIMIT)
    .default(DEFAULT_LIMIT)
    .describe(`Maximum number of results per page (default ${DEFAULT_LIMIT}, max ${MAX_LIMIT})`),
  offset: z.number().int().min(0).default(0).describe("Number of results to skip. Use nextOffset of the previous page."),
  fields: z
    .array(z.string())
    .optional()
    .describe('Return only these top-level fields of each result, e.g. ["id","name"]. Saves tokens on large lists.'),
};

export interface PageParams {
  limit: number;
  offset: number;
  fields?: string[];
}

export interface Page {
  objects: unknown[];
  count: number;
  limit: number;
  offset: number;
  hasMore: boolean;
  nextOffset?: number;
}

function project(object: Record<string, any>, fields?: string[]): Record<string, any> {
  if (!fields || fields.length === 0) return object;
  return Object.fromEntries(fields.filter((field) => field in object).map((field) => [field, object[field]]));
}

/**
 * Fetch one page. One extra item is requested so hasMore is exact instead of a guess.
 * `fetchObjects` receives the limit/offset to send to sevdesk and returns the raw response.
 */
export async function fetchPage(
  params: PageParams,
  fetchObjects: (limit: number, offset: number) => Promise<unknown>
): Promise<Page> {
  const items = objectsOf(await fetchObjects(params.limit + 1, params.offset));
  const hasMore = items.length > params.limit;
  const objects = items.slice(0, params.limit).map((item) => compact(project(item, params.fields)) ?? {});

  return {
    objects,
    count: objects.length,
    limit: params.limit,
    offset: params.offset,
    hasMore,
    ...(hasMore ? { nextOffset: params.offset + params.limit } : {}),
  };
}
