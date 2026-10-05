import { z } from "zod";
import { bookingShape, buildBookingBody } from "../lib/booking.js";
import { toUnixTimestamp } from "../lib/dates.js";
import { unwrap } from "../lib/errors.js";
import { payload } from "../lib/format.js";
import { fetchPage, paginationShape } from "../lib/pagination.js";
import { defineTool } from "../lib/tool.js";
import type { components } from "../generated/sevdesk-api.js";

/**
 * Shape of a voucher position as it has to be sent to /Voucher/Factory/saveVoucher.
 * The generated Model_VoucherPos cannot be used here because it marks the fields
 * that the server fills in (`voucher`, the sum* accounting fields) as required and
 * readonly, and it requires both `accountDatev` and `accountingType` even though
 * exactly one of them is used depending on the bookkeeping system version.
 */
type VoucherPosPayload = {
  objectName: "VoucherPos";
  mapAll: true;
  accountingType?: { id: number; objectName: "AccountingType" };
  accountDatev?: { id: number; objectName: "AccountDatev" };
  taxRate: number;
  net: boolean;
  sumNet: number;
  sumGross: number;
  isAsset?: boolean;
  comment?: string;
};

type VoucherPayload = {
  id?: number;
  objectName: "Voucher";
  mapAll: true;
  status: 50 | 100;
  voucherType: "VOU" | "RV";
  creditDebit: "C" | "D";
  taxRule?: { id: "1" | "2" | "3" | "4" | "5" | "11"; objectName: "TaxRule" };
  taxType?: string;
  voucherDate?: string;
  payDate?: string;
  description?: string;
  supplier?: { id: number; objectName: "Contact" };
  supplierName?: string;
  currency?: string;
  deliveryDate?: string;
  paymentDeadline?: string;
  costCentre?: { id: number; objectName: "CostCentre" };
};

type SaveVoucherPayload = {
  voucher: VoucherPayload;
  voucherPosSave: VoucherPosPayload[];
  voucherPosDelete: { id: number; objectName: "VoucherPos" }[] | null;
  filename?: string;
};

/**
 * The generated schema marks both `taxRule` and `taxType` as required on the voucher,
 * but they are the mutually exclusive 2.0 and 1.0 variants of the same setting and the
 * API rejects sending both. SaveVoucherPayload above models what the API actually
 * accepts, so the cast is confined to this one boundary.
 */
function asGeneratedPayload(payload: SaveVoucherPayload): components["schemas"]["saveVoucher"] {
  return payload as unknown as components["schemas"]["saveVoucher"];
}

const voucherPositionSchema = z.object({
  accountingTypeId: z
    .number()
    .optional()
    .describe(
      "ID of the AccountingType (Buchungskonto) for sevdesk-Update 1.0. Use get_receipt_guidance (scope expense/revenue) to find a valid ID. Either accountingTypeId or accountDatevId is required."
    ),
  accountDatevId: z
    .number()
    .optional()
    .describe(
      "ID of the AccountDatev (Buchungskonto) for sevdesk-Update 2.0. Either accountingTypeId or accountDatevId is required."
    ),
  taxRate: z.number().describe("Tax rate of this position in percent, e.g. 19, 7 or 0"),
  net: z
    .boolean()
    .optional()
    .describe(
      "true = the amount you provide is net, false = it is gross. Default: false (gross), which is what you read off a receipt."
    ),
  sum: z
    .number()
    .describe("The amount of this position, interpreted as net or gross depending on the 'net' flag"),
  comment: z.string().optional().describe("Comment / description of the position"),
  isAsset: z
    .boolean()
    .optional()
    .describe("Whether the position is an asset that can be depreciated (Anlagevermögen)"),
});

type VoucherPositionInput = z.infer<typeof voucherPositionSchema>;

/** Round to 2 decimals; sevdesk rejects amounts with floating point noise. */
function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * sevdesk requires both sumNet and sumGross on every position. We only ask for one
 * amount and derive the other, so the two can never contradict each other.
 */
export function buildPositions(positions: VoucherPositionInput[]): VoucherPosPayload[] {
  return positions.map((position, index) => {
    if (!position.accountingTypeId && !position.accountDatevId) {
      throw new Error(
        `Position ${index}: either accountingTypeId or accountDatevId is required. Use get_receipt_guidance to look up a valid booking account.`
      );
    }

    const isNet = position.net ?? false;
    const factor = 1 + position.taxRate / 100;
    const sumNet = isNet ? position.sum : position.sum / factor;
    const sumGross = isNet ? position.sum * factor : position.sum;

    return {
      objectName: "VoucherPos",
      mapAll: true,
      ...(position.accountingTypeId
        ? { accountingType: { id: position.accountingTypeId, objectName: "AccountingType" as const } }
        : {}),
      ...(position.accountDatevId
        ? { accountDatev: { id: position.accountDatevId, objectName: "AccountDatev" as const } }
        : {}),
      taxRate: position.taxRate,
      net: isNet,
      sumNet: round2(sumNet),
      sumGross: round2(sumGross),
      ...(position.isAsset !== undefined ? { isAsset: position.isAsset } : {}),
      ...(position.comment ? { comment: position.comment } : {}),
    };
  });
}

const voucherBaseSchema = {
  creditDebit: z
    .enum(["C", "D"])
    .describe("C=Credit (Einnahme/revenue), D=Debit (Ausgabe/expense). Most receipts are D."),
  taxRule: z
    .enum(["1", "2", "3", "4", "5", "11"])
    .optional()
    .describe(
      "Tax rule (sevdesk-Update 2.0, recommended): 1=Umsatzsteuerpflichtige Umsätze, 2=Ausfuhren, 3=Innergemeinschaftliche Lieferungen, 4=Steuerfreie Umsätze §4 UStG, 5=Reverse Charge §13b UStG, 11=Kleinunternehmer §19 UStG. Either taxRule or taxType is required."
    ),
  taxType: z
    .string()
    .optional()
    .describe(
      "Tax type (sevdesk-Update 1.0, legacy): default, eu, noteu, custom or ss. Either taxRule or taxType is required."
    ),
  voucherDate: z.string().optional().describe("Date of the voucher, as dd.mm.yyyy or Unix timestamp"),
  supplierId: z.number().optional().describe("ID of the supplier contact"),
  supplierName: z
    .string()
    .optional()
    .describe("Name of the supplier, used when no supplier contact exists in sevdesk"),
  description: z.string().optional().describe("Description / voucher number (Belegnummer)"),
  payDate: z.string().optional().describe("Date the voucher was paid, as dd.mm.yyyy or Unix timestamp"),
  paymentDeadline: z.string().optional().describe("Payment deadline, as dd.mm.yyyy or Unix timestamp"),
  deliveryDate: z.string().optional().describe("Delivery date, as dd.mm.yyyy or Unix timestamp"),
  currency: z.string().optional().describe("Currency code, e.g. EUR. Defaults to the account currency."),
  costCentreId: z.number().optional().describe("ID of the cost centre (Kostenstelle)"),
  voucherType: z
    .enum(["VOU", "RV"])
    .optional()
    .describe("VOU=normal voucher (default), RV=recurring voucher"),
  filename: z
    .string()
    .optional()
    .describe(
      "Internal sevdesk filename of a previously uploaded document, as returned by upload_voucher_file. Attaches that document to the voucher."
    ),
  positions: z.array(voucherPositionSchema).describe("The line items of the voucher. At least one is required."),
};

type VoucherBaseInput = {
  creditDebit: "C" | "D";
  taxRule?: "1" | "2" | "3" | "4" | "5" | "11";
  taxType?: string;
  voucherDate?: string;
  supplierId?: number;
  supplierName?: string;
  description?: string;
  payDate?: string;
  paymentDeadline?: string;
  deliveryDate?: string;
  currency?: string;
  costCentreId?: number;
  voucherType?: "VOU" | "RV";
  filename?: string;
  positions: VoucherPositionInput[];
};

export function buildSaveVoucherPayload(
  params: VoucherBaseInput & { status: "50" | "100"; voucherId?: number }
): SaveVoucherPayload {
  if (!params.taxRule && !params.taxType) {
    throw new Error(
      "Either taxRule (sevdesk-Update 2.0) or taxType (sevdesk-Update 1.0) is required. Call get_bookkeeping_system_version to find out which one your account uses."
    );
  }

  if (params.positions.length === 0) {
    throw new Error("At least one position is required to create a voucher.");
  }

  const payload: SaveVoucherPayload = {
    voucher: {
      ...(params.voucherId ? { id: params.voucherId } : {}),
      objectName: "Voucher",
      mapAll: true,
      status: Number(params.status) as 50 | 100,
      voucherType: params.voucherType ?? "VOU",
      creditDebit: params.creditDebit,
      ...(params.taxRule ? { taxRule: { id: params.taxRule, objectName: "TaxRule" as const } } : {}),
      ...(params.taxType ? { taxType: params.taxType } : {}),
      ...(params.voucherDate ? { voucherDate: params.voucherDate } : {}),
      ...(params.supplierId ? { supplier: { id: params.supplierId, objectName: "Contact" as const } } : {}),
      ...(params.supplierName ? { supplierName: params.supplierName } : {}),
      ...(params.description ? { description: params.description } : {}),
      ...(params.payDate ? { payDate: params.payDate } : {}),
      ...(params.paymentDeadline ? { paymentDeadline: params.paymentDeadline } : {}),
      ...(params.deliveryDate ? { deliveryDate: params.deliveryDate } : {}),
      ...(params.currency ? { currency: params.currency } : {}),
      ...(params.costCentreId
        ? { costCentre: { id: params.costCentreId, objectName: "CostCentre" as const } }
        : {}),
    },
    voucherPosSave: buildPositions(params.positions),
    // sevdesk requires voucherPosDelete and filename to be the last two attributes, in this order.
    voucherPosDelete: null,
  };

  if (params.filename) {
    payload.filename = params.filename;
  }

  return payload;
}

export const voucherTools = {
  list_vouchers: defineTool({
    title: "List vouchers",
    description: "List vouchers (receipts/expenses) from sevdesk. Returns one page; use nextOffset to continue.",
    access: "read",
    inputSchema: z.object({
      status: z.enum(["50", "100", "1000"]).optional().describe("Voucher status: 50=Draft, 100=Unpaid, 1000=Paid"),
      creditDebit: z.enum(["C", "D"]).optional().describe("C=Credit (income), D=Debit (expense)"),
      descriptionLike: z.string().optional().describe("Filter by description / voucher number (partial match)"),
      contactId: z.number().int().optional().describe("Only vouchers of this contact (supplier)"),
      startDate: z.string().optional().describe("Vouchers from this date on: YYYY-MM-DD, DD.MM.YYYY or Unix timestamp"),
      endDate: z.string().optional().describe("Vouchers up to and including this date"),
      ...paginationShape,
    }),
    handler: (client, params) =>
      fetchPage(params, async (limit, offset) =>
        unwrap(
          await client.GET("/Voucher", {
            params: {
              query: {
                status: params.status ? Number(params.status) : undefined,
                creditDebit: params.creditDebit,
                descriptionLike: params.descriptionLike,
                "contact[id]": params.contactId,
                "contact[objectName]": params.contactId ? "Contact" : undefined,
                startDate: params.startDate ? toUnixTimestamp(params.startDate) : undefined,
                endDate: params.endDate ? toUnixTimestamp(params.endDate, { endOfDay: true }) : undefined,
                limit,
                offset,
              } as never,
            },
          })
        )
      ),
  }),

  get_voucher: defineTool({
    title: "Get voucher",
    description: "Get a specific voucher by ID from sevdesk",
    access: "read",
    inputSchema: z.object({ voucherId: z.number().int().describe("The ID of the voucher to retrieve") }),
    handler: async (client, params) =>
      payload(unwrap(await client.GET("/Voucher/{voucherId}", { params: { path: { voucherId: params.voucherId } } }))),
  }),

  book_voucher: defineTool({
    title: "Book voucher payment",
    description:
      "Book a payment on a voucher (marks it as paid). Pass checkAccountTransactionId to link an existing bank transaction to the voucher (payment matching). Undo with reset_voucher_to_open.",
    access: "write",
    inputSchema: z.object({
      voucherId: z.number().int().describe("The ID of the voucher to book"),
      ...bookingShape,
    }),
    handler: async (client, { voucherId, ...booking }) =>
      payload(
        unwrap(
          await client.PUT("/Voucher/{voucherId}/bookAmount", {
            params: { path: { voucherId } },
            body: buildBookingBody(booking) as never,
          })
        )
      ),
  }),

  get_voucher_positions: defineTool({
    title: "Get voucher positions",
    description: "Get all positions (line items) of a voucher",
    access: "read",
    inputSchema: z.object({ voucherId: z.number().int().describe("The ID of the voucher"), ...paginationShape }),
    handler: ({ GET }, { voucherId, ...page }) =>
      fetchPage(page, async (limit, offset) =>
        unwrap(
          await GET("/VoucherPos", {
            params: {
              query: { "voucher[id]": voucherId, "voucher[objectName]": "Voucher", limit, offset } as never,
            },
          })
        )
      ),
  }),

  upload_voucher_file: defineTool({
    title: "Upload voucher document",
    description:
      "Upload a receipt document (PDF/image) to sevdesk. This does NOT create a voucher: it stores the file temporarily and returns an internal filename, which you then pass to create_voucher as 'filename' to attach the document.",
    access: "write",
    inputSchema: z.object({
      fileName: z.string().describe("Name of the file, e.g. receipt.pdf"),
      base64Content: z.string().describe("Base64 encoded file content (a data: URI prefix is accepted too)"),
      mimeType: z.string().optional().describe("MIME type of the file, e.g. application/pdf or image/jpeg"),
    }),
    handler: async (client, params) => {
      // Accept both a bare base64 string and a full data: URI
      const base64 = params.base64Content.replace(/^data:[^;]*;base64,/, "");
      const bytes = Buffer.from(base64, "base64");

      if (bytes.length === 0) {
        throw new Error("base64Content is empty or not valid base64.");
      }

      // This endpoint takes multipart/form-data, so the JSON Content-Type set on the
      // client has to be removed to let fetch generate the multipart boundary.
      const form = new FormData();
      form.append(
        "file",
        new Blob([new Uint8Array(bytes)], { type: params.mimeType ?? "application/octet-stream" }),
        params.fileName
      );

      return payload(
        unwrap(
          await client.POST("/Voucher/Factory/uploadTempFile", {
            // openapi-typescript models the non-standard "form-data" content entry of this
            // endpoint as an untyped body, so the FormData has to be passed through untyped.
            body: form as never,
            bodySerializer: (body: unknown) => body as FormData,
            headers: { "Content-Type": null },
          })
        )
      );
    },
  }),

  create_voucher: defineTool({
    title: "Create voucher",
    description:
      "Create a new voucher (Beleg) with its positions in sevdesk. Use upload_voucher_file first if you want to attach the receipt document. Look up the booking account for each position with get_receipt_guidance (scope expense or revenue).",
    access: "write",
    inputSchema: z.object({
      ...voucherBaseSchema,
      status: z
        .enum(["50", "100"])
        .optional()
        .describe("50=Draft, 100=Open/unpaid (default). Only these two are valid on creation."),
    }),
    handler: async (client, params) =>
      payload(
        unwrap(
          await client.POST("/Voucher/Factory/saveVoucher", {
            body: asGeneratedPayload(buildSaveVoucherPayload({ ...params, status: params.status ?? "100" })),
          })
        )
      ),
  }),

  update_voucher: defineTool({
    title: "Update voucher",
    description:
      "Update an existing voucher and replace its positions. sevdesk only allows updating vouchers in draft status (50) - call reset_voucher_to_draft first if the voucher is already open or paid.",
    access: "write",
    idempotent: true,
    inputSchema: z.object({
      voucherId: z.number().int().describe("The ID of the voucher to update"),
      ...voucherBaseSchema,
      status: z.enum(["50", "100"]).optional().describe("50=Draft (default), 100=Open/unpaid"),
    }),
    handler: async (client, params) =>
      payload(
        unwrap(
          await client.POST("/Voucher/Factory/saveVoucher", {
            body: asGeneratedPayload(buildSaveVoucherPayload({ ...params, status: params.status ?? "50" })),
          })
        )
      ),
  }),

  reset_voucher_to_draft: defineTool({
    title: "Reset voucher to draft",
    description: "Reset an open voucher back to draft status (50) so that it can be edited with update_voucher",
    access: "write",
    idempotent: true,
    inputSchema: z.object({ voucherId: z.number().int().describe("The ID of the voucher to reset") }),
    handler: async (client, params) =>
      payload(unwrap(await client.PUT("/Voucher/{voucherId}/resetToDraft", { params: { path: { voucherId: params.voucherId } } }))),
  }),

  reset_voucher_to_open: defineTool({
    title: "Reset voucher to open",
    description: "Reset a paid voucher back to open/unpaid status (100), undoing its booking",
    access: "write",
    idempotent: true,
    inputSchema: z.object({ voucherId: z.number().int().describe("The ID of the voucher to reset") }),
    handler: async (client, params) =>
      payload(unwrap(await client.PUT("/Voucher/{voucherId}/resetToOpen", { params: { path: { voucherId: params.voucherId } } }))),
  }),

  enshrine_voucher: defineTool({
    title: "Enshrine voucher",
    description:
      "Enshrine (festschreiben) a voucher. Enshrined vouchers can never be changed or reset again. Only possible once the voucher is open or paid. Cannot be undone.",
    access: "destructive",
    idempotent: true,
    inputSchema: z.object({ voucherId: z.number().int().describe("The ID of the voucher to enshrine") }),
    handler: async (client, params) =>
      unwrap(await client.PUT("/Voucher/{voucherId}/enshrine", { params: { path: { voucherId: params.voucherId } } })),
  }),
};
