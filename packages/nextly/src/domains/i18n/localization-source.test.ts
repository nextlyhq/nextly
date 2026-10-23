import { describe, expect, it } from "vitest";

import type { SanitizedLocalizationConfig } from "./config/types";
import { localizationNow } from "./localization-source";

const block: SanitizedLocalizationConfig = {
  locales: [{ code: "en", label: "English", rtl: false, fallbackLocale: [] }],
  defaultLocale: "en",
  fallback: true,
};

describe("a service's localization source", () => {
  it("is the block itself when handed a block, and nothing when handed nothing", () => {
    expect(localizationNow(block)).toBe(block);
    expect(localizationNow(undefined)).toBeUndefined();
  });

  it("asks a live source each time, so a change after the service was built reaches it", () => {
    let now: SanitizedLocalizationConfig | undefined;
    const live = { current: () => now };

    expect(localizationNow(live)).toBeUndefined();
    now = block;
    expect(localizationNow(live)).toBe(block);
  });
});
