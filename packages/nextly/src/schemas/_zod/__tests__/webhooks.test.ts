/**
 * Request validation for the webhook endpoint surface.
 *
 * The assertions worth having here are the ones that protect delivery rather
 * than the ones that restate the schema. A caller-supplied `webhook-signature`
 * header would let a request overwrite the header a receiver verifies against,
 * and an unknown event type would be accepted into a subscription the fan-out
 * never matches — a subscription that silently never fires.
 */
import { describe, it, expect } from "vitest";

import { WEBHOOK_EVENT_TYPES } from "../../../domains/webhooks/types";
import { CreateWebhookSchema, UpdateWebhookSchema } from "../webhooks";

const valid = {
  name: "Orders",
  url: "https://example.com/hooks",
  eventTypes: ["entry.created"],
};

describe("CreateWebhookSchema", () => {
  it("accepts a minimal endpoint", () => {
    expect(CreateWebhookSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts every type the fan-out can deliver", () => {
    // Bound to the same constant delivery matches on, so a type that can be
    // subscribed to is always a type that can fire.
    const parsed = CreateWebhookSchema.safeParse({
      ...valid,
      eventTypes: [...WEBHOOK_EVENT_TYPES],
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects an event type nothing emits", () => {
    const parsed = CreateWebhookSchema.safeParse({
      ...valid,
      eventTypes: ["entry.exploded"],
    });
    expect(parsed.success).toBe(false);
  });

  it("requires at least one subscription", () => {
    expect(
      CreateWebhookSchema.safeParse({ ...valid, eventTypes: [] }).success
    ).toBe(false);
  });

  it("rejects a duplicated event type", () => {
    const parsed = CreateWebhookSchema.safeParse({
      ...valid,
      eventTypes: ["entry.created", "entry.created"],
    });
    expect(parsed.success).toBe(false);
  });

  describe("headers delivery owns", () => {
    it.each([
      ["webhook-signature"],
      ["webhook-id"],
      ["Webhook-Timestamp"],
      ["Content-Type"],
      ["user-agent"],
    ])("rejects %s", header => {
      const parsed = CreateWebhookSchema.safeParse({
        ...valid,
        headers: { [header]: "forged" },
      });
      expect(parsed.success).toBe(false);
    });

    it("allows an ordinary header", () => {
      const parsed = CreateWebhookSchema.safeParse({
        ...valid,
        headers: { Authorization: "Bearer token" },
      });
      expect(parsed.success).toBe(true);
    });
  });

  describe("headers the transport could never send", () => {
    // Node rejects these when it builds the request, and delivery cannot
    // distinguish that from a network fault — it records a transient failure
    // and retries an endpoint that can never succeed.
    it.each([
      ["a space in the name", { "bad header": "x" }],
      ["a colon in the name", { "bad:header": "x" }],
      ["a CR/LF injection in the value", { "X-Trace": "a\r\nX-Forged: 1" }],
      ["a bare newline in the value", { "X-Trace": "a\nb" }],
      ["a NUL in the value", { "X-Trace": "a\u0000b" }],
      ["an empty name", { "": "x" }],
    ])("rejects %s", (_label, headers) => {
      expect(CreateWebhookSchema.safeParse({ ...valid, headers }).success).toBe(
        false
      );
    });

    it("still allows the punctuation a token permits", () => {
      const parsed = CreateWebhookSchema.safeParse({
        ...valid,
        headers: { "X-Trace_Id.v1": "abc-123" },
      });
      expect(parsed.success).toBe(true);
    });
  });

  it("rejects a URL longer than the column holds", () => {
    const parsed = CreateWebhookSchema.safeParse({
      ...valid,
      url: `https://example.com/${"a".repeat(2048)}`,
    });
    expect(parsed.success).toBe(false);
  });
});

describe("UpdateWebhookSchema", () => {
  it("accepts a single field", () => {
    expect(UpdateWebhookSchema.safeParse({ name: "Renamed" }).success).toBe(
      true
    );
  });

  it("rejects an empty patch", () => {
    // An empty patch would otherwise bump updated_at and invalidate the
    // endpoint cache while changing nothing.
    expect(UpdateWebhookSchema.safeParse({}).success).toBe(false);
  });

  it("applies the same header rule as creation", () => {
    const parsed = UpdateWebhookSchema.safeParse({
      headers: { "webhook-signature": "forged" },
    });
    expect(parsed.success).toBe(false);
  });
});
