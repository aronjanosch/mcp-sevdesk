import { z } from "zod";
import { unwrap } from "../lib/errors.js";
import { payload } from "../lib/format.js";
import { fetchPage, paginationShape } from "../lib/pagination.js";
import { defineTool } from "../lib/tool.js";

/** sevdesk expects prices and rates of a part as strings. */
const asString = (value: number | undefined) => (value === undefined ? undefined : value.toString());

export const partTools = {
  list_parts: defineTool({
    title: "List parts",
    description: "List parts (products/services) from the sevdesk inventory. Returns one page; use nextOffset to continue.",
    access: "read",
    inputSchema: z.object({
      partNumber: z.string().optional().describe("Filter by part number"),
      name: z.string().optional().describe("Filter by part name"),
      ...paginationShape,
    }),
    handler: (client, params) =>
      fetchPage(params, async (limit, offset) =>
        unwrap(
          await client.GET("/Part", {
            params: { query: { partNumber: params.partNumber, name: params.name, limit, offset } as never },
          })
        )
      ),
  }),

  get_part: defineTool({
    title: "Get part",
    description: "Get a specific part by ID",
    access: "read",
    inputSchema: z.object({ partId: z.number().int().describe("The ID of the part to retrieve") }),
    handler: async (client, params) =>
      payload(unwrap(await client.GET("/Part/{partId}", { params: { path: { partId: params.partId } } }))),
  }),

  create_part: defineTool({
    title: "Create part",
    description: "Create a new part (product/service) in sevdesk",
    access: "write",
    inputSchema: z.object({
      name: z.string().describe("Name of the part"),
      partNumber: z.string().optional().describe("Part number"),
      stock: z.number().optional().describe("Current stock quantity"),
      stockEnabled: z.boolean().optional().describe("Enable stock tracking"),
      unitId: z.number().int().default(1).describe("Unit ID (default: 1 for pieces)"),
      priceGross: z.number().optional().describe("Gross price"),
      priceNet: z.number().optional().describe("Net price"),
      taxRate: z.number().optional().describe("Tax rate in percent (e.g., 19)"),
    }),
    handler: async (client, params) =>
      payload(
        unwrap(
          await client.POST("/Part", {
            body: {
              name: params.name,
              partNumber: params.partNumber,
              stock: params.stock,
              stockEnabled: params.stockEnabled,
              unity: { id: params.unitId, objectName: "Unity" },
              priceGross: asString(params.priceGross),
              priceNet: asString(params.priceNet),
              taxRate: asString(params.taxRate),
            } as never,
          })
        )
      ),
  }),

  update_part: defineTool({
    title: "Update part",
    description: "Update an existing part in sevdesk. Only the given fields are changed.",
    access: "write",
    idempotent: true,
    inputSchema: z.object({
      partId: z.number().int().describe("The ID of the part to update"),
      name: z.string().optional().describe("Name of the part"),
      partNumber: z.string().optional().describe("Part number"),
      stock: z.number().optional().describe("Current stock quantity"),
      stockEnabled: z.boolean().optional().describe("Enable stock tracking"),
      priceGross: z.number().optional().describe("Gross price"),
      priceNet: z.number().optional().describe("Net price"),
      taxRate: z.number().optional().describe("Tax rate in percent"),
    }),
    handler: async (client, { partId, priceGross, priceNet, taxRate, ...rest }) => {
      const body = {
        ...rest,
        priceGross: asString(priceGross),
        priceNet: asString(priceNet),
        taxRate: asString(taxRate),
      };
      return payload(
        unwrap(await client.PUT("/Part/{partId}", { params: { path: { partId } }, body: body as never }))
      );
    },
  }),

  get_part_stock: defineTool({
    title: "Get part stock",
    description: "Get the current stock of a part",
    access: "read",
    inputSchema: z.object({ partId: z.number().int().describe("The ID of the part") }),
    handler: async (client, params) =>
      unwrap(await client.GET("/Part/{partId}/getStock", { params: { path: { partId: params.partId } } })),
  }),
};
