import { afterEach, describe, expect, it, vi } from "vitest";

import * as locales from "../../i18n/configured-locales";
import { publishedIn } from "../held-addresses";

/** A site in English and French, English the default. */
function englishAndFrench() {
  vi.spyOn(locales, "appLocalization").mockReturnValue({
    locales: [
      { code: "en", label: "English", rtl: false, fallbackLocale: [] },
      { code: "fr", label: "French", rtl: false, fallbackLocale: [] },
    ],
    defaultLocale: "en",
    fallback: true,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("whether a document is published in a language", () => {
  it("is the main row's answer for the default language with no status of its own", () => {
    englishAndFrench();
    expect(
      publishedIn("en", {
        lifecycle: true,
        mainStatus: "published",
        ownStatus: new Map([["fr", "draft"]]),
      })
    ).toBe(true);
  });

  it("is never published in any language while the main row is withdrawn", () => {
    englishAndFrench();
    expect(
      publishedIn("fr", {
        lifecycle: true,
        mainStatus: "draft",
        ownStatus: new Map([["fr", "published"]]),
      })
    ).toBe(false);
  });

  it("is not published in another language with no row of its own", () => {
    englishAndFrench();
    expect(
      publishedIn("fr", {
        lifecycle: true,
        mainStatus: "published",
        ownStatus: new Map([["en", "published"]]),
      })
    ).toBe(false);
  });

  it("is always published for a type without Draft/Published", () => {
    englishAndFrench();
    expect(
      publishedIn("fr", {
        lifecycle: false,
        mainStatus: undefined,
        ownStatus: undefined,
      })
    ).toBe(true);
  });
});
