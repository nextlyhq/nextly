import { describe, expect, it } from "vitest";

import { translatedValues } from "../held-addresses";

const slug = [{ name: "slug", column: "slug" }];
const chainOf = (language: string) =>
  language === "en" ? ["en"] : [language, "en"];

describe("a translated field's value in each language", () => {
  it("leaves the field to the main row where nothing could be read", () => {
    // A translations table not yet migrated reads no value at all: the
    // main row still holds the default language's, and it stands.
    const values = translatedValues(
      new Map([
        ["en", {}],
        ["fr", {}],
      ]),
      slug,
      ["en", "fr"],
      new Set(["en", "fr"]),
      chainOf
    );

    expect(values.get("en")).toEqual({});
    expect(values.get("fr")).toEqual({});
  });

  it("is null where the field was read and is untranslated, without fallback", () => {
    const values = translatedValues(
      new Map([
        ["en", { slug: "hello" }],
        ["fr", { slug: null }],
      ]),
      slug,
      ["en", "fr"],
      new Set(["en", "fr"]),
      language => [language]
    );

    expect(values.get("fr")).toEqual({ slug: null });
  });

  it("falls back to a live language's value", () => {
    const values = translatedValues(
      new Map([
        ["en", { slug: "hello" }],
        ["fr", { slug: null }],
      ]),
      slug,
      ["en", "fr"],
      new Set(["en", "fr"]),
      chainOf
    );

    expect(values.get("fr")).toEqual({ slug: "hello" });
  });
});
