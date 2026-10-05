import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";
import { allTools } from "../src/tools/index.js";
import { json, mockClient, type RecordedRequest } from "./helpers.js";

async function connect(responder: (req: RecordedRequest, i: number) => Response | Promise<Response>, readOnly = false) {
  const { client: api, requests } = mockClient(responder);
  const server = createServer(api, allTools, { version: "0.0.0-test", readOnly });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return { client, requests };
}

const textOf = (result: any) => result.content[0].text as string;

describe("Tool-Katalog", () => {
  it("jedes Tool hat Titel, Beschreibung und gültigen Zugriffstyp", () => {
    for (const [name, tool] of Object.entries(allTools)) {
      expect(tool.title, name).toBeTruthy();
      expect(tool.description.length, name).toBeGreaterThan(15);
      expect(["read", "write", "destructive"], name).toContain(tool.access);
    }
  });

  it("löschende, festschreibende, stornierende und versendende Tools sind destructive", () => {
    for (const [name, tool] of Object.entries(allTools)) {
      if (/^(delete|enshrine|cancel|send)_/.test(name)) expect(tool.access, name).toBe("destructive");
    }
  });

  it("lesende Tools heißen list_/get_", () => {
    for (const [name, tool] of Object.entries(allTools)) {
      if (tool.access === "read") expect(name, name).toMatch(/^(list|get)_/);
    }
  });
});

describe("MCP-Server", () => {
  it("meldet Annotations an die Clients", async () => {
    const { client } = await connect(() => json({}));
    const { tools } = await client.listTools();
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));

    expect(tools).toHaveLength(Object.keys(allTools).length);
    expect(byName.list_contacts.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    expect(byName.create_contact.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false });
    expect(byName.delete_contact.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true, idempotentHint: true });
    expect(byName.list_contacts.title).toBe("List contacts");
  });

  it("exponiert im Read-only-Modus nur lesende Tools", async () => {
    const { client } = await connect(() => json({}), true);
    const { tools } = await client.listTools();

    expect(tools.length).toBeGreaterThan(10);
    expect(tools.every((t) => t.annotations?.readOnlyHint === true)).toBe(true);
    expect(tools.map((t) => t.name)).not.toContain("create_invoice");
    expect(tools.map((t) => t.name)).not.toContain("delete_contact");
  });

  it("lehnt im Read-only-Modus den Aufruf eines Schreib-Tools ab und ruft die API nicht auf", async () => {
    const { client, requests } = await connect(() => json({}), true);

    const result: any = await client.callTool({ name: "delete_contact", arguments: { contactId: 1 } }).catch((e) => e);

    expect(result instanceof Error || result.isError).toBe(true);
    expect(requests).toHaveLength(0);
  });

  it("liefert kompaktes JSON ohne Nullwerte", async () => {
    const { client } = await connect(() => json({ objects: [{ id: "7", name: "Muster GmbH", description: null, sevClient: { id: "1" } }] }));

    const result = await client.callTool({ name: "get_contact", arguments: { contactId: 7 } });

    expect(textOf(result)).toBe('{"id":"7","name":"Muster GmbH"}');
  });

  it("gibt API-Fehler als isError mit lesbarer Meldung zurück", async () => {
    const { client } = await connect(() => json({ error: { message: "Contact not found" } }, 404));

    const result: any = await client.callTool({ name: "get_contact", arguments: { contactId: 1 } });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("HTTP 404");
    expect(textOf(result)).toContain("Contact not found");
  });

  it("meldet ungültige Parameter, ohne die API zu rufen", async () => {
    const { client, requests } = await connect(() => json({}));

    const result: any = await client.callTool({ name: "list_contacts", arguments: { limit: 100000 } }).catch((e) => e);

    expect(result instanceof Error || result.isError).toBe(true);
    expect(requests).toHaveLength(0);
  });
});

describe("Tools gegen simulierte API", () => {
  it("list_contacts paginiert mit Standard-Limit 50 und fragt eins mehr an", async () => {
    const { client, requests } = await connect(() => json({ objects: [{ id: "1" }, { id: "2" }] }));

    const result = await client.callTool({ name: "list_contacts", arguments: { name: "Muster" } });

    expect(requests[0].url.searchParams.get("limit")).toBe("51");
    expect(requests[0].url.searchParams.get("offset")).toBe("0");
    expect(requests[0].url.searchParams.get("name")).toBe("Muster");
    expect(JSON.parse(textOf(result))).toMatchObject({ count: 2, hasMore: false, limit: 50 });
  });

  it("list_invoices übersetzt Datumsangaben in Unix-Timestamps (Ende inklusive)", async () => {
    const { client, requests } = await connect(() => json({ objects: [] }));

    await client.callTool({ name: "list_invoices", arguments: { startDate: "2024-01-01", endDate: "2024-01-31", status: "1000" } });

    const query = requests[0].url.searchParams;
    expect(query.get("startDate")).toBe("1704063600");
    expect(query.get("endDate")).toBe("1706741999");
    expect(query.get("status")).toBe("1000");
  });

  it("book_invoice baut den Body korrekt und verknüpft die Transaktion", async () => {
    const { client, requests } = await connect(() => json({ objects: { id: "5" } }));

    await client.callTool({
      name: "book_invoice",
      arguments: { invoiceId: 5, amount: 119, date: "2024-03-05", checkAccountId: 10, checkAccountTransactionId: 99 },
    });

    expect(requests[0].method).toBe("PUT");
    expect(requests[0].url.pathname).toBe("/api/v1/Invoice/5/bookAmount");
    expect(requests[0].body).toEqual({
      amount: 119,
      date: 1709593200,
      type: "FULL_PAYMENT",
      checkAccount: { id: 10, objectName: "CheckAccount" },
      checkAccountTransaction: { id: 99, objectName: "CheckAccountTransaction" },
    });
  });

  it("create_invoice sendet das saveInvoice-Modell mit Entwurfsstatus und fester Attribut-Reihenfolge", async () => {
    const { client, requests } = await connect(() => json({ objects: { invoice: { id: "1" } } }, 201));

    await client.callTool({
      name: "create_invoice",
      arguments: {
        contactId: 3,
        contactPersonId: 4,
        invoiceDate: "2024-03-05",
        positions: [{ name: "Beratung", quantity: 2, price: 100, taxRate: 19 }],
      },
    });

    const body = requests[0].body;
    expect(requests[0].url.pathname).toBe("/api/v1/Invoice/Factory/saveInvoice");
    expect(body.invoice).toMatchObject({
      objectName: "Invoice",
      mapAll: true,
      status: 100,
      invoiceDate: "05.03.2024",
      deliveryDate: "05.03.2024",
      taxRule: { id: "1", objectName: "TaxRule" },
      contact: { id: 3, objectName: "Contact" },
      contactPerson: { id: 4, objectName: "SevUser" },
      currency: "EUR",
      invoiceType: "RE",
    });
    expect(body.invoicePosSave[0]).toMatchObject({ name: "Beratung", quantity: 2, price: 100, taxRate: 19, unity: { id: 1, objectName: "Unity" } });
    expect(Object.keys(body).slice(-4)).toEqual(["invoicePosDelete", "discountSave", "discountDelete", "takeDefaultAddress"]);
  });

  it("get_invoice_pdf markiert die Rechnung standardmäßig NICHT als versendet", async () => {
    const { client, requests } = await connect(() => json({ objects: { filename: "x.pdf", content: "UERG", base64Encoded: true } }));

    await client.callTool({ name: "get_invoice_pdf", arguments: { invoiceId: 5 } });

    expect(requests[0].url.searchParams.get("preventSendBy")).toBe("true");
  });

  it("get_invoice_pdf speichert mit outputPath auf Platte und gibt nur den Pfad zurück", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mcp-sevdesk-"));
    const target = join(dir, "sub", "r.pdf");
    const { client } = await connect(() =>
      json({ objects: { filename: "r.pdf", mimetype: "application/pdf", content: Buffer.from("%PDF-test").toString("base64"), base64Encoded: true } })
    );

    const result = await client.callTool({ name: "get_invoice_pdf", arguments: { invoiceId: 5, outputPath: target } });

    expect(JSON.parse(textOf(result))).toMatchObject({ savedTo: target, bytes: 9 });
    expect((await readFile(target)).toString()).toBe("%PDF-test");
  });

  it("get_receipt_guidance verlangt den passenden Zusatzparameter und filtert mit search", async () => {
    const { client } = await connect(() =>
      json({ objects: [{ id: 1, name: "Software Lizenzen" }, { id: 2, name: "Bürobedarf" }] })
    );

    const missing: any = await client.callTool({ name: "get_receipt_guidance", arguments: { scope: "account_number" } });
    expect(missing.isError).toBe(true);

    const result = await client.callTool({ name: "get_receipt_guidance", arguments: { scope: "expense", search: "software" } });
    expect(JSON.parse(textOf(result))).toEqual({ count: 1, objects: [{ id: 1, name: "Software Lizenzen" }] });
  });

  it("list_invoice_positions_for_timeframe aggregiert und meldet fehlgeschlagene Rechnungen", async () => {
    const { client } = await connect((req) => {
      if (req.url.pathname.endsWith("/Invoice")) return json({ objects: [{ id: "1" }, { id: "2" }] });
      if (req.url.pathname.includes("/Invoice/1/")) {
        return json({ objects: [{ name: "Beratung", quantity: "2", sumNetAccounting: "200", sumGrossAccounting: "238" }] });
      }
      return json({ error: { message: "boom" } }, 400);
    });

    const result = await client.callTool({
      name: "list_invoice_positions_for_timeframe",
      arguments: { startDate: "2024-01-01", endDate: "2024-12-31" },
    });

    const data = JSON.parse(textOf(result));
    expect(data.summary).toEqual([
      { productName: "Beratung", totalQuantity: 2, totalNetRevenue: 200, totalGrossRevenue: 238, positionCount: 1 },
    ]);
    expect(data.failedInvoiceIds).toEqual([2]);
    expect(data).not.toHaveProperty("positions");
  });
});
