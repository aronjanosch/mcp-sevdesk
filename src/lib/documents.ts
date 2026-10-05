import { z } from "zod";
import { toUnixTimestamp } from "./dates.js";

/** Date range + contact filter shared by the invoice, order and credit note lists. */
export const documentFilterShape = {
  startDate: z.string().optional().describe("Documents from this date on: YYYY-MM-DD, DD.MM.YYYY or Unix timestamp"),
  endDate: z.string().optional().describe("Documents up to and including this date"),
  contactId: z.number().int().optional().describe("Only documents of this contact"),
};

export function documentFilterQuery(params: { startDate?: string; endDate?: string; contactId?: number }) {
  return {
    startDate: params.startDate ? toUnixTimestamp(params.startDate) : undefined,
    endDate: params.endDate ? toUnixTimestamp(params.endDate, { endOfDay: true }) : undefined,
    "contact[id]": params.contactId,
    "contact[objectName]": params.contactId ? "Contact" : undefined,
  };
}
