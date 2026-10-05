import { z } from "zod";
import { toUnixTimestamp } from "./dates.js";

/** Shared input of the book_* tools (invoice, voucher, credit note). */
export const bookingShape = {
  amount: z.number().describe("Amount to book. Can be a partial amount."),
  date: z.string().describe("Booking date: YYYY-MM-DD, DD.MM.YYYY or Unix timestamp"),
  type: z
    .enum(["FULL_PAYMENT", "N", "CB", "CF", "O", "OF", "MTC"])
    .default("FULL_PAYMENT")
    .describe(
      "Booking type: FULL_PAYMENT=normal booking (default), N=partial booking, CB=reduced amount due to discount (Skonto), CF=currency fluctuation (deprecated), O=reduced/higher amount for other reasons, OF=higher amount due to reminder charges, MTC=reduced amount due to monetary traffic costs"
    ),
  checkAccountId: z.number().int().describe("ID of the check account the payment was made on (list_check_accounts)"),
  checkAccountTransactionId: z
    .number()
    .int()
    .optional()
    .describe("ID of an existing bank transaction to link to this booking (list_transactions)"),
  createFeed: z.boolean().optional().describe("Create a feed entry"),
};

export interface BookingInput {
  amount: number;
  date: string;
  type: "FULL_PAYMENT" | "N" | "CB" | "CF" | "O" | "OF" | "MTC";
  checkAccountId: number;
  checkAccountTransactionId?: number;
  createFeed?: boolean;
}

export function buildBookingBody(params: BookingInput) {
  return {
    amount: params.amount,
    date: toUnixTimestamp(params.date),
    type: params.type,
    checkAccount: { id: params.checkAccountId, objectName: "CheckAccount" as const },
    ...(params.checkAccountTransactionId
      ? { checkAccountTransaction: { id: params.checkAccountTransactionId, objectName: "CheckAccountTransaction" as const } }
      : {}),
    ...(params.createFeed !== undefined ? { createFeed: params.createFeed } : {}),
  };
}
