import { describe, expect, it } from "vitest";

import type { WebhookEventTypeEntry } from "@admin/types/webhooks";

import { webhookEventChoices } from "./webhook-event-choices";

const listed: WebhookEventTypeEntry[] = [
  { type: "entry.created", owner: "core" },
  { type: "acme-shop.order.paid", owner: "@acme/shop", label: "Order paid" },
];

describe("webhookEventChoices", () => {
  it("offers every listed type in the server's order, by label where it has one", () => {
    expect(webhookEventChoices(listed, [])).toEqual([
      { type: "entry.created", label: "entry.created", unavailable: false },
      { type: "acme-shop.order.paid", label: "Order paid", unavailable: false },
    ]);
  });

  it("adds a chosen type the server no longer lists, marked unavailable, after the listed ones", () => {
    expect(
      webhookEventChoices(listed, ["entry.created", "acme-blog.comment.added"])
    ).toEqual([
      { type: "entry.created", label: "entry.created", unavailable: false },
      { type: "acme-shop.order.paid", label: "Order paid", unavailable: false },
      {
        type: "acme-blog.comment.added",
        label: "acme-blog.comment.added",
        unavailable: true,
      },
    ]);
  });
});
