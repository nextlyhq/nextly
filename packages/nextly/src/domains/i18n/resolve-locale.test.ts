import { describe, it, expect } from "vitest";

import { normalizeLocalization } from "./config/normalize";
import {
  getDefaultLocale,
  isValidLocale,
  resolveRequestedLocale,
  resolveFallbackChain,
  resolveLocaleChain,
} from "./resolve-locale";

const cfg = normalizeLocalization({
  locales: ["en", { code: "de-CH", fallbackLocale: ["de"] }, "de"],
  defaultLocale: "en",
});

describe("resolve-locale", () => {
  it("getDefaultLocale returns the configured default", () => {
    expect(getDefaultLocale(cfg)).toBe("en");
  });

  it("isValidLocale checks membership", () => {
    expect(isValidLocale(cfg, "de")).toBe(true);
    expect(isValidLocale(cfg, "fr")).toBe(false);
  });

  it("resolveRequestedLocale falls back to default for unknown/undefined", () => {
    expect(resolveRequestedLocale(cfg, "de")).toBe("de");
    expect(resolveRequestedLocale(cfg, "fr")).toBe("en");
    expect(resolveRequestedLocale(cfg, undefined)).toBe("en");
  });

  it("resolveFallbackChain walks the chain then defaultLocale, deduped", () => {
    expect(resolveFallbackChain(cfg, "de-CH")).toEqual(["de-CH", "de", "en"]);
    expect(resolveFallbackChain(cfg, "en")).toEqual(["en"]);
  });
});

/**
 * The chain a READ resolves through. One function because three services
 * asked this question with three private copies, and a copy that drifts
 * answers a translated field differently on a collection than on a single —
 * silently, since both copies look correct.
 */
describe("resolveLocaleChain", () => {
  it("is null with no localization, and null for every-translation", () => {
    // No single language to resolve for: the caller populates every locale
    // keyed by code instead, and a chain would be the wrong shape.
    expect(resolveLocaleChain(undefined, "de", undefined)).toBeNull();
    expect(resolveLocaleChain(cfg, "all", undefined)).toBeNull();
  });

  it("follows the requested locale's configured chain by default", () => {
    expect(resolveLocaleChain(cfg, "de-CH", undefined)).toEqual([
      "de-CH",
      "de",
      "en",
    ]);
  });

  it("resolves an unknown or absent locale to the default first", () => {
    expect(resolveLocaleChain(cfg, "fr", undefined)).toEqual(["en"]);
    expect(resolveLocaleChain(cfg, undefined, undefined)).toEqual(["en"]);
  });

  it("a per-request opt-out is the requested locale alone", () => {
    // The admin editor asks for this so an untranslated field reads blank
    // rather than showing the fallback as if it were a translation.
    expect(resolveLocaleChain(cfg, "de-CH", false)).toEqual(["de-CH"]);
    expect(resolveLocaleChain(cfg, "de-CH", "none")).toEqual(["de-CH"]);
  });

  it("a named per-request fallback replaces the configured chain", () => {
    // `?locale=de-CH&fallback-locale=en`: the requested locale, then the NAMED
    // fallback's own chain — not de-CH's configured chain through `de`.
    expect(resolveLocaleChain(cfg, "de-CH", "en")).toEqual(["de-CH", "en"]);
  });

  it("dedupes a named fallback that is the requested locale itself", () => {
    expect(resolveLocaleChain(cfg, "de", "de")).toEqual(["de", "en"]);
  });

  it("ignores a named fallback that is not a configured locale", () => {
    // Falls through to the configured chain rather than binding an unknown
    // code into the query.
    expect(resolveLocaleChain(cfg, "de-CH", "fr")).toEqual([
      "de-CH",
      "de",
      "en",
    ]);
  });

  it("the global fallback switch off is the requested locale alone", () => {
    const noFallback = normalizeLocalization({
      locales: ["en", { code: "de-CH", fallbackLocale: ["de"] }, "de"],
      defaultLocale: "en",
      fallback: false,
    });
    expect(resolveLocaleChain(noFallback, "de-CH", undefined)).toEqual([
      "de-CH",
    ]);
  });

  it("a named per-request fallback re-enables the chain under the global switch", () => {
    const noFallback = normalizeLocalization({
      locales: ["en", { code: "de-CH", fallbackLocale: ["de"] }, "de"],
      defaultLocale: "en",
      fallback: false,
    });
    // The per-request name is judged BEFORE the global switch, so a caller
    // that asks for a specific fallback gets it even where the site default is
    // no fallback at all.
    expect(resolveLocaleChain(noFallback, "de-CH", "en")).toEqual([
      "de-CH",
      "en",
    ]);
  });
});
