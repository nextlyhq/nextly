import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetcherSpy } = vi.hoisted(() => ({ fetcherSpy: vi.fn() }));

vi.mock("../lib/api/fetcher", () => ({ fetcher: fetcherSpy }));

import { deliveryApi } from "./deliveryApi";

const delivery = { id: "dlv_1", webhookId: "wh_1", status: "delivered" };

describe("deliveryApi", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists deliveries with no filters and returns the raw list envelope", async () => {
    const envelope = { items: [delivery], meta: { total: 1 } };
    fetcherSpy.mockResolvedValue(envelope);
    const result = await deliveryApi.listDeliveries("wh_1");
    expect(fetcherSpy).toHaveBeenCalledWith(
      "/webhooks/wh_1/deliveries",
      {},
      true
    );
    expect(result).toBe(envelope);
  });

  it("serializes page, limit, status, and eventType into the query string", async () => {
    fetcherSpy.mockResolvedValue({ items: [], meta: {} });
    await deliveryApi.listDeliveries("wh_1", {
      page: 2,
      limit: 25,
      status: "failed",
      eventType: "entry.created",
    });
    expect(fetcherSpy).toHaveBeenCalledWith(
      "/webhooks/wh_1/deliveries?page=2&limit=25&status=failed&eventType=entry.created",
      {},
      true
    );
  });

  it("omits an empty event-type filter", async () => {
    fetcherSpy.mockResolvedValue({ items: [], meta: {} });
    await deliveryApi.listDeliveries("wh_1", { page: 1, eventType: "" });
    expect(fetcherSpy).toHaveBeenCalledWith(
      "/webhooks/wh_1/deliveries?page=1",
      {},
      true
    );
  });

  it("reads one delivery as a bare doc", async () => {
    fetcherSpy.mockResolvedValue(delivery);
    const result = await deliveryApi.getDelivery("wh_1", "dlv_1");
    expect(fetcherSpy).toHaveBeenCalledWith(
      "/webhooks/wh_1/deliveries/dlv_1",
      {},
      true
    );
    expect(result).toBe(delivery);
  });

  it("redelivers and unwraps the item", async () => {
    fetcherSpy.mockResolvedValue({
      message: "Redelivery queued.",
      item: delivery,
    });
    const result = await deliveryApi.redeliver("wh_1", "dlv_1");
    expect(fetcherSpy).toHaveBeenCalledWith(
      "/webhooks/wh_1/deliveries/dlv_1/redeliver",
      { method: "POST" },
      true
    );
    expect(result).toBe(delivery);
  });

  it("runs a drain and unwraps the summary item", async () => {
    const summary = { rounds: 1, delivered: 3 };
    fetcherSpy.mockResolvedValue({
      message: "Webhook drain completed.",
      item: summary,
    });
    const result = await deliveryApi.runDrain();
    expect(fetcherSpy).toHaveBeenCalledWith(
      "/webhooks/drain",
      { method: "POST" },
      true
    );
    expect(result).toBe(summary);
  });
});
