import { describe, expect, it } from "vitest";
import { toGermanDate, toUnixTimestamp } from "../src/lib/dates.js";
import { SevdeskApiError, unwrap } from "../src/lib/errors.js";
import { compact, objectsOf, payload, toText } from "../src/lib/format.js";
import { fetchPage } from "../src/lib/pagination.js";
import { defineTool, filterTools, isReadOnlyMode } from "../src/lib/tool.js";
import { z } from "zod";

describe("toUnixTimestamp", () => {
  it("nimmt Unix-Timestamps unverändert", () => {
    expect(toUnixTimestamp("1704067200")).toBe(1704067200);
  });

  it("interpretiert YYYY-MM-DD in Europe/Berlin (Winterzeit = UTC+1)", () => {
    expect(toUnixTimestamp("2024-01-01")).toBe(1704067200 - 3600);
  });

  it("berücksichtigt die Sommerzeit (UTC+2)", () => {
    expect(toUnixTimestamp("2024-07-01")).toBe(Date.UTC(2024, 6, 1) / 1000 - 7200);
  });

  it("versteht DD.MM.YYYY", () => {
    expect(toUnixTimestamp("01.01.2024")).toBe(toUnixTimestamp("2024-01-01"));
  });

  it("setzt bei endOfDay auf die letzte Sekunde des Tages", () => {
    expect(toUnixTimestamp("2024-01-01", { endOfDay: true })).toBe(toUnixTimestamp("2024-01-01") + 86399);
  });

  it("lehnt ungültige Daten ab", () => {
    expect(() => toUnixTimestamp("gestern")).toThrow(/Invalid date/);
    expect(() => toUnixTimestamp("2024-02-31")).toThrow(/Invalid date/);
  });

  it("formatiert deutsche Daten", () => {
    expect(toGermanDate("2024-03-05")).toBe("05.03.2024");
  });
});

describe("compact / payload", () => {
  it("entfernt null, leere Strings, leere Container und sevClient, behält 0 und false", () => {
    expect(
      compact({ a: null, b: "", c: [], d: {}, e: 0, f: false, sevClient: { id: 1 }, g: { h: null, i: "x" } })
    ).toEqual({ e: 0, f: false, g: { i: "x" } });
  });

  it("entpackt objects und kollabiert Einzelelemente", () => {
    expect(payload({ objects: [{ id: 1 }] })).toEqual({ id: 1 });
    expect(payload({ objects: [{ id: 1 }, { id: 2 }] })).toHaveLength(2);
    expect(payload({ objects: { id: 3 } })).toEqual({ id: 3 });
  });

  it("objectsOf liefert immer eine Liste", () => {
    expect(objectsOf({ objects: { id: 3 } })).toEqual([{ id: 3 }]);
    expect(objectsOf(undefined)).toEqual([]);
  });

  it("serialisiert ohne Pretty-Print", () => {
    expect(toText({ a: 1, b: null })).toBe('{"a":1}');
  });
});

describe("unwrap", () => {
  const response = (status: number) => new Response(null, { status, statusText: "X" });

  it("liefert data bei Erfolg", () => {
    expect(unwrap({ data: { ok: true }, response: response(200) })).toEqual({ ok: true });
  });

  it("wirft einen lesbaren Fehler mit Status, Meldung und Hinweis", () => {
    try {
      unwrap({ error: { error: { message: "Token invalid" } }, response: response(401) });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(SevdeskApiError);
      expect((error as Error).message).toContain("HTTP 401");
      expect((error as Error).message).toContain("Token invalid");
      expect((error as Error).message).toContain("SEVDESK_API_TOKEN");
    }
  });

  it("behandelt Fehler ohne Body", () => {
    expect(() => unwrap({ error: "", response: response(500) })).toThrow(/HTTP 500/);
  });
});

describe("fetchPage", () => {
  const items = Array.from({ length: 5 }, (_, i) => ({ id: String(i), name: `n${i}`, note: null }));

  it("fordert ein Element mehr an und meldet hasMore exakt", async () => {
    let asked = 0;
    const page = await fetchPage({ limit: 3, offset: 0 }, async (limit) => {
      asked = limit;
      return { objects: items.slice(0, limit) };
    });

    expect(asked).toBe(4);
    expect(page).toMatchObject({ count: 3, hasMore: true, nextOffset: 3 });
  });

  it("meldet am Ende hasMore=false ohne nextOffset", async () => {
    const page = await fetchPage({ limit: 10, offset: 0 }, async () => ({ objects: items }));
    expect(page.hasMore).toBe(false);
    expect(page).not.toHaveProperty("nextOffset");
  });

  it("reduziert auf die gewünschten Felder und entfernt Nullwerte", async () => {
    const page = await fetchPage({ limit: 2, offset: 0, fields: ["id"] }, async () => ({ objects: items }));
    expect(page.objects).toEqual([{ id: "0" }, { id: "1" }]);
  });
});

describe("Read-only-Modus", () => {
  const tools = {
    a: defineTool({ title: "a", description: "a", access: "read", inputSchema: z.object({}), handler: async () => 1 }),
    b: defineTool({ title: "b", description: "b", access: "write", inputSchema: z.object({}), handler: async () => 1 }),
    c: defineTool({ title: "c", description: "c", access: "destructive", inputSchema: z.object({}), handler: async () => 1 }),
  };

  it("lässt nur lesende Tools durch", () => {
    expect(Object.keys(filterTools(tools, true))).toEqual(["a"]);
    expect(Object.keys(filterTools(tools, false))).toEqual(["a", "b", "c"]);
  });

  it("erkennt Env-Variable und CLI-Flag", () => {
    expect(isReadOnlyMode({ SEVDESK_READONLY: "1" }, [])).toBe(true);
    expect(isReadOnlyMode({ SEVDESK_READONLY: "TRUE" }, [])).toBe(true);
    expect(isReadOnlyMode({}, ["--read-only"])).toBe(true);
    expect(isReadOnlyMode({ SEVDESK_READONLY: "0" }, [])).toBe(false);
    expect(isReadOnlyMode({}, [])).toBe(false);
  });
});

describe("toText", () => {
  it("lässt eine leere Top-Level-Liste als [] stehen", () => {
    expect(toText([])).toBe("[]");
  });
});
