import { z } from "zod";
import { bookingShape, buildBookingBody } from "../lib/booking.js";
import { toGermanDate, toUnixTimestamp } from "../lib/dates.js";
import { documentFilterQuery, documentFilterShape } from "../lib/documents.js";
import { unwrap } from "../lib/errors.js";
import { deliverFile } from "../lib/files.js";
import { objectsOf, payload } from "../lib/format.js";
import { fetchPage, paginationShape } from "../lib/pagination.js";
import { defineTool } from "../lib/tool.js";

const TAX_TEXTS: Record<string, string> = {
  "1": "Umsatzsteuer ausweisen",
  "2": "Steuerfreie Ausfuhrlieferung",
  "3": "Steuerfreie innergemeinschaftliche Lieferung",
  "4": "Steuerfreie Umsätze nach §4 UStG",
  "5": "Steuerschuldnerschaft des Leistungsempfängers (Reverse Charge, §13b UStG)",
  "11": "Umsatzsteuer wird aufgrund der Kleinunternehmerregelung (§19 UStG) nicht ausgewiesen",
};

const invoicePositionSchema = z.object({
  name: z.string().describe("Title of the position, e.g. the product or service name"),
  text: z.string().optional().describe("Longer description of the position"),
  quantity: z.number().positive().describe("Quantity"),
  price: z.number().describe("Unit price. Net if showNet is true (default), otherwise gross."),
  taxRate: z.number().describe("Tax rate in percent, e.g. 19, 7 or 0"),
  unityId: z.number().int().default(1).describe("Unit ID (default 1 = piece)"),
  partId: z.number().int().optional().describe("ID of a part (product) from the sevdesk inventory"),
  discount: z.number().optional().describe("Percentage discount on this position"),
});

const createInvoiceSchema = z.object({
  contactId: z.number().int().describe("ID of the customer contact (list_contacts)"),
  contactPersonId: z
    .number()
    .int()
    .describe("ID of the sevdesk user acting as contact person. sevdesk has no endpoint to list users: read it from contactPerson.id of an existing invoice (get_invoice)."),
  invoiceDate: z.string().optional().describe("Invoice date: YYYY-MM-DD, DD.MM.YYYY or Unix timestamp. Default: today"),
  deliveryDate: z.string().optional().describe("Delivery / service date. Default: the invoice date"),
  deliveryDateUntil: z.string().optional().describe("End of the delivery period, if it is a period"),
  taxRule: z
    .enum(["1", "2", "3", "4", "5", "11"])
    .default("1")
    .describe("Tax rule: 1=Umsatzsteuerpflichtig (default), 2=Ausfuhr, 3=Innergemeinschaftliche Lieferung, 4=Steuerfrei §4 UStG, 5=Reverse Charge §13b, 11=Kleinunternehmer §19"),
  taxText: z.string().optional().describe("Text describing the tax treatment. Default: standard text for the chosen taxRule"),
  currency: z.string().default("EUR").describe("ISO-4217 currency code"),
  invoiceType: z
    .enum(["RE", "AR", "TR", "SR", "ER"])
    .default("RE")
    .describe("RE=regular invoice (default), AR=advance invoice (Abschlag), TR=partial invoice, SR=final invoice, ER=final invoice of advance payments"),
  status: z.enum(["100", "200"]).default("100").describe("100=Draft (default, can still be edited), 200=Open (final, can be sent)"),
  showNet: z.boolean().default(true).describe("true = position prices are net (default), false = gross"),
  header: z.string().optional().describe("Invoice title, e.g. 'Rechnung RE-1000'"),
  headText: z.string().optional().describe("Text above the positions"),
  footText: z.string().optional().describe("Text below the positions"),
  timeToPay: z.number().int().optional().describe("Payment deadline in days"),
  customerInternalNote: z.string().optional().describe("Internal note / reference"),
  invoiceNumber: z.string().optional().describe("Invoice number. Default: sevdesk assigns the next number"),
  addressCountryId: z.number().int().default(1).describe("Country ID of the invoice address (default 1 = Germany)"),
  positions: z.array(invoicePositionSchema).min(1).describe("The line items of the invoice. At least one is required."),
});

type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;

/**
 * Maps the slim tool input onto the full saveInvoice factory model. sevdesk requires
 * mapAll/objectName on every nested object and the last attributes in a fixed order.
 */
export function buildSaveInvoicePayload(params: CreateInvoiceInput) {
  const invoiceDate = toGermanDate(params.invoiceDate ?? Math.floor(Date.now() / 1000));
  const date = (value?: string) => (value ? toGermanDate(value) : undefined);

  return {
    invoice: {
      objectName: "Invoice" as const,
      mapAll: true as const,
      ...(params.invoiceNumber ? { invoiceNumber: params.invoiceNumber } : {}),
      contact: { id: params.contactId, objectName: "Contact" as const },
      contactPerson: { id: params.contactPersonId, objectName: "SevUser" as const },
      invoiceDate,
      deliveryDate: date(params.deliveryDate) ?? invoiceDate,
      ...(params.deliveryDateUntil ? { deliveryDateUntil: date(params.deliveryDateUntil) } : {}),
      status: Number(params.status),
      discount: 0,
      taxRate: 0,
      taxRule: { id: params.taxRule, objectName: "TaxRule" as const },
      taxText: params.taxText ?? TAX_TEXTS[params.taxRule],
      invoiceType: params.invoiceType,
      currency: params.currency,
      showNet: params.showNet,
      addressCountry: { id: params.addressCountryId, objectName: "StaticCountry" as const },
      ...(params.header ? { header: params.header } : {}),
      ...(params.headText ? { headText: params.headText } : {}),
      ...(params.footText ? { footText: params.footText } : {}),
      ...(params.timeToPay !== undefined ? { timeToPay: params.timeToPay } : {}),
      ...(params.customerInternalNote ? { customerInternalNote: params.customerInternalNote } : {}),
    },
    invoicePosSave: params.positions.map((position, index) => ({
      objectName: "InvoicePos" as const,
      mapAll: true as const,
      positionNumber: index,
      name: position.name,
      ...(position.text ? { text: position.text } : {}),
      quantity: position.quantity,
      price: position.price,
      taxRate: position.taxRate,
      unity: { id: position.unityId, objectName: "Unity" as const },
      ...(position.partId ? { part: { id: position.partId, objectName: "Part" as const } } : {}),
      ...(position.discount !== undefined ? { discount: position.discount } : {}),
    })),
    // sevdesk requires these four attributes to be last and in exactly this order.
    invoicePosDelete: null,
    discountSave: null,
    discountDelete: null,
    takeDefaultAddress: true,
  };
}

export const invoiceTools = {
  list_invoices: defineTool({
    title: "List invoices",
    description: "List invoices from sevdesk. Returns one page; use nextOffset to continue.",
    access: "read",
    inputSchema: z.object({
      status: z.enum(["100", "200", "1000"]).optional().describe("Invoice status: 100=Draft, 200=Open, 1000=Paid"),
      invoiceNumber: z.string().optional().describe("Filter by invoice number"),
      ...documentFilterShape,
      ...paginationShape,
    }),
    handler: (client, params) =>
      fetchPage(params, async (limit, offset) =>
        unwrap(
          await client.GET("/Invoice", {
            params: {
              query: {
                status: params.status ? Number(params.status) : undefined,
                invoiceNumber: params.invoiceNumber,
                ...documentFilterQuery(params),
                limit,
                offset,
              } as never,
            },
          })
        )
      ),
  }),

  get_invoice: defineTool({
    title: "Get invoice",
    description: "Get a specific invoice by ID from sevdesk",
    access: "read",
    inputSchema: z.object({ invoiceId: z.number().int().describe("The ID of the invoice to retrieve") }),
    handler: async (client, params) =>
      payload(unwrap(await client.GET("/Invoice/{invoiceId}", { params: { path: { invoiceId: params.invoiceId } } }))),
  }),

  create_invoice: defineTool({
    title: "Create invoice",
    description:
      "Create a new invoice with its positions. Created as draft (status 100) by default so it can still be reviewed; set status=200 to make it final. " +
      "Needs the customer contactId (list_contacts) and a contactPersonId (see its description). Prices are net unless showNet=false.",
    access: "write",
    inputSchema: createInvoiceSchema,
    handler: async (client, params) =>
      payload(unwrap(await client.POST("/Invoice/Factory/saveInvoice", { body: buildSaveInvoicePayload(params) as never }))),
  }),

  create_invoice_from_order: defineTool({
    title: "Create invoice from order",
    description:
      "Create an invoice from an existing order or quote. Without partialType the whole order is invoiced as a final invoice (RE); use TR/AR together with type and amount for partial and advance invoices.",
    access: "write",
    inputSchema: z.object({
      orderId: z.number().int().describe("The ID of the order or quote"),
      partialType: z.enum(["RE", "TR", "AR"]).optional().describe("RE=final invoice, TR=partial invoice, AR=advance invoice"),
      type: z.enum(["percentage", "net", "gross"]).optional().describe("How `amount` is interpreted (for partial/advance invoices)"),
      amount: z.number().optional().describe("Amount or percentage of the partial/advance invoice"),
    }),
    handler: async (client, { orderId, ...rest }) =>
      payload(
        unwrap(
          await client.POST("/Invoice/Factory/createInvoiceFromOrder", {
            body: { order: { id: orderId, objectName: "Order" }, ...rest } as never,
          })
        )
      ),
  }),

  create_invoice_reminder: defineTool({
    title: "Create payment reminder",
    description:
      "Create a payment reminder (Mahnung) for an overdue invoice. This only creates the reminder document; send it afterwards with send_invoice_by_email using the returned invoice ID.",
    access: "write",
    inputSchema: z.object({ invoiceId: z.number().int().describe("The ID of the overdue invoice") }),
    handler: async (client, params) =>
      payload(
        unwrap(
          await client.POST("/Invoice/Factory/createInvoiceReminder", {
            params: { query: { "invoice[id]": params.invoiceId, "invoice[objectName]": "Invoice" } },
            body: { invoice: { id: params.invoiceId, objectName: "Invoice" } } as never,
          })
        )
      ),
  }),

  get_invoice_pdf: defineTool({
    title: "Get invoice PDF",
    description:
      "Get the PDF of an invoice. By default it is returned as base64, which is large: pass outputPath to save the PDF to disk and get only the file location. " +
      "Does not mark the invoice as sent.",
    access: "read",
    inputSchema: z.object({
      invoiceId: z.number().int().describe("The ID of the invoice"),
      outputPath: z.string().optional().describe("Local file path to save the PDF to, e.g. /tmp/RE-1000.pdf"),
      markAsSent: z
        .boolean()
        .default(false)
        .describe("sevdesk sets the 'sent' date when a PDF is fetched. Default false: the invoice is left untouched."),
    }),
    handler: async (client, params) => {
      const file = payload(
        unwrap(
          await client.GET("/Invoice/{invoiceId}/getPdf", {
            params: { path: { invoiceId: params.invoiceId }, query: { preventSendBy: !params.markAsSent } },
          })
        )
      );
      return deliverFile(file, params.outputPath);
    },
  }),

  send_invoice_by_email: defineTool({
    title: "Send invoice by e-mail",
    description: "Send an invoice by e-mail to the given recipient. The e-mail is sent immediately and cannot be recalled.",
    access: "destructive",
    inputSchema: z.object({
      invoiceId: z.number().int().describe("The ID of the invoice to send"),
      toEmail: z.string().email().describe("Recipient email address"),
      subject: z.string().describe("Email subject"),
      text: z.string().describe("Email body text"),
      copy: z.boolean().optional().describe("Send a copy to your own email"),
      additionalAttachments: z.string().optional().describe("Additional attachment IDs, comma-separated"),
      ccEmail: z.string().email().optional().describe("CC email address"),
      bccEmail: z.string().email().optional().describe("BCC email address"),
    }),
    handler: async (client, { invoiceId, ...email }) =>
      payload(
        unwrap(await client.POST("/Invoice/{invoiceId}/sendViaEmail", { params: { path: { invoiceId } }, body: email as never }))
      ),
  }),

  mark_invoice_as_sent: defineTool({
    title: "Mark invoice as sent",
    description: "Mark an invoice as sent (without sending anything)",
    access: "write",
    idempotent: true,
    inputSchema: z.object({
      invoiceId: z.number().int().describe("The ID of the invoice"),
      sendType: z.enum(["VPR", "VPDF", "VM", "VP"]).default("VM").describe("Send type: VPR=Print, VPDF=PDF, VM=Email, VP=Post"),
      sendDraft: z.boolean().optional().describe("Send draft invoice"),
    }),
    handler: async (client, params) =>
      payload(
        unwrap(
          await client.PUT("/Invoice/{invoiceId}/sendBy", {
            params: {
              path: { invoiceId: params.invoiceId },
              query: { sendType: params.sendType, sendDraft: params.sendDraft } as never,
            },
          })
        )
      ),
  }),

  book_invoice: defineTool({
    title: "Book invoice payment",
    description:
      "Book a payment on an invoice (marks it as paid). Pass checkAccountTransactionId to link an existing bank transaction to the invoice (payment matching). Undo with reset_invoice_to_open.",
    access: "write",
    inputSchema: z.object({ invoiceId: z.number().int().describe("The ID of the invoice to book"), ...bookingShape }),
    handler: async (client, { invoiceId, ...booking }) =>
      payload(
        unwrap(
          await client.PUT("/Invoice/{invoiceId}/bookAmount", {
            params: { path: { invoiceId } },
            body: buildBookingBody(booking) as never,
          })
        )
      ),
  }),

  cancel_invoice: defineTool({
    title: "Cancel invoice",
    description: "Cancel an invoice by creating a cancellation invoice (Stornorechnung). The original invoice stays in the books.",
    access: "destructive",
    inputSchema: z.object({ invoiceId: z.number().int().describe("The ID of the invoice to cancel") }),
    handler: async (client, params) =>
      payload(unwrap(await client.POST("/Invoice/{invoiceId}/cancelInvoice", { params: { path: { invoiceId: params.invoiceId } } }))),
  }),

  enshrine_invoice: defineTool({
    title: "Enshrine invoice",
    description:
      "Enshrine (festschreiben) an invoice. Enshrined invoices can never be changed or reset again. Only possible once the invoice is open (200) or higher. Cannot be undone.",
    access: "destructive",
    idempotent: true,
    inputSchema: z.object({ invoiceId: z.number().int().describe("The ID of the invoice to enshrine") }),
    handler: async (client, params) =>
      unwrap(await client.PUT("/Invoice/{invoiceId}/enshrine", { params: { path: { invoiceId: params.invoiceId } } })),
  }),

  reset_invoice_to_draft: defineTool({
    title: "Reset invoice to draft",
    description: "Reset an open invoice back to draft status (100). Not possible for enshrined invoices.",
    access: "write",
    idempotent: true,
    inputSchema: z.object({ invoiceId: z.number().int().describe("The ID of the invoice to reset") }),
    handler: async (client, params) =>
      payload(unwrap(await client.PUT("/Invoice/{invoiceId}/resetToDraft", { params: { path: { invoiceId: params.invoiceId } } }))),
  }),

  reset_invoice_to_open: defineTool({
    title: "Reset invoice to open",
    description: "Reset a paid invoice back to open status (200), undoing its booking. Not possible for enshrined invoices.",
    access: "write",
    idempotent: true,
    inputSchema: z.object({ invoiceId: z.number().int().describe("The ID of the invoice to reset") }),
    handler: async (client, params) =>
      payload(unwrap(await client.PUT("/Invoice/{invoiceId}/resetToOpen", { params: { path: { invoiceId: params.invoiceId } } }))),
  }),

  get_invoice_positions: defineTool({
    title: "Get invoice positions",
    description:
      "Get the line item positions of an invoice: product name, quantity, unit price, tax rate and totals for each position.",
    access: "read",
    inputSchema: z.object({ invoiceId: z.number().int().describe("The ID of the invoice"), ...paginationShape }),
    handler: (client, { invoiceId, ...page }) =>
      fetchPage(page, async (limit, offset) =>
        unwrap(
          await client.GET("/Invoice/{invoiceId}/getPositions", {
            params: { path: { invoiceId }, query: { limit, offset } },
          })
        )
      ),
  }),

  get_positions_by_part: defineTool({
    title: "Get positions by part",
    description:
      "Get all invoice positions for a specific part/product across all invoices. Useful for seeing every sale of a particular product. No date filtering is available at the API level - use list_invoice_positions_for_timeframe for a date range.",
    access: "read",
    inputSchema: z.object({ partId: z.number().int().describe("The ID of the part/product to look up"), ...paginationShape }),
    handler: (client, { partId, ...page }) =>
      fetchPage(page, async (limit, offset) =>
        unwrap(
          await client.GET("/InvoicePos", {
            params: { query: { "part[id]": partId, "part[objectName]": "Part", limit, offset } as never },
          })
        )
      ),
  }),

  list_invoice_positions_for_timeframe: defineTool({
    title: "Sales by product in timeframe",
    description:
      "Fetch all invoice line item positions within a date range and aggregate them by product: total quantity sold, total net and gross revenue. " +
      "Uses only paid invoices by default so drafts are not counted. Set includePositions=true to also get the raw positions (large).",
    access: "read",
    inputSchema: z.object({
      startDate: z.string().describe("Start of the timeframe: YYYY-MM-DD, DD.MM.YYYY or Unix timestamp"),
      endDate: z.string().describe("End of the timeframe (inclusive)"),
      status: z.enum(["100", "200", "1000"]).default("1000").describe("Invoice status: 100=Draft, 200=Open, 1000=Paid (default)"),
      includePositions: z.boolean().default(false).describe("Also return the raw positions with invoice references"),
    }),
    handler: async (client, params) => {
      // Step 1: fetch all invoices in the timeframe (paginate until exhausted)
      const invoices: Record<string, any>[] = [];
      const pageSize = 100;
      for (let offset = 0; ; offset += pageSize) {
        const page = objectsOf(
          unwrap(
            await client.GET("/Invoice", {
              params: {
                query: {
                  status: Number(params.status),
                  startDate: toUnixTimestamp(params.startDate),
                  endDate: toUnixTimestamp(params.endDate, { endOfDay: true }),
                  limit: pageSize,
                  offset,
                } as never,
              },
            })
          )
        );
        invoices.push(...page);
        if (page.length < pageSize) break;
      }

      if (invoices.length === 0) {
        return { invoiceCount: 0, summary: [], message: "No invoices found for the given timeframe and status." };
      }

      // Step 2: fetch positions per invoice in small parallel batches to stay friendly to the API
      const positions: Record<string, any>[] = [];
      const failedInvoiceIds: number[] = [];
      const batchSize = 10;

      for (let i = 0; i < invoices.length; i += batchSize) {
        const results = await Promise.all(
          invoices.slice(i, i + batchSize).map(async (invoice) => {
            const invoiceId = Number(invoice.id);
            try {
              const data = unwrap(
                await client.GET("/Invoice/{invoiceId}/getPositions", { params: { path: { invoiceId } } })
              );
              return objectsOf(data).map((position) => ({
                ...position,
                _invoiceId: invoiceId,
                _invoiceNumber: invoice.invoiceNumber,
                _invoiceDate: invoice.invoiceDate,
              }));
            } catch {
              failedInvoiceIds.push(invoiceId);
              return [];
            }
          })
        );
        positions.push(...results.flat());
      }

      // Step 3: aggregate by product
      const products = new Map<
        string,
        { productName: string; partId: string | null; totalQuantity: number; totalNetRevenue: number; totalGrossRevenue: number; positionCount: number }
      >();

      for (const position of positions) {
        const key = position.name ?? position.part?.id ?? "Unknown";
        const entry =
          products.get(key) ??
          { productName: key, partId: position.part?.id ?? null, totalQuantity: 0, totalNetRevenue: 0, totalGrossRevenue: 0, positionCount: 0 };
        entry.totalQuantity += parseFloat(position.quantity ?? "0");
        entry.totalNetRevenue += parseFloat(position.sumNetAccounting ?? "0");
        entry.totalGrossRevenue += parseFloat(position.sumGrossAccounting ?? "0");
        entry.positionCount += 1;
        products.set(key, entry);
      }

      const round = (n: number) => Math.round(n * 100) / 100;
      const summary = [...products.values()]
        .map((p) => ({ ...p, totalNetRevenue: round(p.totalNetRevenue), totalGrossRevenue: round(p.totalGrossRevenue) }))
        .sort((a, b) => b.totalGrossRevenue - a.totalGrossRevenue);

      return {
        invoiceCount: invoices.length,
        positionCount: positions.length,
        summary,
        ...(failedInvoiceIds.length > 0
          ? { warning: "Positions of some invoices could not be loaded; the totals are incomplete.", failedInvoiceIds }
          : {}),
        ...(params.includePositions ? { positions } : {}),
      };
    },
  }),
};
