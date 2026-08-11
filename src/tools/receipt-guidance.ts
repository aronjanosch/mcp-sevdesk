import { z } from "zod";
import type { SevdeskClient } from "../client.js";

/**
 * Receipt guidance tells you which booking accounts (Buchungskonten) may be combined
 * with which tax rules. Creating a voucher position requires such an account id, so
 * these lookups are the entry point for create_voucher.
 */
export const receiptGuidanceTools = {
  get_receipt_guidance_for_expense: {
    description:
      "List all booking accounts (Buchungskonten) that can be used for expense vouchers (creditDebit=D), including the allowed tax rules and rates. Use the returned accountingType/accountDatev id in create_voucher positions.",
    inputSchema: z.object({}),
    handler: async (client: SevdeskClient) => {
      const { data, error } = await client.GET("/ReceiptGuidance/forExpense", {});
      if (error) throw new Error(JSON.stringify(error));
      return data;
    },
  },

  get_receipt_guidance_for_revenue: {
    description:
      "List all booking accounts (Buchungskonten) that can be used for revenue vouchers (creditDebit=C), including the allowed tax rules and rates. Use the returned accountingType/accountDatev id in create_voucher positions.",
    inputSchema: z.object({}),
    handler: async (client: SevdeskClient) => {
      const { data, error } = await client.GET("/ReceiptGuidance/forRevenue", {});
      if (error) throw new Error(JSON.stringify(error));
      return data;
    },
  },

  list_receipt_guidance_accounts: {
    description:
      "List the guidance for all booking accounts (Buchungskonten) available for vouchers. Prefer get_receipt_guidance_for_expense or get_receipt_guidance_for_revenue, which return a much smaller, more relevant result.",
    inputSchema: z.object({}),
    handler: async (client: SevdeskClient) => {
      const { data, error } = await client.GET("/ReceiptGuidance/forAllAccounts", {});
      if (error) throw new Error(JSON.stringify(error));
      return data;
    },
  },

  get_receipt_guidance_by_account_number: {
    description: "Get booking guidance for a specific DATEV account number (Sachkonto)",
    inputSchema: z.object({
      accountNumber: z.number().describe("The DATEV account number, e.g. 6815"),
    }),
    handler: async (client: SevdeskClient, params: { accountNumber: number }) => {
      const { data, error } = await client.GET("/ReceiptGuidance/forAccountNumber", {
        params: { query: { accountNumber: params.accountNumber } },
      });
      if (error) throw new Error(JSON.stringify(error));
      return data;
    },
  },

  get_receipt_guidance_by_tax_rule: {
    description:
      "Get all booking accounts that can be used with a specific tax rule, e.g. USTPFL_UMS_EINN",
    inputSchema: z.object({
      taxRule: z.string().describe("The code of the tax rule, e.g. USTPFL_UMS_EINN"),
    }),
    handler: async (client: SevdeskClient, params: { taxRule: string }) => {
      const { data, error } = await client.GET("/ReceiptGuidance/forTaxRule", {
        params: { query: { taxRule: params.taxRule } },
      });
      if (error) throw new Error(JSON.stringify(error));
      return data;
    },
  },

  get_bookkeeping_system_version: {
    description:
      "Get the bookkeeping system version of the sevdesk account. Version 1.0 uses taxType and accountingType, version 2.0 uses taxRule and accountDatev. Call this when you are unsure which fields create_voucher should be given.",
    inputSchema: z.object({}),
    handler: async (client: SevdeskClient) => {
      const { data, error } = await client.GET("/Tools/bookkeepingSystemVersion", {});
      if (error) throw new Error(JSON.stringify(error));
      return data;
    },
  },
};
