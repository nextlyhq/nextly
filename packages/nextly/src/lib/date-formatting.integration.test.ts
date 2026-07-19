import { describe, expect, it, beforeEach } from "vitest";

import { container } from "../di/container";

import {
  normalizeTimestampsInPayload,
  withTimezoneFormatting,
} from "./date-formatting";

// This suite exercises the API-side timestamp contract that nextly owns.
// The admin panel has its own formatter tests in the admin package; nextly
// must not import admin source, so the assertions here verify nextly's real
// behavior with timezone-independent epoch/string checks rather than a
// display formatter.
//
// The contract (see `normalizeTimestampsInPayload`): a naive wall-clock
// string is read as UTC, and the value is re-rendered carrying the target
// timezone's offset. The instant it denotes never changes — only the offset
// suffix does — so a client knows which offset to display without the stored
// moment being shifted.

describe("date formatting (API normalization contract)", () => {
  beforeEach(() => {
    container.clear();
  });

  it("re-renders a naive timestamp with the timezone's offset without moving the instant", () => {
    const payload = {
      createdAt: "2026-04-03T12:34:56",
      nested: { updatedAt: "2026-04-03 18:00:00" },
    };
    const normalized = normalizeTimestampsInPayload(
      payload,
      "America/New_York"
    ) as { createdAt: string; nested: { updatedAt: string } };

    // Carries an explicit offset (or Z), so it is an unambiguous instant.
    expect(normalized.createdAt).toMatch(/[+-]\d{2}:\d{2}|Z$/);
    expect(normalized.nested.updatedAt).toMatch(/[+-]\d{2}:\d{2}|Z$/);

    // The instant equals the source read as UTC (naive input is treated as
    // UTC; only the rendered offset changes).
    expect(new Date(normalized.createdAt).getTime()).toBe(
      Date.parse("2026-04-03T12:34:56Z")
    );
    expect(new Date(normalized.nested.updatedAt).getTime()).toBe(
      Date.parse("2026-04-03T18:00:00Z")
    );

    // And it renders with New York's offset in early April (EDT, -04:00).
    expect(normalized.createdAt).toContain("-04:00");
  });

  it("changes the rendered offset per timezone while preserving the instant", () => {
    const value = { createdAt: "2026-04-03T12:34:56" };

    const inNewYork = normalizeTimestampsInPayload(
      value,
      "America/New_York"
    ) as { createdAt: string };
    const inTokyo = normalizeTimestampsInPayload(value, "Asia/Tokyo") as {
      createdAt: string;
    };

    // Same moment in time, different offset labels.
    expect(new Date(inNewYork.createdAt).getTime()).toBe(
      new Date(inTokyo.createdAt).getTime()
    );
    expect(inNewYork.createdAt).not.toBe(inTokyo.createdAt);
    expect(inNewYork.createdAt).toContain("-04:00");
    expect(inTokyo.createdAt).toContain("+09:00");
  });

  it("transforms nested timestamps on a Response using the configured timezone", async () => {
    let activeTimezone = "America/New_York";
    container.registerSingleton("generalSettingsService", () => ({
      getTimezone: async () => activeTimezone,
    }));

    const originalPayload = {
      data: { data: { createdAt: "2026-04-03T12:34:56" } },
    };

    const transformed = await withTimezoneFormatting(
      new Response(JSON.stringify(originalPayload), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      })
    );
    const json = (await transformed.json()) as {
      data: { data: { createdAt: string } };
    };

    expect(json.data.data.createdAt).toMatch(/[+-]\d{2}:\d{2}|Z$/);
    expect(json.data.data.createdAt).toContain("-04:00");

    // Switching the configured timezone re-renders the same instant with a
    // different offset.
    activeTimezone = "Asia/Tokyo";
    const transformedAgain = await withTimezoneFormatting(
      new Response(JSON.stringify(originalPayload), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      })
    );
    const jsonAgain = (await transformedAgain.json()) as {
      data: { data: { createdAt: string } };
    };

    expect(new Date(jsonAgain.data.data.createdAt).getTime()).toBe(
      new Date(json.data.data.createdAt).getTime()
    );
    expect(jsonAgain.data.data.createdAt).not.toBe(json.data.data.createdAt);
    expect(jsonAgain.data.data.createdAt).toContain("+09:00");
  });

  it("keeps unset-timezone payloads in UTC", async () => {
    container.registerSingleton("generalSettingsService", () => ({
      getTimezone: async () => null,
    }));

    const payload = { data: { uploadedAt: "2026-04-03T12:34:56" } };

    const transformed = await withTimezoneFormatting(
      new Response(JSON.stringify(payload), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      })
    );
    const json = (await transformed.json()) as { data: { uploadedAt: string } };

    expect(json.data.uploadedAt).toBe("2026-04-03T12:34:56.000Z");
  });
});
