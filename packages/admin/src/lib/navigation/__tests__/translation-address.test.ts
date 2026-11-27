/**
 * The translation page's address, and where an editor address naming a
 * language goes. Each form of old address has its own case, because the first
 * rule that matches wins: a wrong order sends a default-language link to a page
 * that translates nothing.
 */
import { describe, expect, it } from "vitest";

import {
  languageAddressMove,
  sourceFromAddress,
  translationAddress,
} from "../translation-address";

const LANGUAGES = {
  defaultLocale: "en",
  locales: [{ code: "en" }, { code: "es" }, { code: "ar" }],
};

const move = (search: string) =>
  languageAddressMove(new URLSearchParams(search), LANGUAGES);

describe("translationAddress", () => {
  it("names an entry by its id, and the target in the language key", () => {
    expect(
      translationAddress(
        { kind: "collection", slug: "posts", id: "p1" },
        { target: "es" }
      )
    ).toBe("/admin/translations/collections/posts/p1?locale=es");
  });

  it("carries a source other than the default", () => {
    expect(
      translationAddress(
        { kind: "collection", slug: "posts", id: "p1" },
        { target: "es", source: "ar" }
      )
    ).toBe("/admin/translations/collections/posts/p1?locale=es&source=ar");
  });

  it("names a Single by its slug alone", () => {
    expect(
      translationAddress({ kind: "single", slug: "banner" }, { target: "ar" })
    ).toBe("/admin/translations/singles/banner?locale=ar");
  });
});

describe("languageAddressMove", () => {
  it("sends the default language to the editor", () => {
    expect(move("?locale=en")).toEqual({ to: "editor" });
  });

  it("sends the default language to the editor with a source too", () => {
    // Before the source rule: the target is the default, whatever it names.
    expect(move("?locale=en&translate=es")).toEqual({ to: "editor" });
  });

  it("sends a language with a source to its page, from that source", () => {
    expect(move("?locale=es&translate=ar")).toEqual({
      to: "translation",
      pair: { target: "es", source: "ar" },
    });
  });

  it("sends a language alone to its page, from the default language", () => {
    expect(move("?locale=es")).toEqual({
      to: "translation",
      pair: { target: "es" },
    });
  });

  it("leaves the default source unsaid, so one pair has one address", () => {
    expect(move("?locale=es&translate=en")).toEqual(move("?locale=es"));
  });

  it("leaves an address naming no language as it is", () => {
    expect(move("?tab=content")).toBeUndefined();
    // A source with no target names no language either.
    expect(move("?translate=es")).toBeUndefined();
  });

  it("leaves a language the site does not have to the editor", () => {
    expect(move("?locale=xx")).toBeUndefined();
    expect(move("?locale=xx&translate=es")).toBeUndefined();
    expect(move("?locale=")).toBeUndefined();
  });

  it("takes a source the site does not have, or the target itself, as none", () => {
    const alone = { to: "translation", pair: { target: "es" } };
    expect(move("?locale=es&translate=xx")).toEqual(alone);
    expect(move("?locale=es&translate=es")).toEqual(alone);
  });

  it("counts a repeated key by its first value", () => {
    expect(move("?locale=es&locale=en")).toEqual({
      to: "translation",
      pair: { target: "es" },
    });
    expect(move("?locale=en&locale=es")).toEqual({ to: "editor" });
    expect(move("?locale=es&translate=ar&translate=en")).toEqual({
      to: "translation",
      pair: { target: "es", source: "ar" },
    });
  });
});

describe("sourceFromAddress", () => {
  it("takes a language the site has, other than the target", () => {
    expect(sourceFromAddress("ar", "es", LANGUAGES)).toBe("ar");
  });

  it("reads anything else as the default language", () => {
    expect(sourceFromAddress(null, "es", LANGUAGES)).toBeUndefined();
    expect(sourceFromAddress("es", "es", LANGUAGES)).toBeUndefined();
    expect(sourceFromAddress("xx", "es", LANGUAGES)).toBeUndefined();
    expect(sourceFromAddress("en", "es", LANGUAGES)).toBeUndefined();
  });
});
