import { describe, it, expect } from "vitest";

import { normalizeLocalization } from "./normalize";

describe("normalizeLocalization", () => {
  it("expands string locales to full objects with defaults", () => {
    const out = normalizeLocalization({
      locales: ["en", "de"],
      defaultLocale: "en",
    });
    expect(out.fallback).toBe(true);
    expect(out.locales).toEqual([
      { code: "en", label: "en", rtl: false, fallbackLocale: [] },
      { code: "de", label: "de", rtl: false, fallbackLocale: [] },
    ]);
    expect(out.defaultLocale).toBe("en");
  });

  it("keeps object locales and normalizes fallbackLocale to an array", () => {
    const out = normalizeLocalization({
      locales: [
        "en",
        { code: "de", label: "Deutsch" },
        { code: "de-CH", label: "Schweiz", rtl: false, fallbackLocale: "de" },
        { code: "ar", label: "العربية", rtl: true },
      ],
      defaultLocale: "en",
      fallback: false,
    });
    expect(out.fallback).toBe(false);
    expect(out.locales[1]).toEqual({
      code: "de",
      label: "Deutsch",
      rtl: false,
      fallbackLocale: [],
    });
    expect(out.locales[2].fallbackLocale).toEqual(["de"]);
    expect(out.locales[3].rtl).toBe(true);
  });
});
