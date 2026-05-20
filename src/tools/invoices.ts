import { z } from "zod";
import type { SevdeskClient } from "../client.js";

export const invoiceTools = {
  list_invoices: {
    description: "List all invoices from sevdesk. Supports filtering and pagination.",
    inputSchema: z.object({
      status: z.enum(["100", "200", "1000"]).optional().describe("Invoice status: 100=Draft, 200=Open, 1000=Paid"),
      invoiceNumber: z.string().optional().describe("Filter by invoice number"),
      startDate: z.string().optional().describe("Filter by start date (Unix timestamp)"),
      endDate: z.string().optional().describe("Filter by end date (Unix timestamp)"),
      limit: z.number().optional().describe("Limit the number of results"),
      offset: z.number().optional().describe("Skip a number of results"),
    }),
    handler: async (client: SevdeskClient, params: {
      status?: "100" | "200" | "1000";
      invoiceNumber?: string;
      startDate?: string;
      endDate?: string;
      limit?: number;
      offset?: number;
    }) => {
      const { data, error } = await client.GET("/Invoice", {
        params: {
          query: {
            status: params.status ? Number(params.status) : undefined,
            invoiceNumber: params.invoiceNumber,
            startDate: params.startDate ? Number(params.startDate) : undefined,
            endDate: params.endDate ? Number(params.endDate) : undefined,
            limit: params.limit,
            offset: params.offset,
          } as any,
        },
      });
      if (error) throw new Error(JSON.stringify(error));
      return data;
    },
  },

  get_invoice: {
    description: "Get a specific invoice by ID from sevdesk",
    inputSchema: z.object({
      invoiceId: z.number().describe("The ID of the invoice to retrieve"),
    }),
    handler: async (client: SevdeskClient, params: { invoiceId: number }) => {
      const { data, error } = await client.GET("/Invoice/{invoiceId}", {
        params: {
          path: { invoiceId: params.invoiceId },
        },
      });
      if (error) throw new Error(JSON.stringify(error));
      return data;
    },
  },

  get_invoice_pdf: {
    description: "Get the PDF of an invoice as base64 encoded string",
    inputSchema: z.object({
      invoiceId: z.number().describe("The ID of the invoice"),
      download: z.boolean().optional().describe("Whether to download the PDF"),
      preventSendBy: z.boolean().optional().describe("Prevent setting sendBy date"),
    }),
    handler: async (client: SevdeskClient, params: {
      invoiceId: number;
      download?: boolean;
      preventSendBy?: boolean;
    }) => {
      const { data, error } = await client.GET("/Invoice/{invoiceId}/getPdf", {
        params: {
          path: { invoiceId: params.invoiceId },
          query: {
            download: params.download,
            preventSendBy: params.preventSendBy,
          },
        },
      });
      if (error) throw new Error(JSON.stringify(error));
      return data;
    },
  },

  send_invoice_by_email: {
    description: "Send an invoice via email",
    inputSchema: z.object({
      invoiceId: z.number().describe("The ID of the invoice to send"),
      toEmail: z.string().describe("Recipient email address"),
      subject: z.string().describe("Email subject"),
      text: z.string().describe("Email body text"),
      copy: z.boolean().optional().describe("Send a copy to your own email"),
      additionalAttachments: z.string().optional().describe("Additional attachment IDs, comma-separated"),
      ccEmail: z.string().optional().describe("CC email address"),
      bccEmail: z.string().optional().describe("BCC email address"),
    }),
    handler: async (client: SevdeskClient, params: {
      invoiceId: number;
      toEmail: string;
      subject: string;
      text: string;
      copy?: boolean;
      additionalAttachments?: string;
      ccEmail?: string;
      bccEmail?: string;
    }) => {
      const { data, error } = await client.POST("/Invoice/{invoiceId}/sendViaEmail", {
        params: {
          path: { invoiceId: params.invoiceId },
        },
        body: {
          toEmail: params.toEmail,
          subject: params.subject,
          text: params.text,
          copy: params.copy,
          additionalAttachments: params.additionalAttachments,
          ccEmail: params.ccEmail,
          bccEmail: params.bccEmail,
        } as any,
      });
      if (error) throw new Error(JSON.stringify(error));
      return data;
    },
  },

  mark_invoice_as_sent: {
    description: "Mark an invoice as sent",
    inputSchema: z.object({
      invoiceId: z.number().describe("The ID of the invoice"),
      sendType: z.enum(["VPR", "VPDF", "VM", "VP"]).optional().describe("Send type: VPR=Print, VPDF=PDF, VM=Email, VP=Post"),
      sendDraft: z.boolean().optional().describe("Send draft invoice"),
    }),
    handler: async (client: SevdeskClient, params: {
      invoiceId: number;
      sendType?: "VPR" | "VPDF" | "VM" | "VP";
      sendDraft?: boolean;
    }) => {
      const { data, error } = await client.PUT("/Invoice/{invoiceId}/sendBy", {
        params: {
          path: { invoiceId: params.invoiceId },
          query: {
            sendType: params.sendType ?? "VM",
            sendDraft: params.sendDraft,
          } as any,
        },
      });
      if (error) throw new Error(JSON.stringify(error));
      return data;
    },
  },

  book_invoice: {
    description: "Book an invoice (mark it as paid)",
    inputSchema: z.object({
      invoiceId: z.number().describe("The ID of the invoice to book"),
      amount: z.number().describe("Amount to book"),
      date: z.string().describe("Booking date (Unix timestamp)"),
      type: z.enum(["N", "CB", "CF", "O", "OF", "MF", "C"]).describe("Booking type: N=Normal, CB=Cash discount, etc."),
      checkAccountId: z.number().describe("ID of the check account"),
      checkAccountTransactionId: z.number().optional().describe("ID of an existing transaction to link"),
      createFeed: z.boolean().optional().describe("Create a feed entry"),
    }),
    handler: async (client: SevdeskClient, params: {
      invoiceId: number;
      amount: number;
      date: string;
      type: "N" | "CB" | "CF" | "O" | "OF" | "MF" | "C";
      checkAccountId: number;
      checkAccountTransactionId?: number;
      createFeed?: boolean;
    }) => {
      const { data, error } = await client.PUT("/Invoice/{invoiceId}/bookAmount", {
        params: {
          path: { invoiceId: params.invoiceId },
        },
        body: {
          amount: params.amount,
          date: params.date,
          type: params.type,
          checkAccount: {
            id: params.checkAccountId,
            objectName: "CheckAccount",
          },
          checkAccountTransaction: params.checkAccountTransactionId
            ? {
                id: params.checkAccountTransactionId,
                objectName: "CheckAccountTransaction",
              }
            : undefined,
          createFeed: params.createFeed,
        } as any,
      });
      if (error) throw new Error(JSON.stringify(error));
      return data;
    },
  },

  cancel_invoice: {
    description: "Cancel an invoice (creates a cancellation invoice)",
    inputSchema: z.object({
      invoiceId: z.number().describe("The ID of the invoice to cancel"),
    }),
    handler: async (client: SevdeskClient, params: { invoiceId: number }) => {
      const { data, error } = await client.POST("/Invoice/{invoiceId}/cancelInvoice", {
        params: {
          path: { invoiceId: params.invoiceId },
        },
      });
      if (error) throw new Error(JSON.stringify(error));
      return data;
    },
  },

  get_invoice_positions: {
    description: "Get all line item positions for a specific invoice by ID. Returns product name, quantity, unit price, tax rate and totals for each position.",
    inputSchema: z.object({
      invoiceId: z.number().describe("The ID of the invoice"),
      limit: z.number().optional().describe("Limit the number of positions returned"),
      offset: z.number().optional().describe("Skip a number of positions"),
    }),
    handler: async (client: SevdeskClient, params: {
      invoiceId: number;
      limit?: number;
      offset?: number;
    }) => {
      const { data, error } = await client.GET("/Invoice/{invoiceId}/getPositions", {
        params: {
          path: { invoiceId: params.invoiceId },
          query: {
            limit: params.limit,
            offset: params.offset,
          },
        },
      });
      if (error) throw new Error(JSON.stringify(error));
      return data;
    },
  },

  get_positions_by_part: {
    description: "Get all invoice positions for a specific part/product across all invoices. Useful for seeing every sale of a particular product. Note: no date filtering is available at the API level — use list_invoice_positions_for_timeframe if you need a date range.",
    inputSchema: z.object({
      partId: z.number().describe("The ID of the part/product to look up"),
    }),
    handler: async (client: SevdeskClient, params: { partId: number }) => {
      const { data, error } = await client.GET("/InvoicePos", {
        params: {
          query: {
            "part[id]": params.partId,
            "part[objectName]": "Part",
          } as any,
        },
      });
      if (error) throw new Error(JSON.stringify(error));
      return data;
    },
  },

  list_invoice_positions_for_timeframe: {
    description: `Fetch all invoice line item positions across multiple invoices within a date range, then aggregate by product.
Returns two things:
1. A summary grouped by product name showing total quantity sold, total net revenue, and total gross revenue — useful for seeing which products sold how much.
2. The raw positions list with invoice references for detailed analysis.
Uses only definitive (paid/sent) invoices by default to avoid counting drafts or internal numbers. Date inputs are Unix timestamps (seconds).`,
    inputSchema: z.object({
      startDate: z.string().describe("Start of the timeframe as Unix timestamp (e.g. 1704067200 for 2024-01-01)"),
      endDate: z.string().describe("End of the timeframe as Unix timestamp (e.g. 1735689600 for 2024-12-31)"),
      status: z.enum(["100", "200", "1000"]).optional().describe("Invoice status filter: 100=Draft, 200=Open, 1000=Paid. Defaults to 1000 (paid/definitive) to exclude drafts"),
    }),
    handler: async (client: SevdeskClient, params: {
      startDate: string;
      endDate: string;
      status?: "100" | "200" | "1000";
    }) => {
      // Step 1: fetch all invoices in the timeframe (paginate until exhausted)
      const invoiceStatus = params.status ?? "1000";
      const allInvoices: any[] = [];
      const pageSize = 100;
      let offset = 0;

      while (true) {
        const { data, error } = await client.GET("/Invoice", {
          params: {
            query: {
              status: Number(invoiceStatus),
              startDate: Number(params.startDate),
              endDate: Number(params.endDate),
              limit: pageSize,
              offset,
            } as any,
          },
        });
        if (error) throw new Error(`Failed to fetch invoices: ${JSON.stringify(error)}`);
        const page: any[] = (data as any)?.objects ?? [];
        allInvoices.push(...page);
        if (page.length < pageSize) break;
        offset += pageSize;
      }

      if (allInvoices.length === 0) {
        return {
          summary: [],
          positions: [],
          invoiceCount: 0,
          message: "No invoices found for the given timeframe and status.",
        };
      }

      // Step 2: fetch positions for each invoice in parallel (batched to avoid hammering the API)
      const allPositions: any[] = [];
      const batchSize = 10;

      for (let i = 0; i < allInvoices.length; i += batchSize) {
        const batch = allInvoices.slice(i, i + batchSize);
        const results = await Promise.all(
          batch.map(async (invoice: any) => {
            const invoiceId = Number(invoice.id);
            const { data, error } = await client.GET("/Invoice/{invoiceId}/getPositions", {
              params: { path: { invoiceId } },
            });
            if (error) return []; // skip invoices where positions can't be fetched
            const positions: any[] = (data as any)?.objects ?? [];
            // Annotate each position with invoice metadata for traceability
            return positions.map((pos: any) => ({
              ...pos,
              _invoiceId: invoiceId,
              _invoiceNumber: invoice.invoiceNumber,
              _invoiceDate: invoice.invoiceDate,
              _contactName: invoice.contact?.name ?? null,
            }));
          })
        );
        allPositions.push(...results.flat());
      }

      // Step 3: aggregate by product name
      const productMap = new Map<string, {
        productName: string;
        partId: string | null;
        totalQuantity: number;
        totalNetRevenue: number;
        totalGrossRevenue: number;
        invoiceCount: number;
      }>();

      for (const pos of allPositions) {
        const key = pos.name ?? pos.part?.id ?? "Unknown";
        const qty = parseFloat(pos.quantity ?? "0");
        const net = parseFloat(pos.sumNetAccounting ?? "0");
        const gross = parseFloat(pos.sumGrossAccounting ?? "0");

        if (productMap.has(key)) {
          const entry = productMap.get(key)!;
          entry.totalQuantity += qty;
          entry.totalNetRevenue += net;
          entry.totalGrossRevenue += gross;
          entry.invoiceCount += 1;
        } else {
          productMap.set(key, {
            productName: key,
            partId: pos.part?.id ?? null,
            totalQuantity: qty,
            totalNetRevenue: net,
            totalGrossRevenue: gross,
            invoiceCount: 1,
          });
        }
      }

      const summary = Array.from(productMap.values())
        .sort((a, b) => b.totalGrossRevenue - a.totalGrossRevenue);

      return {
        invoiceCount: allInvoices.length,
        positionCount: allPositions.length,
        summary,
        positions: allPositions,
      };
    },
  },
};
