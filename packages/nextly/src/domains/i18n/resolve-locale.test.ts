import { describe, it, expect } from "vitest";

import { normalizeLocalization } from "./config/normalize";
import {
  getDefaultLocale,
  isValidLocale,
  resolveRequestedLocale,
  resolveFallbackChain,
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
