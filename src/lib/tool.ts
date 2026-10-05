import type { z } from "zod";
import type { SevdeskClient } from "../client.js";

/**
 * read        - does not change anything in sevdesk
 * write       - creates or changes data, but can be undone or corrected
 * destructive - deletes data or triggers something that cannot be taken back
 *               (deleting, cancelling, enshrining, sending e-mails)
 */
export type Access = "read" | "write" | "destructive";

export interface ToolDefinition<S extends z.AnyZodObject = z.AnyZodObject> {
  title: string;
  description: string;
  access: Access;
  /** Repeating the call with the same arguments has no additional effect. */
  idempotent: boolean;
  inputSchema: S;
  handler: (client: SevdeskClient, params: z.infer<S>) => Promise<unknown>;
}

export function defineTool<S extends z.AnyZodObject>(
  definition: Omit<ToolDefinition<S>, "idempotent"> & { idempotent?: boolean }
): ToolDefinition<S> {
  return { idempotent: definition.access === "read", ...definition };
}

export interface ToolAnnotations {
  title: string;
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}

export function annotationsFor(tool: ToolDefinition<any>): ToolAnnotations {
  return {
    title: tool.title,
    readOnlyHint: tool.access === "read",
    destructiveHint: tool.access === "destructive",
    idempotentHint: tool.idempotent,
    openWorldHint: true,
  };
}

export type ToolMap = Record<string, ToolDefinition<any>>;

/** In read-only mode only tools that cannot change anything in sevdesk are exposed. */
export function filterTools(tools: ToolMap, readOnly: boolean): ToolMap {
  if (!readOnly) return tools;
  return Object.fromEntries(Object.entries(tools).filter(([, tool]) => tool.access === "read"));
}

const TRUTHY = new Set(["1", "true", "yes", "on"]);

export function isReadOnlyMode(env: NodeJS.ProcessEnv, argv: string[]): boolean {
  return argv.includes("--read-only") || TRUTHY.has((env.SEVDESK_READONLY ?? "").trim().toLowerCase());
}
