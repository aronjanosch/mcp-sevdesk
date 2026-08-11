import { describe, it, expect } from "vitest";
import { z } from "zod";
import { zodToJsonSchema } from "../src/json-schema.js";
import { voucherTools } from "../src/tools/vouchers.js";

describe("zodToJsonSchema", () => {
  it("konvertiert Primitive samt Beschreibung", () => {
    const schema = zodToJsonSchema(
      z.object({
        name: z.string().describe("Ein Name"),
        count: z.number(),
        active: z.boolean(),
        kind: z.enum(["a", "b"]),
      })
    ) as any;

    expect(schema.properties.name).toEqual({ type: "string", description: "Ein Name" });
    expect(schema.properties.count.type).toBe("number");
    expect(schema.properties.active.type).toBe("boolean");
    expect(schema.properties.kind).toEqual({ type: "string", enum: ["a", "b"] });
  });

  it("markiert nur nicht-optionale Felder als required", () => {
    const schema = zodToJsonSchema(
      z.object({ required: z.string(), optional: z.string().optional() })
    ) as any;

    expect(schema.required).toEqual(["required"]);
  });

  it("übernimmt die Beschreibung von optionalen Feldern", () => {
    const schema = zodToJsonSchema(
      z.object({ note: z.string().optional().describe("Eine Notiz") })
    ) as any;

    expect(schema.properties.note.description).toBe("Eine Notiz");
  });

  it("konvertiert verschachtelte Objekte", () => {
    const schema = zodToJsonSchema(
      z.object({ nested: z.object({ inner: z.string() }) })
    ) as any;

    expect(schema.properties.nested).toEqual({
      type: "object",
      properties: { inner: { type: "string" } },
      required: ["inner"],
    });
  });

  it("konvertiert Arrays von Objekten statt sie als String auszugeben", () => {
    const schema = zodToJsonSchema(
      z.object({
        items: z.array(z.object({ id: z.number(), label: z.string().optional() })),
      })
    ) as any;

    expect(schema.properties.items.type).toBe("array");
    expect(schema.properties.items.items).toEqual({
      type: "object",
      properties: { id: { type: "number" }, label: { type: "string" } },
      required: ["id"],
    });
  });

  it("übernimmt Defaults", () => {
    const schema = zodToJsonSchema(z.object({ mode: z.string().default("x") })) as any;

    expect(schema.properties.mode.default).toBe("x");
    expect(schema.required).toBeUndefined();
  });
});

describe("create_voucher inputSchema", () => {
  it("beschreibt die Positionen als Array von Objekten", () => {
    const schema = zodToJsonSchema(voucherTools.create_voucher.inputSchema) as any;
    const positions = schema.properties.positions;

    expect(positions.type).toBe("array");
    expect(positions.items.type).toBe("object");
    expect(positions.items.properties.taxRate.type).toBe("number");
    expect(positions.items.required).toEqual(expect.arrayContaining(["taxRate", "sum"]));
  });

  it("verlangt creditDebit und positions", () => {
    const schema = zodToJsonSchema(voucherTools.create_voucher.inputSchema) as any;

    expect(schema.required).toEqual(expect.arrayContaining(["creditDebit", "positions"]));
    expect(schema.required).not.toContain("taxRule");
  });
});
