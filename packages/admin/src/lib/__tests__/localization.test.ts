/**
 * When a site counts as multilingual, which decides whether the rail offers
 * Translations and whether the editor offers a language switcher.
 */
import { describe, expect, it } from "vitest";

import { isMultilingual, type LocalizationConfig } from "../localization";

function withLocales(...codes: string[]): LocalizationConfig {
  return {
    defaultLocale: codes[0] ?? "en",
    fallback: true,
    locales: codes.map(code => ({
      code,
      label: code.toUpperCase(),
      rtl: false,
      fallbackLocale: [],
    })),
  };
}

describe("isMultilingual", () => {
  it("is false for a site with no localization config", () => {
    expect(isMultilingual(undefined)).toBe(false);
  });

  it("is false for a config naming no locales", () => {
    expect(isMultilingual(withLocales())).toBe(false);
  });

  it("is false for a single locale, which has nothing to translate into", () => {
    expect(isMultilingual(withLocales("en"))).toBe(false);
  });

  it("is true from two locales up", () => {
    expect(isMultilingual(withLocales("en", "fr"))).toBe(true);
    expect(isMultilingual(withLocales("en", "fr", "de"))).toBe(true);
  });
});
