import { z } from "zod";
import { unwrap } from "../lib/errors.js";
import { payload } from "../lib/format.js";
import { fetchPage, paginationShape } from "../lib/pagination.js";
import { defineTool } from "../lib/tool.js";

export const tagTools = {
  list_tags: defineTool({
    title: "List tags",
    description: "List tags from sevdesk",
    access: "read",
    inputSchema: z.object({
      id: z.number().int().optional().describe("Filter by tag ID"),
      name: z.string().optional().describe("Filter by tag name"),
      ...paginationShape,
    }),
    handler: (client, params) =>
      fetchPage(params, async (limit, offset) =>
        unwrap(await client.GET("/Tag", { params: { query: { id: params.id, name: params.name, limit, offset } as never } }))
      ),
  }),

  get_tag: defineTool({
    title: "Get tag",
    description: "Get a specific tag by ID",
    access: "read",
    inputSchema: z.object({ tagId: z.number().int().describe("The ID of the tag to retrieve") }),
    handler: async (client, params) =>
      payload(unwrap(await client.GET("/Tag/{tagId}", { params: { path: { tagId: params.tagId } } }))),
  }),

  create_tag: defineTool({
    title: "Create tag",
    description: "Create a new tag and attach it to a document (Invoice, Voucher, Order, or CreditNote)",
    access: "write",
    inputSchema: z.object({
      name: z.string().describe("Name of the tag"),
      objectId: z.number().int().describe("ID of the document to tag"),
      objectName: z.enum(["Invoice", "Voucher", "Order", "CreditNote"]).describe("Type of document to tag"),
    }),
    handler: async (client, params) =>
      payload(
        unwrap(
          await client.POST("/Tag/Factory/create", {
            body: { name: params.name, object: { id: params.objectId, objectName: params.objectName } } as never,
          })
        )
      ),
  }),

  update_tag: defineTool({
    title: "Rename tag",
    description: "Update an existing tag's name",
    access: "write",
    idempotent: true,
    inputSchema: z.object({
      tagId: z.number().int().describe("The ID of the tag to update"),
      name: z.string().describe("New name for the tag"),
    }),
    handler: async (client, params) =>
      payload(
        unwrap(
          await client.PUT("/Tag/{tagId}", { params: { path: { tagId: params.tagId } }, body: { name: params.name } as never })
        )
      ),
  }),

  delete_tag: defineTool({
    title: "Delete tag",
    description: "Delete a tag from sevdesk. Cannot be undone.",
    access: "destructive",
    idempotent: true,
    inputSchema: z.object({ tagId: z.number().int().describe("The ID of the tag to delete") }),
    handler: async (client, params) => {
      unwrap(await client.DELETE("/Tag/{tagId}", { params: { path: { tagId: params.tagId } } }));
      return { success: true, deletedTagId: params.tagId };
    },
  }),

  list_tag_relations: defineTool({
    title: "List tag relations",
    description: "List tag relations (shows which documents have which tags)",
    access: "read",
    inputSchema: z.object({ ...paginationShape }),
    handler: (client, params) =>
      fetchPage(params, async (limit, offset) =>
        unwrap(await client.GET("/TagRelation", { params: { query: { limit, offset } as never } }))
      ),
  }),
};
