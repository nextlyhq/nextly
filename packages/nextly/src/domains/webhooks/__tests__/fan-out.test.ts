import { describe, it, expect } from "vitest";

import {
  fanOutDueEvents,
  selectDeliveryTargets,
  type FanOutDatabase,
  type FanOutTx,
} from "../fan-out";
import type { WebhookEndpoint, WebhookEvent } from "../types";

function endpoint(over: Partial<WebhookEndpoint>): WebhookEndpoint {
  return {
    id: "wh",
    name: "wh",
    url: "https://example.com",
    enabled: true,
    eventTypes: ["entry.updated"],
    filter: null,
    headers: null,
    secretHash: [],
    secretPrefix: "",
    fieldAllowlist: null,
    createdBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

function event(over: Partial<WebhookEvent> = {}): WebhookEvent {
  return {
    id: "evt",
    type: "entry.updated",
    specversion: "1",
    timestamp: "2026-07-18T00:00:00.000Z",
    resource: { kind: "entry", collection: "posts", id: "p1" },
    data: { id: "p1", title: "new" },
    previous: { id: "p1", title: "old" },
    changedFields: ["title"],
    ...over,
  };
}

describe("selectDeliveryTargets", () => {
  it("selects enabled endpoints subscribed to the type with no filter", () => {
    const targets = selectDeliveryTargets(
      [endpoint({ id: "a" }), endpoint({ id: "b" })],
      event()
    );
    expect(targets.map(t => t.id)).toEqual(["a", "b"]);
  });

  it("excludes disabled endpoints", () => {
    const targets = selectDeliveryTargets(
      [endpoint({ id: "on" }), endpoint({ id: "off", enabled: false })],
      event()
    );
    expect(targets.map(t => t.id)).toEqual(["on"]);
  });

  it("excludes endpoints not subscribed to the event type", () => {
    const targets = selectDeliveryTargets(
      [
        endpoint({ id: "sub", eventTypes: ["entry.updated"] }),
        endpoint({ id: "other", eventTypes: ["entry.created"] }),
      ],
      event({ type: "entry.updated" })
    );
    expect(targets.map(t => t.id)).toEqual(["sub"]);
  });

  it("applies the endpoint filter (collection scope)", () => {
    const targets = selectDeliveryTargets(
      [
        endpoint({
          id: "posts-only",
          filter: { version: 1, collections: ["posts"] },
        }),
        endpoint({
          id: "pages-only",
          filter: { version: 1, collections: ["pages"] },
        }),
      ],
      event({ resource: { kind: "entry", collection: "posts", id: "p1" } })
    );
    expect(targets.map(t => t.id)).toEqual(["posts-only"]);
  });
});

describe("fanOutDueEvents (invalid payload)", () => {
  it("skips an unparseable event without marking it fanned out", async () => {
    const marked: string[] = [];
    const warnings: string[] = [];
    const tx: FanOutTx = {
      select: async <T>() => [] as T[],
      insertMany: async <T>() => [] as T[],
      update: async <T>() => {
        marked.push("update");
        return [] as T[];
      },
    };
    const db: FanOutDatabase = {
      select: async <T>() =>
        [{ id: "evt_bad", payload: "{not valid json" }] as T[],
      transaction: async fn => fn(tx),
    };

    const result = await fanOutDueEvents({
      db,
      loadEndpoints: async () => [],
      logger: { warn: m => warnings.push(m) },
    });

    // Not counted, never marked, and surfaced via the logger.
    expect(result).toEqual({ eventsProcessed: 0, deliveriesCreated: 0 });
    expect(marked).toHaveLength(0);
    expect(warnings.some(w => w.includes("evt_bad"))).toBe(true);
  });

  it("skips a structurally-invalid envelope (missing resource) without throwing", async () => {
    const marked: string[] = [];
    const warnings: string[] = [];
    const tx: FanOutTx = {
      select: async <T>() => [] as T[],
      insertMany: async <T>() => [] as T[],
      update: async <T>() => {
        marked.push("update");
        return [] as T[];
      },
    };
    const db: FanOutDatabase = {
      // Parseable object but missing `resource`; matchesFilter would throw on
      // a collections filter if it reached it.
      select: async <T>() =>
        [{ id: "evt_noresource", payload: { type: "entry.updated" } }] as T[],
      transaction: async fn => fn(tx),
    };

    const result = await fanOutDueEvents({
      db,
      loadEndpoints: async () => [
        endpoint({ id: "f", filter: { version: 1, collections: ["posts"] } }),
      ],
      logger: { warn: m => warnings.push(m) },
    });

    expect(result).toEqual({ eventsProcessed: 0, deliveriesCreated: 0 });
    expect(marked).toHaveLength(0);
    expect(warnings.some(w => w.includes("evt_noresource"))).toBe(true);
  });
});
