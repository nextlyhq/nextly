/**
 * Whose fast drain a plugin's recorded event offers: the one its context
 * resolves, never whatever the process container holds at the time.
 *
 * A context outlives a container replaced by a reload, and it reads its
 * adapter through its own resolver for that reason. The drain it offers once
 * an event commits is read the same way, so a committed event is offered to
 * the drain of the registration that recorded it.
 *
 * @module domains/webhooks/__tests__/plugin-record.test
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { container } from "../../../di/container";
import type { WebhookFastDrainScheduler } from "../after-drain";
import { publishWebhookEventTypes } from "../event-type-registry";
import { createPluginWebhooks } from "../plugin-record";
import { resetWebhookActivation } from "../recording-activation";

const PAID = "shop.order.paid";

afterEach(() => {
  publishWebhookEventTypes([]);
  resetWebhookActivation();
  vi.restoreAllMocks();
});

/** An adapter whose one transaction keeps the rows it is handed. */
function recordingAdapter(rows: unknown[]) {
  return {
    transactionOpenInFlow: () => false,
    transaction: async <T>(work: (tx: never) => Promise<T>): Promise<T> =>
      work({
        insert: async (_table: string, row: unknown) => {
          rows.push(row);
          return [];
        },
      } as never),
  };
}

describe("a plugin's recorded event offers its context's fast drain", () => {
  it("offers the drain the context resolves, and not the container's", async () => {
    publishWebhookEventTypes([{ type: PAID, owner: "shop" }]);
    const rows: unknown[] = [];
    const own: WebhookFastDrainScheduler = { offer: vi.fn() } as never;
    const containers = { offer: vi.fn() };
    vi.spyOn(container, "has").mockReturnValue(true);
    vi.spyOn(container, "get").mockReturnValue(containers);

    const webhooks = createPluginWebhooks(
      "shop",
      () => recordingAdapter(rows) as never,
      () => own
    );
    await webhooks.record({ type: PAID, id: "ord_1", data: { total: 1 } });

    expect(rows).toHaveLength(1);
    expect(own.offer).toHaveBeenCalledTimes(1);
    expect(containers.offer).not.toHaveBeenCalled();
  });

  it("offers nothing where the context has no drain", async () => {
    publishWebhookEventTypes([{ type: PAID, owner: "shop" }]);
    const rows: unknown[] = [];

    const webhooks = createPluginWebhooks(
      "shop",
      () => recordingAdapter(rows) as never,
      () => null
    );

    await expect(
      webhooks.record({ type: PAID, id: "ord_1", data: {} })
    ).resolves.toBeUndefined();
    expect(rows).toHaveLength(1);
  });
});
