import { z } from "zod";
import { unwrap } from "../lib/errors.js";
import { objectsOf, payload } from "../lib/format.js";
import { defineTool } from "../lib/tool.js";

/**
 * Receipt guidance tells you which booking accounts (Buchungskonten) may be combined
 * with which tax rules. Creating a voucher position requires such an account id, so
 * these lookups are the entry point for create_voucher.
 */
export const receiptGuidanceTools = {
  get_receipt_guidance: defineTool({
    title: "Look up booking accounts",
    description:
      "Look up booking accounts (Buchungskonten) with their allowed tax rules and rates. Use the returned accountingType/accountDatev id in create_voucher positions. " +
      "scope=expense: accounts for expense vouchers (creditDebit=D); scope=revenue: accounts for revenue vouchers (creditDebit=C); scope=all: every account (large, prefer expense/revenue); " +
      "scope=account_number: guidance for one DATEV account number (needs accountNumber); scope=tax_rule: accounts usable with one tax rule (needs taxRule). " +
      "Use 'search' to narrow big results down, e.g. search=Software.",
    access: "read",
    inputSchema: z.object({
      scope: z.enum(["expense", "revenue", "all", "account_number", "tax_rule"]).describe("Which accounts to list"),
      accountNumber: z.number().int().optional().describe("DATEV account number, e.g. 6815. Required for scope=account_number."),
      taxRule: z.string().optional().describe("Tax rule code, e.g. USTPFL_UMS_EINN. Required for scope=tax_rule."),
      search: z.string().optional().describe("Case-insensitive text filter applied to the returned accounts (name, number, ...)"),
    }),
    handler: async (client, params) => {
      let data: unknown;

      switch (params.scope) {
        case "expense":
          data = unwrap(await client.GET("/ReceiptGuidance/forExpense", {}));
          break;
        case "revenue":
          data = unwrap(await client.GET("/ReceiptGuidance/forRevenue", {}));
          break;
        case "all":
          data = unwrap(await client.GET("/ReceiptGuidance/forAllAccounts", {}));
          break;
        case "account_number":
          if (params.accountNumber === undefined) throw new Error("accountNumber is required for scope=account_number.");
          data = unwrap(
            await client.GET("/ReceiptGuidance/forAccountNumber", { params: { query: { accountNumber: params.accountNumber } } })
          );
          break;
        case "tax_rule":
          if (!params.taxRule) throw new Error("taxRule is required for scope=tax_rule.");
          data = unwrap(await client.GET("/ReceiptGuidance/forTaxRule", { params: { query: { taxRule: params.taxRule } } }));
          break;
      }

      if (!params.search) return payload(data);

      const needle = params.search.toLowerCase();
      const matches = objectsOf(data).filter((entry) => JSON.stringify(entry).toLowerCase().includes(needle));
      return { count: matches.length, objects: matches };
    },
  }),

  get_bookkeeping_system_version: defineTool({
    title: "Get bookkeeping system version",
    description:
      "Get the bookkeeping system version of the sevdesk account. Version 1.0 uses taxType and accountingType, version 2.0 uses taxRule and accountDatev. Call this when you are unsure which fields create_voucher should be given.",
    access: "read",
    inputSchema: z.object({}),
    handler: async (client) => unwrap(await client.GET("/Tools/bookkeepingSystemVersion", {})),
  }),
};
