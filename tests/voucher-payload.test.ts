import { describe, it, expect } from "vitest";
import { buildPositions, buildSaveVoucherPayload } from "../src/tools/vouchers.js";

const minimalPosition = {
  accountingTypeId: 27,
  taxRate: 19,
  sum: 119,
};

describe("buildPositions", () => {
  it("leitet den Nettobetrag aus einem Bruttobetrag ab", () => {
    const [position] = buildPositions([minimalPosition]);

    expect(position.sumGross).toBe(119);
    expect(position.sumNet).toBe(100);
    expect(position.net).toBe(false);
  });

  it("leitet den Bruttobetrag aus einem Nettobetrag ab", () => {
    const [position] = buildPositions([{ ...minimalPosition, net: true, sum: 100 }]);

    expect(position.sumNet).toBe(100);
    expect(position.sumGross).toBe(119);
    expect(position.net).toBe(true);
  });

  it("rundet abgeleitete Beträge auf zwei Nachkommastellen", () => {
    const [position] = buildPositions([{ ...minimalPosition, sum: 49.99 }]);

    expect(position.sumNet).toBe(42.01);
    expect(position.sumGross).toBe(49.99);
  });

  it("kommt mit einem Steuersatz von 0 zurecht", () => {
    const [position] = buildPositions([{ ...minimalPosition, taxRate: 0, sum: 50 }]);

    expect(position.sumNet).toBe(50);
    expect(position.sumGross).toBe(50);
  });

  it("setzt accountingType für sevdesk-Update 1.0", () => {
    const [position] = buildPositions([minimalPosition]);

    expect(position.accountingType).toEqual({ id: 27, objectName: "AccountingType" });
    expect(position.accountDatev).toBeUndefined();
  });

  it("setzt accountDatev für sevdesk-Update 2.0", () => {
    const [position] = buildPositions([
      { accountDatevId: 4711, taxRate: 19, sum: 119 },
    ]);

    expect(position.accountDatev).toEqual({ id: 4711, objectName: "AccountDatev" });
    expect(position.accountingType).toBeUndefined();
  });

  it("wirft einen Fehler, wenn kein Buchungskonto angegeben ist", () => {
    expect(() => buildPositions([{ taxRate: 19, sum: 119 }])).toThrow(/accountingTypeId or accountDatevId/);
  });
});

describe("buildSaveVoucherPayload", () => {
  const baseParams = {
    creditDebit: "D" as const,
    taxRule: "1" as const,
    status: "100" as const,
    positions: [minimalPosition],
  };

  it("baut einen vollständigen Beleg-Payload", () => {
    const payload = buildSaveVoucherPayload(baseParams);

    expect(payload.voucher).toMatchObject({
      objectName: "Voucher",
      mapAll: true,
      status: 100,
      voucherType: "VOU",
      creditDebit: "D",
      taxRule: { id: "1", objectName: "TaxRule" },
    });
    expect(payload.voucherPosSave).toHaveLength(1);
    expect(payload.voucherPosDelete).toBeNull();
  });

  it("wandelt den Status in eine Zahl um", () => {
    expect(buildSaveVoucherPayload({ ...baseParams, status: "50" }).voucher.status).toBe(50);
  });

  it("verlangt taxRule oder taxType", () => {
    expect(() =>
      buildSaveVoucherPayload({ ...baseParams, taxRule: undefined })
    ).toThrow(/taxRule .* or taxType/);
  });

  it("akzeptiert taxType als Alternative zu taxRule", () => {
    const payload = buildSaveVoucherPayload({
      ...baseParams,
      taxRule: undefined,
      taxType: "default",
    });

    expect(payload.voucher.taxType).toBe("default");
    expect(payload.voucher.taxRule).toBeUndefined();
  });

  it("verlangt mindestens eine Position", () => {
    expect(() => buildSaveVoucherPayload({ ...baseParams, positions: [] })).toThrow(
      /At least one position/
    );
  });

  it("verknüpft Lieferant und hochgeladene Datei", () => {
    const payload = buildSaveVoucherPayload({
      ...baseParams,
      supplierId: 42,
      filename: "f019bec36c65f5a0e7d2c63cc33f0681.pdf",
    });

    expect(payload.voucher.supplier).toEqual({ id: 42, objectName: "Contact" });
    expect(payload.filename).toBe("f019bec36c65f5a0e7d2c63cc33f0681.pdf");
  });

  it("hält die von sevdesk geforderte Reihenfolge der letzten beiden Attribute ein", () => {
    const payload = buildSaveVoucherPayload({ ...baseParams, filename: "abc.pdf" });
    const keys = Object.keys(payload);

    expect(keys.slice(-2)).toEqual(["voucherPosDelete", "filename"]);
  });

  it("lässt optionale Felder weg, statt sie auf undefined zu setzen", () => {
    const payload = buildSaveVoucherPayload(baseParams);

    expect(Object.keys(payload.voucher)).not.toContain("supplier");
    expect(Object.keys(payload)).not.toContain("filename");
  });

  it("setzt die ID beim Aktualisieren eines Belegs", () => {
    const payload = buildSaveVoucherPayload({ ...baseParams, voucherId: 99 });

    expect(payload.voucher.id).toBe(99);
  });
});
