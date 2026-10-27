import { describe, expect, it } from "vitest";

import {
  localizationFromStoredLanguages,
  type StoredLanguage,
} from "./stored-languages";

const row = (over: Partial<StoredLanguage>): StoredLanguage => ({
  code: "en",
  label: "English",
  direction: "ltr",
  fallback: "[]",
  position: 0,
  isDefault: false,
  active: true,
  ...over,
});

describe("the language list a site stores", () => {
  it("is no localization at all while nothing is stored", () => {
    expect(localizationFromStoredLanguages([])).toBeUndefined();
  });

  it("lists the active languages in their order, with the default and each one's direction", () => {
    expect(
      localizationFromStoredLanguages([
        row({ code: "ar", label: "Arabic", direction: "rtl", position: 2 }),
        row({ code: "en", isDefault: true, position: 0 }),
        row({ code: "fr", label: "French", position: 1, fallback: '["en"]' }),
      ])
    ).toEqual({
      defaultLocale: "en",
      fallback: true,
      locales: [
        { code: "en", label: "English", rtl: false, fallbackLocale: [] },
        { code: "fr", label: "French", rtl: false, fallbackLocale: ["en"] },
        { code: "ar", label: "Arabic", rtl: true, fallbackLocale: [] },
      ],
    });
  });

  it("leaves out a removed language, and skips it in the others' fallback lists", () => {
    const localization = localizationFromStoredLanguages([
      row({ code: "en", isDefault: true, position: 0 }),
      row({ code: "es", position: 1, active: false }),
      row({ code: "ca", position: 2, fallback: '["es","en"]' }),
    ]);

    expect(localization?.locales.map(l => l.code)).toEqual(["en", "ca"]);
    expect(localization?.locales[1].fallbackLocale).toEqual(["en"]);
  });

  it("is still a localization with one language, so translated content stays readable", () => {
    expect(
      localizationFromStoredLanguages([row({ code: "en", isDefault: true })])
        ?.locales
    ).toHaveLength(1);
  });

  it("reads a fallback list it cannot parse as none", () => {
    expect(
      localizationFromStoredLanguages([
        row({ code: "en", isDefault: true, fallback: "not json" }),
      ])?.locales[0].fallbackLocale
    ).toEqual([]);
  });
});
