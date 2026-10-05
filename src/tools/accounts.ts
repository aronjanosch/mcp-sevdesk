import { z } from "zod";
import { toUnixTimestamp } from "../lib/dates.js";
import { unwrap } from "../lib/errors.js";
import { objectsOf, payload } from "../lib/format.js";
import { fetchPage, paginationShape } from "../lib/pagination.js";
import { defineTool } from "../lib/tool.js";

const checkAccountRef = (id: number) => ({ id, objectName: "CheckAccount" as const });

export const accountTools = {
  list_check_accounts: defineTool({
    title: "List bank accounts",
    description: "List all check accounts (bank accounts) from sevdesk",
    access: "read",
    inputSchema: z.object({}),
    handler: async (client) => objectsOf(unwrap(await client.GET("/CheckAccount", {}))),
  }),

  get_check_account: defineTool({
    title: "Get bank account",
    description: "Get a specific check account by ID",
    access: "read",
    inputSchema: z.object({ checkAccountId: z.number().int().describe("The ID of the check account") }),
    handler: async (client, params) =>
      payload(unwrap(await client.GET("/CheckAccount/{checkAccountId}", { params: { path: { checkAccountId: params.checkAccountId } } }))),
  }),

  get_check_account_balance: defineTool({
    title: "Get bank account balance",
    description: "Get the balance of a check account at a given date (default: today)",
    access: "read",
    inputSchema: z.object({
      checkAccountId: z.number().int().describe("The ID of the check account"),
      date: z.string().optional().describe("Date for the balance as YYYY-MM-DD. Default: today"),
    }),
    handler: async (client, params) =>
      unwrap(
        await client.GET("/CheckAccount/{checkAccountId}/getBalanceAtDate", {
          params: {
            path: { checkAccountId: params.checkAccountId },
            query: { date: params.date ?? new Date().toISOString().split("T")[0] },
          },
        })
      ),
  }),

  list_transactions: defineTool({
    title: "List transactions",
    description: "List transactions of a check account. Returns one page; use nextOffset to continue.",
    access: "read",
    inputSchema: z.object({
      checkAccountId: z.number().int().describe("The ID of the check account"),
      startDate: z.string().optional().describe("Only transactions from this date on: YYYY-MM-DD, DD.MM.YYYY or Unix timestamp"),
      endDate: z.string().optional().describe("Only transactions up to and including this date"),
      paymtPurpose: z.string().optional().describe("Filter by payment purpose"),
      isBooked: z.boolean().optional().describe("Filter by booked status (false = still open for matching)"),
      ...paginationShape,
    }),
    handler: (client, params) =>
      fetchPage(params, async (limit, offset) =>
        unwrap(
          await client.GET("/CheckAccountTransaction", {
            params: {
              query: {
                "checkAccount[id]": params.checkAccountId,
                "checkAccount[objectName]": "CheckAccount",
                startDate: params.startDate ? toUnixTimestamp(params.startDate) : undefined,
                endDate: params.endDate ? toUnixTimestamp(params.endDate, { endOfDay: true }) : undefined,
                paymtPurpose: params.paymtPurpose,
                isBooked: params.isBooked,
                limit,
                offset,
              } as never,
            },
          })
        )
      ),
  }),

  get_transaction: defineTool({
    title: "Get transaction",
    description: "Get a specific transaction by ID",
    access: "read",
    inputSchema: z.object({ transactionId: z.number().int().describe("The ID of the transaction") }),
    handler: async (client, params) =>
      payload(
        unwrap(
          await client.GET("/CheckAccountTransaction/{checkAccountTransactionId}", {
            params: { path: { checkAccountTransactionId: params.transactionId } },
          })
        )
      ),
  }),

  create_transaction: defineTool({
    title: "Create transaction",
    description: "Create a new transaction in a check account",
    access: "write",
    inputSchema: z.object({
      checkAccountId: z.number().int().describe("The ID of the check account"),
      amount: z.number().describe("Transaction amount (positive for credit, negative for debit)"),
      valueDate: z.string().describe("Value date (ISO date string YYYY-MM-DD)"),
      entryDate: z.string().optional().describe("Entry date (ISO date string YYYY-MM-DD)"),
      paymtPurpose: z.string().optional().describe("Payment purpose/description"),
      payeePayerName: z.string().optional().describe("Name of payee or payer"),
      payeePayerAcctNo: z.string().optional().describe("Account number of payee/payer"),
      payeePayerBankCode: z.string().optional().describe("Bank code of payee/payer"),
    }),
    handler: async (client, { checkAccountId, ...fields }) =>
      payload(
        unwrap(await client.POST("/CheckAccountTransaction", { body: { ...fields, checkAccount: checkAccountRef(checkAccountId) } as never }))
      ),
  }),

  update_transaction: defineTool({
    title: "Update transaction",
    description: "Update an existing transaction. Only the given fields are changed. Enshrined transactions cannot be changed.",
    access: "write",
    idempotent: true,
    inputSchema: z.object({
      transactionId: z.number().int().describe("The ID of the transaction to update"),
      amount: z.number().optional().describe("Transaction amount (positive for credit, negative for debit)"),
      valueDate: z.string().optional().describe("Value date (YYYY-MM-DD)"),
      entryDate: z.string().optional().describe("Entry date (YYYY-MM-DD)"),
      paymtPurpose: z.string().optional().describe("Payment purpose/description"),
      payeePayerName: z.string().optional().describe("Name of payee or payer"),
      payeePayerAcctNo: z.string().optional().describe("Account number of payee/payer"),
      payeePayerBankCode: z.string().optional().describe("Bank code of payee/payer"),
    }),
    handler: async (client, { transactionId, ...fields }) =>
      payload(
        unwrap(
          await client.PUT("/CheckAccountTransaction/{checkAccountTransactionId}", {
            params: { path: { checkAccountTransactionId: transactionId } },
            body: fields as never,
          })
        )
      ),
  }),

  delete_transaction: defineTool({
    title: "Delete transaction",
    description: "Delete a transaction. Fails for booked or enshrined transactions. Cannot be undone.",
    access: "destructive",
    idempotent: true,
    inputSchema: z.object({ transactionId: z.number().int().describe("The ID of the transaction to delete") }),
    handler: async (client, params) => {
      unwrap(
        await client.DELETE("/CheckAccountTransaction/{checkAccountTransactionId}", {
          params: { path: { checkAccountTransactionId: params.transactionId } },
        })
      );
      return { success: true, deletedTransactionId: params.transactionId };
    },
  }),

  enshrine_transaction: defineTool({
    title: "Enshrine transaction",
    description: "Enshrine (festschreiben) a transaction. Enshrined transactions can never be changed again. Cannot be undone.",
    access: "destructive",
    idempotent: true,
    inputSchema: z.object({ transactionId: z.number().int().describe("The ID of the transaction to enshrine") }),
    handler: async (client, params) =>
      unwrap(
        await client.PUT("/CheckAccountTransaction/{checkAccountTransactionId}/enshrine", {
          params: { path: { checkAccountTransactionId: params.transactionId } },
        })
      ),
  }),
};
