import { describe, it, expect } from "vitest";

import { defineConfig } from "../../../collections/config/define-config";
import { sanitizeConfig } from "../config";

describe("localization in config", () => {
  it("sanitizeConfig normalizes the localization block", () => {
    const c = sanitizeConfig({
      localization: { locales: ["en", "de"], defaultLocale: "en" },
    });
    expect(c.localization?.fallback).toBe(true);
    expect(c.localization?.locales.map(l => l.code)).toEqual(["en", "de"]);
  });

  it("no localization key => undefined (backward compatible)", () => {
    expect(sanitizeConfig({}).localization).toBeUndefined();
  });

  it("defineConfig throws on an invalid localization block", () => {
    expect(() =>
      defineConfig({ localization: { locales: ["en"], defaultLocale: "fr" } })
    ).toThrow(/defaultLocale/i);
  });
});
