/**
 * Integrationstest gegen eine ECHTE sevdesk-Instanz - nur für einen TESTMANDANTEN.
 *
 *   SEVDESK_TEST_TOKEN=...  npm run test:integration            (nur lesend)
 *   SEVDESK_TEST_TOKEN=... SEVDESK_TEST_ALLOW_WRITE=1 SEVDESK_TEST_CONTACT_PERSON_ID=123 \
 *     npm run test:integration                                  (inkl. Schreibzyklus)
 *
 * Die Tests prüfen nur die Struktur der Antworten und geben nie Inhalte aus, damit auch
 * bei einem Fehlschlag keine Mandantendaten im Log landen. Der Schreibzyklus legt einen
 * Kontakt und einen Rechnungsentwurf an (Entwürfe lassen sich per API nicht löschen).
 */
import { describe, expect, it } from "vitest";
import { createSevdeskClient } from "../../src/client.js";
import { connectServer } from "../helpers-server.js";

const token = process.env.SEVDESK_TEST_TOKEN;
const allowWrite = process.env.SEVDESK_TEST_ALLOW_WRITE === "1";
const contactPersonId = Number(process.env.SEVDESK_TEST_CONTACT_PERSON_ID);

async function call(client: Awaited<ReturnType<typeof connectServer>>, name: string, args: Record<string, unknown> = {}) {
  const result: any = await client.callTool({ name, arguments: args });
  const text: string = result.content[0].text;
  // Bei Fehlern nur den Tool-Namen melden, nicht den (ggf. sensiblen) Inhalt
  if (result.isError) throw new Error(`Tool ${name} failed (${text.slice(0, 60).replace(/[^\x20-\x7E]/g, "?").split(":")[0]})`);
  return JSON.parse(text);
}

describe.skipIf(!token)("Integration (lesend)", async () => {
  const client = await connectServer(createSevdeskClient(token!), true);

  it("Read-only-Modus exponiert keine Schreib-Tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.every((tool) => tool.annotations?.readOnlyHint === true)).toBe(true);
  });

  it("list_check_accounts liefert eine Liste", async () => {
    expect(Array.isArray(await call(client, "list_check_accounts"))).toBe(true);
  });

  it("list_contacts paginiert", async () => {
    const page = await call(client, "list_contacts", { limit: 2 });
    expect(Array.isArray(page.objects)).toBe(true);
    expect(page.objects.length <= 2).toBe(true);
    expect(typeof page.hasMore).toBe("boolean");
  });

  it("list_invoices akzeptiert ISO-Datumsangaben", async () => {
    const page = await call(client, "list_invoices", { limit: 1, startDate: "2020-01-01", endDate: "2030-12-31" });
    expect(Array.isArray(page.objects)).toBe(true);
  });

  it("list_vouchers und list_orders und list_credit_notes antworten", async () => {
    for (const name of ["list_vouchers", "list_orders", "list_credit_notes"]) {
      expect(Array.isArray((await call(client, name, { limit: 1 })).objects), name).toBe(true);
    }
  });

  it("get_bookkeeping_system_version und get_receipt_guidance antworten", async () => {
    expect(await call(client, "get_bookkeeping_system_version")).toBeDefined();
    const guidance = await call(client, "get_receipt_guidance", { scope: "expense" });
    expect(guidance).toBeDefined();
  });

  it("get_next_customer_number antwortet", async () => {
    expect(await call(client, "get_next_customer_number")).toBeDefined();
  });

  it("list_invoice_positions_for_timeframe aggregiert", async () => {
    const result = await call(client, "list_invoice_positions_for_timeframe", { startDate: "2024-01-01", endDate: "2024-01-31" });
    expect(Array.isArray(result.summary)).toBe(true);
  });
});

describe.skipIf(!token || !allowWrite || !contactPersonId)("Integration (Schreibzyklus, nur Testmandant)", async () => {
  const client = await connectServer(createSevdeskClient(token!));
  const stamp = Date.now();

  it("Kontakt anlegen, ändern, Rechnungsentwurf anlegen und ändern", async () => {
    const contact = await call(client, "create_contact", { name: `mcp-sevdesk-test ${stamp}`, categoryId: 3 });
    const contactId = Number(contact.id);
    expect(Number.isInteger(contactId) && contactId > 0).toBe(true);

    try {
      await call(client, "update_contact", { contactId, description: "mcp-sevdesk integration test" });

      const created = await call(client, "create_invoice", {
        contactId,
        contactPersonId,
        header: `mcp-sevdesk-test ${stamp}`,
        positions: [{ name: "Testposition", quantity: 1, price: 10, taxRate: 19 }],
      });
      const invoiceId = Number(created.invoice?.id ?? created.id);
      expect(Number.isInteger(invoiceId) && invoiceId > 0).toBe(true);

      await call(client, "update_invoice", {
        invoiceId,
        header: `mcp-sevdesk-test ${stamp} (geändert)`,
        positions: [{ name: "Zweite Testposition", quantity: 2, price: 5, taxRate: 19 }],
      });

      const positions = await call(client, "get_invoice_positions", { invoiceId });
      expect(positions.count).toBe(2);

      const invoice = await call(client, "get_invoice", { invoiceId });
      expect(String(invoice.header).endsWith("(geändert)")).toBe(true);
      expect(String(invoice.status)).toBe("100");
    } finally {
      // Schlägt fehl, solange der Entwurf den Kontakt referenziert - das ist erwartet
      await client.callTool({ name: "delete_contact", arguments: { contactId } }).catch(() => undefined);
    }
  });
});
