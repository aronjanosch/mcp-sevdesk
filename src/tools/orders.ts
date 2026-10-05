import { z } from "zod";
import { documentFilterQuery, documentFilterShape } from "../lib/documents.js";
import { unwrap } from "../lib/errors.js";
import { payload } from "../lib/format.js";
import { fetchPage, paginationShape } from "../lib/pagination.js";
import { defineTool } from "../lib/tool.js";

export const orderTools = {
  list_orders: defineTool({
    title: "List orders and quotes",
    description: "List orders and quotes (Aufträge, Angebote) from sevdesk. Returns one page; use nextOffset to continue.",
    access: "read",
    inputSchema: z.object({
      status: z.number().int().optional().describe("Order status code, e.g. 100=Draft, 200=Delivered, 500=Accepted"),
      orderNumber: z.string().optional().describe("Filter by order number"),
      ...documentFilterShape,
      ...paginationShape,
    }),
    handler: (client, params) =>
      fetchPage(params, async (limit, offset) =>
        unwrap(
          await client.GET("/Order", {
            params: {
              query: { status: params.status, orderNumber: params.orderNumber, ...documentFilterQuery(params), limit, offset } as never,
            },
          })
        )
      ),
  }),

  get_order: defineTool({
    title: "Get order",
    description: "Get a specific order or quote by ID",
    access: "read",
    inputSchema: z.object({ orderId: z.number().int().describe("The ID of the order") }),
    handler: async (client, params) =>
      payload(unwrap(await client.GET("/Order/{orderId}", { params: { path: { orderId: params.orderId } } }))),
  }),

  get_order_positions: defineTool({
    title: "Get order positions",
    description: "Get the line item positions of an order or quote",
    access: "read",
    inputSchema: z.object({ orderId: z.number().int().describe("The ID of the order"), ...paginationShape }),
    handler: (client, { orderId, ...page }) =>
      fetchPage(page, async (limit, offset) =>
        unwrap(await client.GET("/Order/{orderId}/getPositions", { params: { path: { orderId }, query: { limit, offset } } }))
      ),
  }),
};
