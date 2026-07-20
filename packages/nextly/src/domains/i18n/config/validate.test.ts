import { describe, it, expect } from "vitest";

import { validateLocalizationConfig } from "./validate";

describe("validateLocalizationConfig", () => {
  it("accepts a valid config", () => {
    expect(() =>
      validateLocalizationConfig({
        locales: ["en", { code: "de-CH", fallbackLocale: "de" }, "de"],
        defaultLocale: "en",
      })
    ).not.toThrow();
  });

  it("rejects an empty locales list", () => {
    expect(() =>
      validateLocalizationConfig({ locales: [], defaultLocale: "en" })
    ).toThrow(/at least one locale/i);
  });

  it("rejects duplicate locale codes", () => {
    expect(() =>
      validateLocalizationConfig({ locales: ["en", "en"], defaultLocale: "en" })
    ).toThrow(/duplicate locale/i);
  });

  it("rejects a defaultLocale not in locales", () => {
    expect(() =>
      validateLocalizationConfig({ locales: ["en"], defaultLocale: "fr" })
    ).toThrow(/defaultLocale.*fr/i);
  });

  it("rejects a fallbackLocale that references an unknown code", () => {
    expect(() =>
      validateLocalizationConfig({
        locales: [{ code: "de-CH", fallbackLocale: "de" }, "en"],
        defaultLocale: "en",
      })
    ).toThrow(/fallbackLocale.*de/i);
  });

  // M10: reject empty/whitespace/junk codes and case-insensitive duplicates.
  it("rejects an empty locale code", () => {
    expect(() =>
      validateLocalizationConfig({ locales: [""], defaultLocale: "" })
    ).toThrow(/invalid locale code/i);
  });

  it("rejects a whitespace-only or malformed code", () => {
    expect(() =>
      validateLocalizationConfig({ locales: ["en", " "], defaultLocale: "en" })
    ).toThrow(/invalid locale code/i);
    expect(() =>
      validateLocalizationConfig({
        locales: ["en", "not a code!!"],
        defaultLocale: "en",
      })
    ).toThrow(/invalid locale code/i);
  });

  it("rejects case-insensitive duplicate codes (en / EN)", () => {
    expect(() =>
      validateLocalizationConfig({ locales: ["en", "EN"], defaultLocale: "en" })
    ).toThrow(/duplicate locale/i);
  });

  // L18: a locale falling back to itself is rejected.
  it("rejects a self-referential fallbackLocale", () => {
    expect(() =>
      validateLocalizationConfig({
        locales: [{ code: "de", fallbackLocale: "de" }, "en"],
        defaultLocale: "en",
      })
    ).toThrow(/itself as a fallbackLocale/i);
  });

  // L19: a missing/non-array locales yields the descriptive error, not a TypeError.
  it("gives a descriptive error when locales is missing", () => {
    expect(() =>
      validateLocalizationConfig({
        defaultLocale: "en",
      } as unknown as Parameters<typeof validateLocalizationConfig>[0])
    ).toThrow(/at least one locale/i);
  });
});
