import { afterEach, describe, expect, it } from "vitest";

import { formatGlobalDateTime, setGlobalDateTimeConfig } from "./dates/format";

describe("formatGlobalDateTime", () => {
  afterEach(() => {
    setGlobalDateTimeConfig({});
  });

  it("honors an explicit timeZone override", () => {
    const value = "2026-04-03T03:53:15.032Z";
    const date = new Date(value);

    setGlobalDateTimeConfig({
      timezone: "Asia/Dubai",
      locale: "en-US",
    });

    const expectedUtc = `${new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      dateStyle: "short",
    }).format(date)} ${new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      timeStyle: "short",
    }).format(date)}`;

    const expectedDubai = `${new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Dubai",
      dateStyle: "short",
    }).format(date)} ${new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Dubai",
      timeStyle: "short",
    }).format(date)}`;

    expect(
      formatGlobalDateTime(value, {
        dateStyle: "short",
        timeStyle: "short",
        timeZone: "UTC",
      })
    ).toBe(expectedUtc);

    expect(
      formatGlobalDateTime(value, {
        dateStyle: "short",
        timeStyle: "short",
      })
    ).toBe(expectedDubai);
  });
});
