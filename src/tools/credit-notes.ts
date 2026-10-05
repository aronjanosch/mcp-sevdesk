import { z } from "zod";
import { documentFilterQuery, documentFilterShape } from "../lib/documents.js";
import { unwrap } from "../lib/errors.js";
import { payload } from "../lib/format.js";
import { fetchPage, paginationShape } from "../lib/pagination.js";
import { defineTool } from "../lib/tool.js";

export const creditNoteTools = {
  list_credit_notes: defineTool({
    title: "List credit notes",
    description: "List credit notes (Gutschriften) from sevdesk. Returns one page; use nextOffset to continue.",
    access: "read",
    inputSchema: z.object({
      status: z.number().int().optional().describe("Credit note status code, e.g. 100=Draft, 200=Open, 1000=Paid"),
      creditNoteNumber: z.string().optional().describe("Filter by credit note number"),
      ...documentFilterShape,
      ...paginationShape,
    }),
    handler: (client, params) =>
      fetchPage(params, async (limit, offset) =>
        unwrap(
          await client.GET("/CreditNote", {
            params: {
              query: {
                status: params.status,
                creditNoteNumber: params.creditNoteNumber,
                ...documentFilterQuery(params),
                limit,
                offset,
              } as never,
            },
          })
        )
      ),
  }),

  create_credit_note_from_invoice: defineTool({
    title: "Create credit note from invoice",
    description: "Create a credit note (Gutschrift) for an existing invoice, e.g. for a refund. The credit note is created as a draft.",
    access: "write",
    inputSchema: z.object({ invoiceId: z.number().int().describe("The ID of the invoice to credit") }),
    handler: async (client, params) =>
      payload(
        unwrap(
          await client.POST("/CreditNote/Factory/createFromInvoice", {
            body: { invoice: { id: params.invoiceId, objectName: "Invoice" } },
          })
        )
      ),
  }),

  get_credit_note: defineTool({
    title: "Get credit note",
    description: "Get a specific credit note by ID",
    access: "read",
    inputSchema: z.object({ creditNoteId: z.number().int().describe("The ID of the credit note") }),
    handler: async (client, params) =>
      payload(unwrap(await client.GET("/CreditNote/{creditNoteId}", { params: { path: { creditNoteId: params.creditNoteId } } }))),
  }),

  get_credit_note_positions: defineTool({
    title: "Get credit note positions",
    description: "Get the line item positions of a credit note",
    access: "read",
    inputSchema: z.object({ creditNoteId: z.number().int().describe("The ID of the credit note"), ...paginationShape }),
    handler: (client, { creditNoteId, ...page }) =>
      fetchPage(page, async (limit, offset) =>
        unwrap(
          await client.GET("/CreditNotePos", {
            params: {
              query: { "creditNote[id]": creditNoteId, "creditNote[objectName]": "CreditNote", limit, offset } as never,
            },
          })
        )
      ),
  }),
};
