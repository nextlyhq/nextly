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
});
