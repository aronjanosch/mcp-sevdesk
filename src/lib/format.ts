/** Keys that carry no information for the model: the account reference is the same on every object. */
const NOISE_KEYS = new Set(["sevClient"]);

/**
 * Drop null, empty strings and empty containers (plus noise keys) so responses cost fewer
 * tokens. 0 and false are meaningful and kept.
 */
export function compact(value: unknown): unknown {
  if (Array.isArray(value)) {
    const items = value.map(compact).filter((item) => item !== undefined);
    return items.length > 0 ? items : undefined;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !NOISE_KEYS.has(key))
      .map(([key, item]) => [key, compact(item)] as const)
      .filter(([, item]) => item !== undefined);
    return entries.length > 0 ? Object.fromEntries(entries) : undefined;
  }
  if (value === null || value === undefined || value === "") return undefined;
  return value;
}

/**
 * sevdesk wraps results in { objects: ... } and single objects in a one-element array.
 * Unwrap both so a get_* tool returns the object itself.
 */
export function payload(data: unknown): unknown {
  if (data && typeof data === "object" && "objects" in data) {
    const objects = (data as { objects: unknown }).objects;
    return Array.isArray(objects) && objects.length === 1 ? objects[0] : objects;
  }
  return data;
}

/** Always the list of objects of a list response, never a single object. */
export function objectsOf(data: unknown): Record<string, any>[] {
  const objects = (data as { objects?: unknown } | undefined)?.objects;
  if (Array.isArray(objects)) return objects;
  return objects ? [objects as Record<string, any>] : [];
}

export function toText(result: unknown): string {
  // An empty top-level list must stay visible as [] instead of turning into null
  return JSON.stringify(compact(result) ?? (Array.isArray(result) ? [] : null));
}
