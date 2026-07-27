import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetcherSpy } = vi.hoisted(() => ({ fetcherSpy: vi.fn() }));

vi.mock("../lib/api/fetcher", () => ({ fetcher: fetcherSpy }));

import { webhookApi } from "./webhookApi";

const summary = { id: "wh_1", name: "Orders" };

describe("webhookApi", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists endpoints and unwraps items", async () => {
    fetcherSpy.mockResolvedValue({ items: [summary], meta: { total: 1 } });
    const result = await webhookApi.listWebhooks();
    expect(fetcherSpy).toHaveBeenCalledWith("/webhooks", {}, true);
    expect(result).toEqual([summary]);
  });

  it("reads one endpoint as a bare doc", async () => {
    fetcherSpy.mockResolvedValue(summary);
    const result = await webhookApi.getWebhook("wh_1");
    expect(fetcherSpy).toHaveBeenCalledWith("/webhooks/wh_1", {}, true);
    expect(result).toBe(summary);
  });

  it("creates and returns doc + one-time secret", async () => {
    fetcherSpy.mockResolvedValue({
      message: "Created.",
      item: { doc: summary, secret: "whsec_live" },
    });
    const input = {
      name: "Orders",
      url: "https://e.com/h",
      eventTypes: ["entry.created" as const],
    };
    const result = await webhookApi.createWebhook(input);
    expect(fetcherSpy).toHaveBeenCalledWith(
      "/webhooks",
      { method: "POST", body: JSON.stringify(input) },
      true
    );
    expect(result).toEqual({ doc: summary, secret: "whsec_live" });
  });

  it("patches an endpoint and unwraps the item", async () => {
    fetcherSpy.mockResolvedValue({ message: "Updated.", item: summary });
    const result = await webhookApi.updateWebhook("wh_1", { enabled: false });
    expect(fetcherSpy).toHaveBeenCalledWith(
      "/webhooks/wh_1",
      { method: "PATCH", body: JSON.stringify({ enabled: false }) },
      true
    );
    expect(result).toBe(summary);
  });

  it("deletes an endpoint", async () => {
    fetcherSpy.mockResolvedValue({ message: "Deleted.", id: "wh_1" });
    await webhookApi.deleteWebhook("wh_1");
    expect(fetcherSpy).toHaveBeenCalledWith(
      "/webhooks/wh_1",
      { method: "DELETE" },
      true
    );
  });

  it("rotates the secret and unwraps doc + new secret", async () => {
    fetcherSpy.mockResolvedValue({
      message: "Rotated.",
      item: { doc: summary, secret: "whsec_new" },
    });
    const result = await webhookApi.rotateSecret("wh_1", {
      overlapSeconds: 3600,
    });
    expect(fetcherSpy).toHaveBeenCalledWith(
      "/webhooks/wh_1/secret/rotate",
      { method: "POST", body: JSON.stringify({ overlapSeconds: 3600 }) },
      true
    );
    expect(result).toEqual({ doc: summary, secret: "whsec_new" });
  });

  it("expires old secrets and unwraps the updated endpoint", async () => {
    fetcherSpy.mockResolvedValue({ message: "Expired.", item: summary });
    const result = await webhookApi.expireOldSecrets("wh_1");
    expect(fetcherSpy).toHaveBeenCalledWith(
      "/webhooks/wh_1/secret/expire-old",
      { method: "POST" },
      true
    );
    expect(result).toBe(summary);
  });

  it("reveals the signing secrets", async () => {
    fetcherSpy.mockResolvedValue({ secrets: ["whsec_a", "whsec_b"] });
    const result = await webhookApi.revealSecret("wh_1");
    expect(fetcherSpy).toHaveBeenCalledWith("/webhooks/wh_1/secret", {}, true);
    expect(result).toEqual(["whsec_a", "whsec_b"]);
  });

  it("tests an endpoint and strips the message from the result", async () => {
    fetcherSpy.mockResolvedValue({
      message: "Test event sent.",
      delivered: true,
      statusCode: 200,
      latencyMs: 42,
      responseSnippet: "ok",
    });
    const result = await webhookApi.testEndpoint("wh_1");
    expect(fetcherSpy).toHaveBeenCalledWith(
      "/webhooks/wh_1/test",
      { method: "POST" },
      true
    );
    expect(result).toEqual({
      delivered: true,
      statusCode: 200,
      latencyMs: 42,
      error: undefined,
      responseSnippet: "ok",
    });
    expect(result).not.toHaveProperty("message");
  });
});
