import { describe, it, expect } from "vitest";

import { selectDeliveryTargets } from "../record-event";
import type { WebhookEndpoint, WebhookEvent } from "../types";

function endpoint(overrides: Partial<WebhookEndpoint> = {}): WebhookEndpoint {
  return {
    id: "wh_1",
    name: "Endpoint",
    url: "https://example.com/hook",
    enabled: true,
    eventTypes: ["entry.updated"],
    filter: null,
    headers: null,
    secretHash: ["h1"],
    secretPrefix: "whsec_ab",
    fieldAllowlist: null,
    createdBy: null,
    createdAt: new Date("2026-07-18T00:00:00.000Z"),
    updatedAt: new Date("2026-07-18T00:00:00.000Z"),
    ...overrides,
  };
}

const envelope: WebhookEvent = {
  id: "evt_1",
  type: "entry.updated",
  specversion: "1",
  timestamp: "2026-07-18T00:00:00.000Z",
  resource: { kind: "entry", collection: "posts", id: "p1" },
  data: { id: "p1" },
  previous: null,
  changedFields: ["status"],
};

describe("selectDeliveryTargets", () => {
  it("includes an enabled, subscribed endpoint whose filter matches", () => {
    const targets = selectDeliveryTargets([endpoint()], envelope);
    expect(targets.map(t => t.id)).toEqual(["wh_1"]);
  });

  it("excludes a disabled endpoint", () => {
    expect(
      selectDeliveryTargets([endpoint({ enabled: false })], envelope)
    ).toEqual([]);
  });

  it("excludes an endpoint not subscribed to the event type", () => {
    const targets = selectDeliveryTargets(
      [endpoint({ eventTypes: ["entry.created"] })],
      envelope
    );
    expect(targets).toEqual([]);
  });

  it("excludes an endpoint whose filter rejects the envelope", () => {
    const targets = selectDeliveryTargets(
      [endpoint({ filter: { version: 1, collections: ["other"] } })],
      envelope
    );
    expect(targets).toEqual([]);
  });

  it("selects only the matching endpoints from a mixed set", () => {
    const targets = selectDeliveryTargets(
      [
        endpoint({ id: "match" }),
        endpoint({ id: "disabled", enabled: false }),
        endpoint({ id: "wrong-type", eventTypes: ["media.uploaded"] }),
        endpoint({
          id: "filtered-out",
          filter: { version: 1, changedFields: ["title"] },
        }),
      ],
      envelope
    );
    expect(targets.map(t => t.id)).toEqual(["match"]);
  });
});
