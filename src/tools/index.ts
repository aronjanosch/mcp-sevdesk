import type { ToolMap } from "../lib/tool.js";
import { accountTools } from "./accounts.js";
import { contactTools } from "./contacts.js";
import { creditNoteTools } from "./credit-notes.js";
import { invoiceTools } from "./invoices.js";
import { orderTools } from "./orders.js";
import { partTools } from "./parts.js";
import { receiptGuidanceTools } from "./receipt-guidance.js";
import { tagTools } from "./tags.js";
import { voucherTools } from "./vouchers.js";

export {
  accountTools,
  contactTools,
  creditNoteTools,
  invoiceTools,
  orderTools,
  partTools,
  receiptGuidanceTools,
  tagTools,
  voucherTools,
};

export const allTools: ToolMap = {
  ...contactTools,
  ...invoiceTools,
  ...orderTools,
  ...creditNoteTools,
  ...voucherTools,
  ...receiptGuidanceTools,
  ...accountTools,
  ...partTools,
  ...tagTools,
};
