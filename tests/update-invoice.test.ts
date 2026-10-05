import { describe, expect, it } from "vitest";
import { buildUpdateInvoicePayload } from "../src/tools/invoices.js";
import { createClientPair } from "./helpers-server.js";
import { json } from "./helpers.js";

// Erfundene Beispieldaten im Format, wie sevdesk sie liefert (Zahlen als Strings)
const existing = {
  id: "1",
  status: "100",
  invoiceNumber: "RE-TEST-1",
  invoiceDate: "2024-03-05T00:00:00+01:00",
  deliveryDate: "2024-03-01T00:00:00+01:00",
  contact: { id: "3", objectName: "Contact" },
  contactPerson: { id: "4", objectName: "SevUser" },
  discount: "0",
  taxRate: "19",
  taxRule: { id: "1", objectName: "TaxRule" },
  taxText: "Umsatzsteuer 19%",
  invoiceType: "RE",
  currency: "EUR",
  addressCountry: { id: "1", objectName: "StaticCountry" },
  address: "Musterfirma\nMusterstraße 1",
  header: "Rechnung RE-TEST-1",
  showNet: "1",
  timeToPay: "14",
};

describe("buildUpdateInvoicePayload", () => {
  it("behält alle bestehenden Felder, wenn nichts überschrieben wird", () => {
    const payload = buildUpdateInvoicePayload(existing, { invoiceId: 1 });

    expect(payload.invoice).toMatchObject({
      id: 1,
      objectName: "Invoice",
      mapAll: true,
      status: 100,
      invoiceNumber: "RE-TEST-1",
      invoiceDate: "05.03.2024",
      deliveryDate: "01.03.2024",
      contact: { id: 3, objectName: "Contact" },
      contactPerson: { id: 4, objectName: "SevUser" },
      taxRule: { id: "1", objectName: "TaxRule" },
      taxText: "Umsatzsteuer 19%",
      currency: "EUR",
      address: "Musterfirma\nMusterstraße 1",
      header: "Rechnung RE-TEST-1",
      showNet: true,
      timeToPay: 14,
    });
    expect(payload.takeDefaultAddress).toBe(false);
    expect(payload.invoicePosSave).toEqual([]);
  });

  it("überschreibt nur die übergebenen Felder", () => {
    const payload = buildUpdateInvoicePayload(existing, { invoiceId: 1, header: "Neu", status: "200", invoiceDate: "2024-04-01" });

    expect(payload.invoice).toMatchObject({ header: "Neu", status: 200, invoiceDate: "01.04.2024", currency: "EUR" });
  });

  it("übernimmt bei Kontaktwechsel die Adresse des neuen Kontakts", () => {
    const payload = buildUpdateInvoicePayload(existing, { invoiceId: 1, contactId: 9 });

    expect(payload.invoice.contact.id).toBe(9);
    expect(payload.invoice).not.toHaveProperty("address");
    expect(payload.takeDefaultAddress).toBe(true);
  });

  it("verweigert Rechnungen, die keine Entwürfe sind", () => {
    expect(() => buildUpdateInvoicePayload({ ...existing, status: "200" }, { invoiceId: 1 })).toThrow(/only drafts/);
  });

  it("unterscheidet vorhandene (id) und neue Positionen und hält die Attribut-Reihenfolge ein", () => {
    const payload = buildUpdateInvoicePayload(existing, {
      invoiceId: 1,
      positions: [
        { id: 77, name: "Geändert", quantity: 1, price: 50, taxRate: 19, unityId: 1 },
        { name: "Neu", quantity: 2, price: 10, taxRate: 19, unityId: 1 },
      ],
    });

    expect(payload.invoicePosSave[0]).toMatchObject({ id: 77, invoice: { id: 1, objectName: "Invoice" } });
    expect(payload.invoicePosSave[1]).not.toHaveProperty("id");
    expect(Object.keys(payload).slice(-4)).toEqual(["invoicePosDelete", "discountSave", "discountDelete", "takeDefaultAddress"]);
  });
});

describe("update_invoice (Server)", () => {
  it("liest die Rechnung und speichert sie danach per saveInvoice", async () => {
    const { client, requests } = await createClientPair((req) =>
      req.method === "GET" ? json({ objects: [existing] }) : json({ objects: { invoice: { id: "1" } } }, 201)
    );

    await client.callTool({ name: "update_invoice", arguments: { invoiceId: 1, header: "Neu" } });

    expect(requests.map((r) => `${r.method} ${r.url.pathname}`)).toEqual([
      "GET /api/v1/Invoice/1",
      "POST /api/v1/Invoice/Factory/saveInvoice",
    ]);
    expect(requests[1].body.invoice).toMatchObject({ id: 1, header: "Neu" });
  });

  it("speichert nichts, wenn die Rechnung kein Entwurf ist", async () => {
    const { client, requests } = await createClientPair(() => json({ objects: [{ ...existing, status: "1000" }] }));

    const result: any = await client.callTool({ name: "update_invoice", arguments: { invoiceId: 1, header: "Neu" } });

    expect(result.isError).toBe(true);
    expect(requests).toHaveLength(1);
  });
});
