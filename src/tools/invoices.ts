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

const updatePositionSchema = invoicePositionSchema.extend({
  id: z.number().int().optional().describe("ID of an existing position to change (get_invoice_positions). Without id a new position is added."),
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

type Existing = Record<string, any>;

/** The id of a nested sevdesk reference, which may arrive as { id } or as a plain value. */
const refId = (value: any): number | undefined => (value?.id !== undefined ? Number(value.id) : undefined);

const updateInvoiceSchema = z.object({
  invoiceId: z.number().int().describe("The ID of the invoice to update. It must be a draft (status 100)."),
  contactId: z.number().int().optional().describe("Change the customer. The address is then taken from the new contact."),
  contactPersonId: z.number().int().optional(),
  invoiceDate: z.string().optional().describe("YYYY-MM-DD, DD.MM.YYYY or Unix timestamp"),
  deliveryDate: z.string().optional(),
  deliveryDateUntil: z.string().optional(),
  taxRule: z.enum(["1", "2", "3", "4", "5", "11"]).optional(),
  taxText: z.string().optional(),
  currency: z.string().optional(),
  invoiceType: z.enum(["RE", "AR", "TR", "SR", "ER"]).optional(),
  status: z.enum(["100", "200"]).optional().describe("Set 200 to turn the draft into an open invoice"),
  header: z.string().optional(),
  headText: z.string().optional(),
  footText: z.string().optional(),
  timeToPay: z.number().int().optional(),
  customerInternalNote: z.string().optional(),
  invoiceNumber: z.string().optional(),
  positions: z
    .array(updatePositionSchema)
    .optional()
    .describe(
      "Positions to change or add. A position with `id` replaces that existing position completely, one without `id` is added. Existing positions that are not listed stay unchanged. Removing positions is not supported."
    ),
});

type UpdateInvoiceInput = z.infer<typeof updateInvoiceSchema>;

/**
 * saveInvoice needs the complete invoice model even for a small change, so the current
 * invoice is read first and only the fields the caller gave are overridden.
 */
export function buildUpdateInvoicePayload(existing: Existing, params: UpdateInvoiceInput) {
  if (String(existing.status) !== "100") {
    throw new Error(
      `Invoice ${params.invoiceId} has status ${existing.status}; only drafts (100) can be updated. Use reset_invoice_to_draft first if it is not enshrined.`
    );
  }

  const keep = <T,>(override: T | undefined, current: T | undefined) => override ?? current;
  const invoiceDate = toGermanDate(params.invoiceDate ?? existing.invoiceDate);
  const deliveryDate = params.deliveryDate ?? existing.deliveryDate;
  const deliveryDateUntil = params.deliveryDateUntil ?? existing.deliveryDateUntil;
  const contactChanged = params.contactId !== undefined && params.contactId !== refId(existing.contact);

  const optional = {
    invoiceNumber: keep(params.invoiceNumber, existing.invoiceNumber),
    header: keep(params.header, existing.header),
    headText: keep(params.headText, existing.headText),
    footText: keep(params.footText, existing.footText),
    customerInternalNote: keep(params.customerInternalNote, existing.customerInternalNote),
    timeToPay: keep(params.timeToPay, existing.timeToPay !== undefined && existing.timeToPay !== null ? Number(existing.timeToPay) : undefined),
    showNet: existing.showNet === undefined ? undefined : existing.showNet === true || existing.showNet === "1" || existing.showNet === "true",
    ...(contactChanged ? {} : { address: existing.address }),
  };

  return {
    invoice: {
      id: params.invoiceId,
      objectName: "Invoice" as const,
      mapAll: true as const,
      contact: { id: params.contactId ?? refId(existing.contact), objectName: "Contact" as const },
      contactPerson: { id: params.contactPersonId ?? refId(existing.contactPerson), objectName: "SevUser" as const },
      invoiceDate,
      deliveryDate: deliveryDate ? toGermanDate(deliveryDate) : invoiceDate,
      ...(deliveryDateUntil ? { deliveryDateUntil: toGermanDate(deliveryDateUntil) } : {}),
      status: Number(params.status ?? existing.status),
      discount: Number(existing.discount ?? 0),
      taxRate: Number(existing.taxRate ?? 0),
      taxRule: { id: params.taxRule ?? String(refId(existing.taxRule)), objectName: "TaxRule" as const },
      taxText: keep(params.taxText, existing.taxText),
      invoiceType: params.invoiceType ?? existing.invoiceType,
      currency: params.currency ?? existing.currency,
      addressCountry: { id: refId(existing.addressCountry) ?? 1, objectName: "StaticCountry" as const },
      ...Object.fromEntries(Object.entries(optional).filter(([, value]) => value !== undefined && value !== null)),
    },
    invoicePosSave: (params.positions ?? []).map((position) => ({
      ...(position.id ? { id: position.id } : {}),
      objectName: "InvoicePos" as const,
      mapAll: true as const,
      name: position.name,
      ...(position.text ? { text: position.text } : {}),
      quantity: position.quantity,
      price: position.price,
      taxRate: position.taxRate,
      unity: { id: position.unityId, objectName: "Unity" as const },
      ...(position.partId ? { part: { id: position.partId, objectName: "Part" as const } } : {}),
      ...(position.discount !== undefined ? { discount: position.discount } : {}),
      ...(position.id ? { invoice: { id: params.invoiceId, objectName: "Invoice" as const } } : {}),
    })),
    // sevdesk requires these four attributes to be last and in exactly this order.
    invoicePosDelete: null,
    discountSave: null,
    discountDelete: null,
    takeDefaultAddress: contactChanged,
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

  update_invoice: defineTool({
    title: "Update invoice",
    description:
      "Change a draft invoice (status 100): header fields, customer, dates and positions. Only the given fields change; everything else is kept. " +
      "Open or paid invoices must first be reset with reset_invoice_to_draft; enshrined invoices cannot be changed. Removing positions is not supported.",
    access: "write",
    idempotent: true,
    inputSchema: updateInvoiceSchema,
    handler: async (client, params) => {
      const existing = payload(
        unwrap(await client.GET("/Invoice/{invoiceId}", { params: { path: { invoiceId: params.invoiceId } } }))
      ) as Existing;
      const body = buildUpdateInvoicePayload(existing, params);
      return payload(unwrap(await client.POST("/Invoice/Factory/saveInvoice", { body: body as never })));
    },
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
      "Aggregate the invoice line items of a period by product (quantity, net and gross revenue, number of invoices). " +
      "The result also reconciles the positions with the invoice totals: surcharges and discounts on invoice level (e.g. shipping costs, coupons) are NOT positions, so the product summary can differ from the invoice totals - " +
      "see `reconciliation`. `coverage` tells whether all invoices could be loaded. " +
      "status=1000 (default) counts paid invoices only; status=billed counts open and paid invoices (everything invoiced).",
    access: "read",
    inputSchema: z.object({
      startDate: z.string().describe("Start of the timeframe: YYYY-MM-DD, DD.MM.YYYY or Unix timestamp"),
      endDate: z.string().describe("End of the timeframe (inclusive)"),
      status: z
        .enum(["100", "200", "1000", "billed"])
        .default("1000")
        .describe("100=Draft, 200=Open, 1000=Paid (default), billed=Open and Paid"),
      includePositions: z.boolean().default(false).describe("Also return the raw positions with invoice references (large)"),
      failOnIncomplete: z.boolean().default(false).describe("Fail instead of returning partial results when positions of some invoices cannot be loaded"),
    }),
    handler: async (client, params) => {
      const num = (value: unknown) => {
        const parsed = parseFloat(String(value ?? "0"));
        return Number.isFinite(parsed) ? parsed : 0;
      };
      const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

      // Step 1: fetch all invoices in the timeframe (paginate until exhausted)
      const statuses = params.status === "billed" ? [200, 1000] : [Number(params.status)];
      const invoices: Record<string, any>[] = [];
      const pageSize = 100;
      for (const status of statuses) {
        for (let offset = 0; ; offset += pageSize) {
          const page = objectsOf(
            unwrap(
              await client.GET("/Invoice", {
                params: {
                  query: {
                    status,
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
      }

      if (invoices.length === 0) {
        return {
          coverage: { invoicesFound: 0, invoicesLoaded: 0, complete: true },
          summary: [],
          message: "No invoices found for the given timeframe and status.",
        };
      }

      // Step 2: fetch positions per invoice in small parallel batches to stay friendly to the API
      const loaded: { invoice: Record<string, any>; positions: Record<string, any>[] }[] = [];
      const failedInvoiceIds: number[] = [];
      const batchSize = 10;

      for (let i = 0; i < invoices.length; i += batchSize) {
        await Promise.all(
          invoices.slice(i, i + batchSize).map(async (invoice) => {
            const invoiceId = Number(invoice.id);
            try {
              const data = unwrap(
                await client.GET("/Invoice/{invoiceId}/getPositions", { params: { path: { invoiceId } } })
              );
              loaded.push({ invoice, positions: objectsOf(data) });
            } catch {
              failedInvoiceIds.push(invoiceId);
            }
          })
        );
      }

      if (failedInvoiceIds.length > 0 && params.failOnIncomplete) {
        throw new Error(
          `Positions of ${failedInvoiceIds.length} of ${invoices.length} invoices could not be loaded (ids: ${failedInvoiceIds.join(", ")}). Aborted because failOnIncomplete is set.`
        );
      }

      // Step 3: aggregate by product. The part id is the key; free-text positions fall back to their name.
      type Product = {
        productName: string;
        partId: string | null;
        totalQuantity: number;
        totalNetRevenue: number;
        totalGrossRevenue: number;
        invoiceIds: Set<string>;
        positionCount: number;
      };
      const products = new Map<string, Product>();
      const positions: Record<string, any>[] = [];
      let positionsNet = 0;
      let positionsGross = 0;
      let headerNet = 0;
      let headerGross = 0;
      let paidGross = 0;
      const adjustedInvoices: { invoiceId: number; invoiceNumber: unknown; adjustmentGross: number; adjustmentNet: number }[] = [];

      for (const { invoice, positions: invoicePositions } of loaded) {
        let invoicePositionsNet = 0;
        let invoicePositionsGross = 0;

        for (const position of invoicePositions) {
          const partId = position.part?.id ?? null;
          const key = partId ? `part:${partId}` : `name:${position.name ?? "Unknown"}`;
          const net = num(position.sumNetAccounting);
          const gross = num(position.sumGrossAccounting);
          const entry: Product =
            products.get(key) ??
            { productName: position.name ?? "Unknown", partId, totalQuantity: 0, totalNetRevenue: 0, totalGrossRevenue: 0, invoiceIds: new Set(), positionCount: 0 };
          entry.totalQuantity += num(position.quantity);
          entry.totalNetRevenue += net;
          entry.totalGrossRevenue += gross;
          entry.invoiceIds.add(String(invoice.id));
          entry.positionCount += 1;
          products.set(key, entry);

          invoicePositionsNet += net;
          invoicePositionsGross += gross;
          if (params.includePositions) {
            positions.push({ ...position, _invoiceId: Number(invoice.id), _invoiceNumber: invoice.invoiceNumber, _invoiceDate: invoice.invoiceDate });
          }
        }

        const invoiceNet = num(invoice.sumNetAccounting ?? invoice.sumNet);
        const invoiceGross = num(invoice.sumGrossAccounting ?? invoice.sumGross);
        positionsNet += invoicePositionsNet;
        positionsGross += invoicePositionsGross;
        headerNet += invoiceNet;
        headerGross += invoiceGross;
        if (String(invoice.status) === "1000") paidGross += invoiceGross;

        if (Math.abs(invoiceGross - invoicePositionsGross) >= 0.005 || Math.abs(invoiceNet - invoicePositionsNet) >= 0.005) {
          adjustedInvoices.push({
            invoiceId: Number(invoice.id),
            invoiceNumber: invoice.invoiceNumber,
            adjustmentGross: round(invoiceGross - invoicePositionsGross),
            adjustmentNet: round(invoiceNet - invoicePositionsNet),
          });
        }
      }

      const summary = [...products.values()]
        .map(({ invoiceIds, ...product }) => ({
          ...product,
          totalQuantity: round(product.totalQuantity),
          totalNetRevenue: round(product.totalNetRevenue),
          totalGrossRevenue: round(product.totalGrossRevenue),
          invoiceCount: invoiceIds.size,
        }))
        .sort((a, b) => b.totalGrossRevenue - a.totalGrossRevenue);

      return {
        coverage: {
          invoicesFound: invoices.length,
          invoicesLoaded: loaded.length,
          complete: failedInvoiceIds.length === 0,
          ...(failedInvoiceIds.length > 0 ? { failedInvoiceIds } : {}),
        },
        ...(failedInvoiceIds.length > 0
          ? { warning: "Positions of some invoices could not be loaded; totals and summary are incomplete." }
          : {}),
        summary,
        totals: {
          invoicedGross: round(headerGross),
          invoicedNet: round(headerNet),
          paidGross: round(paidGross),
          openGross: round(headerGross - paidGross),
        },
        reconciliation: {
          positionsGross: round(positionsGross),
          positionsNet: round(positionsNet),
          adjustmentsGross: round(headerGross - positionsGross),
          adjustmentsNet: round(headerNet - positionsNet),
          invoicesWithAdjustments: adjustedInvoices.length,
          adjustedInvoices,
          note:
            "The product summary only covers line items. adjustments = invoice total minus positions: surcharges (e.g. shipping) are positive, discounts negative. 'totals' are the invoice totals and include them.",
        },
        ...(params.includePositions ? { positions } : {}),
      };
    },
  }),
};
