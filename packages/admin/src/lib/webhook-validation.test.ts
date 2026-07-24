import { describe, expect, it } from "vitest";

import type { WebhookEndpointSummary } from "@admin/types/webhooks";

import {
  toCreateInput,
  toFormValues,
  toUpdateInput,
  webhookFormSchema,
  type WebhookFormValues,
} from "./webhook-validation";

const base: WebhookFormValues = {
  name: "Orders",
  url: "https://example.com/hooks",
  allEvents: false,
  eventTypes: ["entry.created"],
  headers: [],
  clearExistingHeaders: false,
  enabled: true,
};

const endpoint: WebhookEndpointSummary = {
  id: "wh_1",
  name: "Orders",
  url: "https://example.com/hooks",
  enabled: true,
  eventTypes: ["entry.created"],
  headers: null,
  secretPrefix: "whsec_ab",
  createdBy: "u1",
  createdAt: "2026-07-24T00:00:00.000Z",
  updatedAt: "2026-07-24T00:00:00.000Z",
};

describe("webhookFormSchema", () => {
  it("accepts a valid form", () => {
    expect(webhookFormSchema.safeParse(base).success).toBe(true);
  });

  it("requires a name and caps its length", () => {
    expect(webhookFormSchema.safeParse({ ...base, name: "" }).success).toBe(
      false
    );
    expect(
      webhookFormSchema.safeParse({ ...base, name: "a".repeat(256) }).success
    ).toBe(false);
  });

  it("requires a valid https url within 2048 chars", () => {
    expect(
      webhookFormSchema.safeParse({ ...base, url: "not a url" }).success
    ).toBe(false);
    expect(
      webhookFormSchema.safeParse({
        ...base,
        url: `https://e.com/${"x".repeat(2048)}`,
      }).success
    ).toBe(false);
    // Only HTTPS — the delivery transport refuses other schemes.
    expect(
      webhookFormSchema.safeParse({ ...base, url: "http://example.com/hook" })
        .success
    ).toBe(false);
  });

  it("requires at least one event type unless allEvents", () => {
    expect(
      webhookFormSchema.safeParse({ ...base, eventTypes: [] }).success
    ).toBe(false);
    expect(
      webhookFormSchema.safeParse({ ...base, allEvents: true, eventTypes: [] })
        .success
    ).toBe(true);
  });

  it("rejects reserved, malformed, redacted, and duplicate headers", () => {
    const withHeader = (name: string, value: string): WebhookFormValues => ({
      ...base,
      headers: [{ name, value }],
    });
    expect(
      webhookFormSchema.safeParse(withHeader("webhook-id", "x")).success
    ).toBe(false);
    expect(
      webhookFormSchema.safeParse(withHeader("Content-Type", "x")).success
    ).toBe(false);
    expect(
      webhookFormSchema.safeParse(withHeader("Bad Name", "x")).success
    ).toBe(false);
    expect(
      webhookFormSchema.safeParse(withHeader("X-Token", "<redacted>")).success
    ).toBe(false);
    expect(
      webhookFormSchema.safeParse({
        ...base,
        headers: [
          { name: "X-Token", value: "a" },
          { name: "x-token", value: "b" },
        ],
      }).success
    ).toBe(false);
  });

  it("accepts an empty header value (the server does too)", () => {
    expect(
      webhookFormSchema.safeParse({
        ...base,
        headers: [{ name: "X-Token", value: "" }],
      }).success
    ).toBe(true);
  });
});

describe("toCreateInput", () => {
  it("maps allEvents to the wildcard and omits empty headers", () => {
    const out = toCreateInput({ ...base, allEvents: true, eventTypes: [] });
    expect(out.eventTypes).toEqual(["*"]);
    expect(out.headers).toBeUndefined();
    expect(out).toMatchObject({ name: "Orders", enabled: true });
  });

  it("builds a header record from named rows", () => {
    const out = toCreateInput({
      ...base,
      headers: [{ name: "X-Token", value: "abc" }],
    });
    expect(out.headers).toEqual({ "X-Token": "abc" });
  });
});

describe("toUpdateInput", () => {
  it("sends only changed fields and never touches untouched headers", () => {
    const out = toUpdateInput(
      { ...base, name: "Renamed" },
      { original: endpoint }
    );
    expect(out).toEqual({ name: "Renamed" });
    expect("headers" in out).toBe(false);
  });

  it("replaces the header set when rows are entered", () => {
    const out = toUpdateInput(
      { ...base, headers: [{ name: "X-Token", value: "new" }] },
      { original: endpoint }
    );
    expect(out.headers).toEqual({ "X-Token": "new" });
  });

  it("clears headers when the remove-all flag is set", () => {
    const out = toUpdateInput(
      { ...base, clearExistingHeaders: true },
      { original: endpoint }
    );
    expect(out.headers).toBeNull();
  });

  it("lets the remove-all flag win over any stale rows", () => {
    const out = toUpdateInput(
      {
        ...base,
        clearExistingHeaders: true,
        headers: [{ name: "X-Token", value: "stale" }],
      },
      { original: endpoint }
    );
    expect(out.headers).toBeNull();
  });

  it("keeps headers when neither rows nor the clear flag are present", () => {
    const out = toUpdateInput(
      { ...base, name: "Renamed" },
      {
        original: endpoint,
      }
    );
    expect("headers" in out).toBe(false);
  });
});

describe("toFormValues", () => {
  it("starts headers empty and detects the wildcard", () => {
    const values = toFormValues({
      ...endpoint,
      eventTypes: ["*"],
      headers: { "X-Token": "<redacted>" },
    });
    expect(values.allEvents).toBe(true);
    expect(values.eventTypes).toEqual([]);
    // Editable headers start empty; the edit page shows current names read-only.
    expect(values.headers).toEqual([]);
  });
});
