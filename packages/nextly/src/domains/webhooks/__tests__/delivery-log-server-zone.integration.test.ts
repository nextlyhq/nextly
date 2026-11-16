/**
 * The webhook delivery log reads back the instants its rows hold, on every
 * dialect and whatever time zone the server runs in.
 *
 * The log's own suite runs on SQLite alone, where a timestamp is epoch seconds
 * and no zone can enter. PostgreSQL and MySQL keep a wall clock, so a read that
 * takes it for the server's local time moves every stamp by the offset: on a
 * UTC server that is nothing, which is why each case also runs five hours ahead
 * of UTC, where the move is five hours.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { buildEnvelope } from "../envelope";
import { recordEvent } from "../record-event";
import { WebhookDeliveryQueryService } from "../services/webhook-delivery-query-service";

let current: TestNextly | undefined;
let restoreTz: (() => void) | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
  restoreTz?.();
  restoreTz = undefined;
});

/** Run the rest of the case as if the server ran in `zone`. */
function runIn(zone: string): void {
  const previous = process.env.TZ;
  process.env.TZ = zone;
  restoreTz = () => {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  };
}

const logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

/** Whole seconds, which every dialect keeps exactly. */
const EVENT_AT = new Date("2026-07-18T00:00:00.000Z");
const DELIVERY_AT = new Date("2026-07-18T00:00:01.000Z");
const RETRY_AT = new Date("2026-07-18T00:10:00.000Z");

const ZONES = ["UTC", "Asia/Karachi"] as const;

describe.each(
  getConfiguredTestDialects().flatMap(dialect =>
    ZONES.map(zone => ({ dialect, zone }))
  )
)("webhook delivery log on a $zone server ($dialect)", ({ dialect, zone }) => {
  it("reads back each stamp as it was written", async () => {
    runIn(zone);
    current = await createTestNextly({ dialect });
    const { adapter } = current;

    await adapter.insert("nextly_webhooks", {
      id: "wh1",
      name: "wh1",
      url: "https://example.com/wh1",
      enabled: true,
      event_types: ["entry.updated"],
      filter: null,
      headers: null,
      secret_hash: ["whsec_x"],
      secret_prefix: "whsec_",
      field_allowlist: null,
      created_by: null,
      created_at: EVENT_AT,
      updated_at: EVENT_AT,
    });
    const envelope = buildEnvelope({
      id: "evt_a",
      type: "entry.updated",
      timestamp: EVENT_AT,
      resource: { kind: "entry", collection: "posts", id: "p1" },
      data: { id: "p1" },
    });
    await adapter.transaction(async tx => recordEvent(tx, { envelope }));
    await adapter.insert("nextly_webhook_deliveries", {
      id: "d1",
      webhook_id: "wh1",
      event_id: "evt_a",
      status: "retrying",
      attempt_count: 1,
      next_attempt_at: RETRY_AT,
      locked_by: null,
      locked_until: null,
      last_status_code: 500,
      last_latency_ms: 10,
      last_error: null,
      last_response_snippet: null,
      attempts: null,
      created_at: DELIVERY_AT,
      updated_at: DELIVERY_AT,
    });

    const service = new WebhookDeliveryQueryService(adapter, logger as never);
    const { items } = await service.listDeliveries("wh1", {
      page: 1,
      limit: 5,
    });
    const detail = await service.getDelivery("wh1", "d1");

    // ISO strings, so a failure names the instant that was read.
    for (const read of [items[0], detail]) {
      expect(read?.createdAt?.toISOString()).toBe(DELIVERY_AT.toISOString());
      expect(read?.updatedAt?.toISOString()).toBe(DELIVERY_AT.toISOString());
      expect(read?.nextAttemptAt?.toISOString()).toBe(RETRY_AT.toISOString());
    }
  });
});
