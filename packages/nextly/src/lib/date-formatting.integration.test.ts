import { beforeEach, describe, expect, it } from "vitest";

import {
  formatGlobalDateTime,
  setGlobalDateTimeConfig,
} from "../../../admin/src/utils/globalDateTime";
import { container } from "../di/container";

import {
  normalizeTimestampsInPayload,
  withTimezoneFormatting,
} from "./date-formatting";

describe("date formatting integration (API -> admin)", () => {
  beforeEach(() => {
    // Keep tests deterministic and avoid cross-test config bleed.
    setGlobalDateTimeConfig({});
    container.clear();
  });

  it("keeps admin display consistent for the same payload after API normalization", () => {
    const payload = {
      createdAt: "2026-04-03T12:34:56",
      nested: {
        updatedAt: "2026-04-03 18:00:00",
      },
    };

    const timezone = "America/New_York";

    const normalized = normalizeTimestampsInPayload(payload, timezone) as {
      createdAt: string;
      nested: { updatedAt: string };
    };

    setGlobalDateTimeConfig({
      timezone,
      dateFormat: "YYYY-MM-DD",
      timeFormat: "24h",
      locale: "en-US",
    });

    const fromOriginalCreatedAt = formatGlobalDateTime(payload.createdAt);
    const fromNormalizedCreatedAt = formatGlobalDateTime(normalized.createdAt);
    const fromOriginalUpdatedAt = formatGlobalDateTime(
      payload.nested.updatedAt
    );
    const fromNormalizedUpdatedAt = formatGlobalDateTime(
      normalized.nested.updatedAt
    );

    expect(normalized.createdAt).toMatch(/[+-]\d{2}:\d{2}|Z$/);
    expect(normalized.nested.updatedAt).toMatch(/[+-]\d{2}:\d{2}|Z$/);

    expect(fromNormalizedCreatedAt).toBe(fromOriginalCreatedAt);
    expect(fromNormalizedUpdatedAt).toBe(fromOriginalUpdatedAt);
  });

  it("applies localization/time settings changes immediately", () => {
    const value = "2026-04-03T12:34:56";

    setGlobalDateTimeConfig({
      timezone: "America/New_York",
      dateFormat: "YYYY-MM-DD",
      timeFormat: "24h",
      locale: "en-US",
    });
    const firstRender = formatGlobalDateTime(value);

    setGlobalDateTimeConfig({
      timezone: "Asia/Tokyo",
      dateFormat: "MM/DD/YYYY",
      timeFormat: "12h",
      locale: "en-US",
    });
    const secondRender = formatGlobalDateTime(value);

    expect(secondRender).not.toBe(firstRender);
  });

  it("keeps displayed UI value consistent with API returned timestamp", async () => {
    let activeTimezone = "America/New_York";
    container.registerSingleton("generalSettingsService", () => ({
      getTimezone: async () => activeTimezone,
    }));

    const originalPayload = {
      data: {
        data: {
          createdAt: "2026-04-03T12:34:56",
        },
      },
    };

    const apiResponse = new Response(JSON.stringify(originalPayload), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });

    const transformedResponse = await withTimezoneFormatting(apiResponse);
    const transformedJson = (await transformedResponse.json()) as {
      data: { data: { createdAt: string } };
    };

    setGlobalDateTimeConfig({
      timezone: activeTimezone,
      dateFormat: "YYYY-MM-DD",
      timeFormat: "24h",
      locale: "en-US",
    });

    const uiFromOriginal = formatGlobalDateTime(
      originalPayload.data.data.createdAt
    );
    const uiFromApi = formatGlobalDateTime(transformedJson.data.data.createdAt);

    expect(transformedJson.data.data.createdAt).toMatch(/[+-]\d{2}:\d{2}|Z$/);
    expect(uiFromApi).toBe(uiFromOriginal);

    activeTimezone = "Asia/Tokyo";
    const transformedAgain = await withTimezoneFormatting(
      new Response(JSON.stringify(originalPayload), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      })
    );
    const transformedAgainJson = (await transformedAgain.json()) as {
      data: { data: { createdAt: string } };
    };

    expect(transformedAgainJson.data.data.createdAt).not.toBe(
      transformedJson.data.data.createdAt
    );
  });

  it("keeps unset timezone payloads in UTC", async () => {
    container.registerSingleton("generalSettingsService", () => ({
      getTimezone: async () => null,
    }));

    const payload = {
      data: {
        uploadedAt: "2026-04-03T12:34:56",
      },
    };

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
