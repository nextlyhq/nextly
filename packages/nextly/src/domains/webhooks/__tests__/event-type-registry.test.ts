import { afterEach, describe, expect, it } from "vitest";

import type { PluginWebhookEventType } from "../../../plugins/contributions";
import type { PluginDefinition } from "../../../plugins/plugin-context";
import {
  collectPluginWebhookEventTypes,
  isSubscribableEventType,
  publishWebhookEventTypes,
  stageWebhookEventTypes,
  webhookEventTypes,
} from "../event-type-registry";

function plugin(
  name: string,
  webhookEvents: PluginWebhookEventType[],
  enabled?: boolean
): PluginDefinition {
  return {
    name,
    version: "1.0.0",
    nextly: "*",
    enabled,
    contributes: { webhookEvents },
  } as unknown as PluginDefinition;
}

/** The refusal's reason, or `undefined` when the declarations are accepted. */
function refusal(plugins: PluginDefinition[]): string | undefined {
  try {
    collectPluginWebhookEventTypes(plugins);
    return undefined;
  } catch (error) {
    const context = (error as { logContext?: { reason?: string } }).logContext;
    return context?.reason;
  }
}

describe("collectPluginWebhookEventTypes", () => {
  it("accepts a plugin's namespaced type, with its owner", () => {
    expect(
      collectPluginWebhookEventTypes([
        plugin("@acme/shop", [
          { type: "acme-shop.order.paid", label: "Order paid" },
        ]),
      ])
    ).toEqual([
      {
        type: "acme-shop.order.paid",
        owner: "@acme/shop",
        label: "Order paid",
      },
    ]);
  });

  it("refuses a type outside the plugin's namespace", () => {
    expect(
      refusal([plugin("@acme/shop", [{ type: "billing.invoice.sent" }])])
    ).toBe("plugin-webhook-event-outside-namespace");
  });

  it("refuses a core type redeclared", () => {
    expect(refusal([plugin("@acme/shop", [{ type: "entry.created" }])])).toBe(
      "plugin-webhook-event-core"
    );
  });

  it("refuses a type the plugin declares twice", () => {
    expect(
      refusal([
        plugin("@acme/shop", [
          { type: "acme-shop.order.paid" },
          { type: "acme-shop.order.paid" },
        ]),
      ])
    ).toBe("plugin-webhook-event-duplicate");
  });

  it("refuses a malformed type", () => {
    for (const type of [
      "acme-shop",
      "acme-shop.Order",
      "acme-shop..paid",
      "acme-shop.order paid",
    ]) {
      expect(refusal([plugin("@acme/shop", [{ type }])]), type).toBe(
        "plugin-webhook-event-malformed"
      );
    }
  });

  it("refuses a label or description that is not text", () => {
    for (const declared of [
      { type: "acme-shop.order.paid", label: 42 },
      { type: "acme-shop.order.paid", description: { text: "paid" } },
      { type: "acme-shop.order.paid", label: BigInt(1) },
    ]) {
      expect(
        refusal([
          plugin("@acme/shop", [declared as unknown as PluginWebhookEventType]),
        ]),
        JSON.stringify(declared, (_k, v: unknown) =>
          typeof v === "bigint" ? `${v}n` : v
        )
      ).toBe("plugin-webhook-event-text");
    }
  });

  it("names the plugin and the type in what it refuses", () => {
    try {
      collectPluginWebhookEventTypes([
        plugin("@acme/shop", [{ type: "billing.invoice.sent" }]),
      ]);
      expect.unreachable("the declaration should be refused");
    } catch (error) {
      expect(
        (error as { logContext?: Record<string, unknown> }).logContext
      ).toMatchObject({ plugin: "@acme/shop", type: "billing.invoice.sent" });
    }
  });

  it("leaves out a disabled plugin's types, and refuses nothing of it", () => {
    expect(
      collectPluginWebhookEventTypes([
        plugin("@acme/shop", [{ type: "not even a type" }], false),
      ])
    ).toEqual([]);
  });
});

describe("the list of event types", () => {
  afterEach(() => {
    publishWebhookEventTypes([]);
  });

  it("lists core's types and each enabled plugin's", () => {
    publishWebhookEventTypes(
      collectPluginWebhookEventTypes([
        plugin("@acme/shop", [{ type: "acme-shop.order.paid" }]),
        plugin("@acme/blog", [{ type: "acme-blog.comment.added" }], false),
      ])
    );

    const types = webhookEventTypes().map(entry => entry.type);
    expect(types).toContain("entry.created");
    expect(types).toContain("acme-shop.order.paid");
    expect(types).not.toContain("acme-blog.comment.added");
    expect(isSubscribableEventType("acme-shop.order.paid")).toBe(true);
    expect(isSubscribableEventType("acme-blog.comment.added")).toBe(false);
  });

  it("still lists form.submission.created as core's", () => {
    // The form builder's event predates plugin namespaces and is not in the
    // form builder's own: it stays core's, so existing subscriptions to it
    // keep being accepted and delivered.
    expect(webhookEventTypes()).toContainEqual({
      type: "form.submission.created",
      owner: "core",
    });
    expect(isSubscribableEventType("form.submission.created")).toBe(true);
  });

  it("subscribes to no type nobody declared", () => {
    expect(isSubscribableEventType("acme-shop.order.paid")).toBe(false);
  });
});

describe("the list while a reload holds it", () => {
  afterEach(() => {
    publishWebhookEventTypes([]);
  });

  const shop = [{ type: "acme-shop.order.paid", owner: "@acme/shop" }];

  it("keeps the types in force until the reload commits, then installs its own", () => {
    const held = stageWebhookEventTypes();
    publishWebhookEventTypes(shop);

    expect(isSubscribableEventType("acme-shop.order.paid")).toBe(false);
    held.commit();
    expect(isSubscribableEventType("acme-shop.order.paid")).toBe(true);
  });

  it("drops what an abandoned reload published, and keeps the types in force", () => {
    publishWebhookEventTypes(shop);
    const held = stageWebhookEventTypes();
    publishWebhookEventTypes([]);
    held.abandon();

    expect(isSubscribableEventType("acme-shop.order.paid")).toBe(true);
    // And publication goes straight through again once nothing holds it.
    publishWebhookEventTypes([]);
    expect(isSubscribableEventType("acme-shop.order.paid")).toBe(false);
  });

  it("settles once: a commit after an abandon installs nothing", () => {
    const held = stageWebhookEventTypes();
    publishWebhookEventTypes(shop);
    held.abandon();
    held.commit();

    expect(isSubscribableEventType("acme-shop.order.paid")).toBe(false);
  });
});
