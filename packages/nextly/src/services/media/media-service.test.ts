import { describe, expect, it } from "vitest";

import { toMediaDate } from "./media-service";

describe("toMediaDate", () => {
  it("preserves an existing Date instant", () => {
    const value = new Date("2026-04-03T03:53:15.032Z");

    expect(toMediaDate(value).toISOString()).toBe("2026-04-03T03:53:15.032Z");
  });
});
