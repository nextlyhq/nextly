import { beforeEach, describe, expect, it, vi } from "vitest";

/** Each handler answers with its own name, so a test can tell which one ran. */
const handlers = vi.hoisted(() => {
  const names = [
    "listWebhooks",
    "listWebhookEventTypes",
    "getWebhookById",
    "createWebhook",
    "updateWebhook",
    "deleteWebhook",
    "revealWebhookSecret",
    "rotateWebhookSecret",
    "expireWebhookOldSecrets",
    "listWebhookDeliveries",
    "getWebhookDelivery",
    "testWebhookEndpoint",
    "redeliverWebhookDelivery",
    "drainWebhooks",
  ] as const;
  return Object.fromEntries(
    names.map(name => [
      name,
      vi.fn(() => Promise.resolve(new Response(name, { status: 200 }))),
    ])
  ) as Record<(typeof names)[number], ReturnType<typeof vi.fn>>;
});

vi.mock("../../api/webhooks", () => handlers);

import { handleWebhookRequest } from "../webhook-dispatch";

const req = new Request("http://x/api/webhooks");
const params = { webhookId: "wh_1", deliveryId: "del_1" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("handleWebhookRequest", () => {
  // The operations as the parser names them, with the arguments each handler
  // was given before the dispatch became a table: none beyond the request, the
  // endpoint id, or the endpoint and delivery ids.
  const cases: Array<[keyof typeof handlers, unknown[]]> = [
    ["listWebhooks", [req]],
    ["listWebhookEventTypes", [req]],
    ["getWebhookById", [req, "wh_1"]],
    ["createWebhook", [req]],
    ["updateWebhook", [req, "wh_1"]],
    ["deleteWebhook", [req, "wh_1"]],
    ["revealWebhookSecret", [req, "wh_1"]],
    ["rotateWebhookSecret", [req, "wh_1"]],
    ["expireWebhookOldSecrets", [req, "wh_1"]],
    ["listWebhookDeliveries", [req, "wh_1"]],
    ["getWebhookDelivery", [req, "wh_1", "del_1"]],
    ["testWebhookEndpoint", [req, "wh_1"]],
    ["redeliverWebhookDelivery", [req, "wh_1", "del_1"]],
    ["drainWebhooks", [req]],
  ];

  it.each(cases)(
    "sends %s to its own handler, with the ids the route parsed",
    async (method, args) => {
      const res = await handleWebhookRequest(req, method, params);

      expect(await res.text()).toBe(method);
      expect(handlers[method]).toHaveBeenCalledTimes(1);
      expect(handlers[method]).toHaveBeenCalledWith(...args);
      const others = Object.entries(handlers).filter(
        ([name, fn]) => name !== method && fn.mock.calls.length > 0
      );
      expect(others).toEqual([]);
    }
  );

  it("covers every handler the module exports", () => {
    // The control: a case list that missed a handler would leave it untested.
    expect(cases.map(([method]) => method).sort()).toEqual(
      Object.keys(handlers).sort()
    );
  });

  it.each([
    "__proto__",
    "constructor",
    "toString",
    "hasOwnProperty",
    "valueOf",
    "notAnOperation",
  ])(
    "dispatches %s to nothing, answering as an unknown operation",
    async method => {
      const res = await handleWebhookRequest(req, method, params);

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: "Unknown webhook operation",
      });
      for (const fn of Object.values(handlers)) {
        expect(fn).not.toHaveBeenCalled();
      }
    }
  );
});
