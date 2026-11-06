import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  CreateWebhookSchema,
  UpdateWebhookSchema,
} from "../../../schemas/_zod/webhooks";
import { publishWebhookEventTypes } from "../event-type-registry";
import {
  CreateWebhookRequestSchema,
  UpdateWebhookRequestSchema,
} from "../request-schemas";

const endpoint = { name: "Orders", url: "https://example.com/hooks" };

beforeEach(() => {
  publishWebhookEventTypes([
    { type: "acme-shop.order.paid", owner: "@acme/shop" },
  ]);
});
afterEach(() => {
  publishWebhookEventTypes([]);
});

describe("the route's request schemas", () => {
  it("accept a type a plugin declares, which the published ones refuse", () => {
    const body = { ...endpoint, eventTypes: ["acme-shop.order.paid"] };
    expect(CreateWebhookRequestSchema.safeParse(body).success).toBe(true);
    expect(CreateWebhookSchema.safeParse(body).success).toBe(false);
    expect(
      UpdateWebhookRequestSchema.safeParse({ eventTypes: body.eventTypes })
        .success
    ).toBe(true);
  });

  it("refuse a type nobody declares, naming it", () => {
    const result = CreateWebhookRequestSchema.safeParse({
      ...endpoint,
      eventTypes: ["acme-shop.order.refunded"],
    });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain(
      "acme-shop.order.refunded"
    );
  });

  // The rules both kinds share, held in step with the published schemas: the
  // route's are derived from them, and a rule that drifted would let the route
  // store a list the published schema refuses, or refuse one it accepts.
  it.each([
    ["an empty list", []],
    ["a duplicated type", ["entry.created", "entry.created"]],
    ["the wildcard with a specific type", ["*", "entry.created"]],
  ])("refuse %s, as the published schemas do", (_label, eventTypes) => {
    const body = { ...endpoint, eventTypes };
    expect(CreateWebhookSchema.safeParse(body).success).toBe(false);
    expect(CreateWebhookRequestSchema.safeParse(body).success).toBe(false);
  });

  it("accept the wildcard alone and core's types, as the published schemas do", () => {
    for (const eventTypes of [
      ["*"],
      ["entry.created", "form.submission.created"],
    ]) {
      const body = { ...endpoint, eventTypes };
      expect(CreateWebhookSchema.safeParse(body).success).toBe(true);
      expect(CreateWebhookRequestSchema.safeParse(body).success).toBe(true);
    }
  });

  it("refuse an empty patch, as the published update schema does", () => {
    expect(UpdateWebhookSchema.safeParse({}).success).toBe(false);
    expect(UpdateWebhookRequestSchema.safeParse({}).success).toBe(false);
  });

  it("apply the published update schema's other fields unchanged", () => {
    const patch = { url: "not a url" };
    expect(UpdateWebhookSchema.safeParse(patch).success).toBe(false);
    expect(UpdateWebhookRequestSchema.safeParse(patch).success).toBe(false);
  });
});
