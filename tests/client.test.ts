import { describe, expect, it } from "vitest";
import { json, mockClient } from "./helpers.js";

describe("Client: Retry und Timeout", () => {
  it("wiederholt 429 auch bei POST und liefert danach das Ergebnis", async () => {
    const { client, requests } = mockClient((_req, i) => (i < 2 ? json({}, 429) : json({ objects: { id: "1" } }, 201)));

    const { data, response } = await client.POST("/Contact", { body: {} as never });

    expect(requests).toHaveLength(3);
    expect(response.status).toBe(201);
    expect(data).toEqual({ objects: { id: "1" } });
  });

  it("wiederholt 503 bei GET", async () => {
    const { client, requests } = mockClient((_req, i) => (i === 0 ? json({}, 503) : json({ objects: [] })));

    const { response } = await client.GET("/Contact", {});

    expect(requests).toHaveLength(2);
    expect(response.status).toBe(200);
  });

  it("wiederholt 5xx NICHT bei POST (könnte schon verarbeitet worden sein)", async () => {
    const { client, requests } = mockClient(() => json({ error: "boom" }, 500));

    const { response } = await client.POST("/Contact", { body: {} as never });

    expect(requests).toHaveLength(1);
    expect(response.status).toBe(500);
  });

  it("gibt nach maxRetries auf und liefert die letzte Antwort", async () => {
    const { client, requests } = mockClient(() => json({}, 429), { maxRetries: 2 });

    const { response } = await client.GET("/Contact", {});

    expect(requests).toHaveLength(3);
    expect(response.status).toBe(429);
  });

  it("sendet das Token im Authorization-Header", async () => {
    const { client, requests } = mockClient(() => json({ objects: [] }));

    await client.GET("/Contact", {});

    expect(requests[0].url.pathname).toBe("/api/v1/Contact");
    expect(requests[0].headers.get("authorization")).toBe("test-token");
  });

  it("meldet einen Timeout verständlich", async () => {
    const slow = mockClient(
      (_req) =>
        new Promise<Response>((_resolve, reject) => {
          setTimeout(() => reject(Object.assign(new Error("aborted"), { name: "TimeoutError" })), 30);
        }),
      { timeoutMs: 20, maxRetries: 0 }
    );
    await expect(slow.client.POST("/Contact", { body: {} as never })).rejects.toThrow(/timed out after 20 ms/);
  });
});
