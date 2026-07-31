import { describe, it, expect } from "vitest";

import {
  populateTranslationStatus,
  resolveLocalizedValue,
} from "./companion-join";

describe("resolveLocalizedValue (fallback chain, blank = untranslated)", () => {
  it("returns the requested locale's value when present", () => {
    expect(
      resolveLocalizedValue({ de: "Hallo", en: "Hello" }, ["de", "en"])
    ).toBe("Hallo");
  });

  it("falls back to the next chain locale when the requested value is blank (empty string)", () => {
    expect(resolveLocalizedValue({ de: "", en: "Hello" }, ["de", "en"])).toBe(
      "Hello"
    );
  });

  it("falls back when the requested value is null/undefined (no row)", () => {
    expect(resolveLocalizedValue({ en: "Hello" }, ["de", "en"])).toBe("Hello");
    expect(resolveLocalizedValue({ de: null, en: "Hello" }, ["de", "en"])).toBe(
      "Hello"
    );
  });

  it("walks a multi-locale chain to the first non-blank value", () => {
    expect(
      resolveLocalizedValue({ "de-CH": "", de: "", en: "Hi" }, [
        "de-CH",
        "de",
        "en",
      ])
    ).toBe("Hi");
    expect(
      resolveLocalizedValue({ "de-CH": "", de: "Hallo", en: "Hi" }, [
        "de-CH",
        "de",
        "en",
      ])
    ).toBe("Hallo");
  });

  it("returns null when nothing along the chain has a value", () => {
    expect(resolveLocalizedValue({ de: "", en: "" }, ["de", "en"])).toBeNull();
    expect(resolveLocalizedValue({}, ["de", "en"])).toBeNull();
  });

  it("with a single-element chain (fallback=none) does NOT fall back — returns the raw value", () => {
    expect(resolveLocalizedValue({ de: "", en: "Hello" }, ["de"])).toBeNull();
    expect(resolveLocalizedValue({ de: "Hallo", en: "Hello" }, ["de"])).toBe(
      "Hallo"
    );
  });

  it("treats 0 and false as real values (only null/undefined/'' are blank)", () => {
    expect(resolveLocalizedValue({ de: 0, en: 5 }, ["de", "en"])).toBe(0);
    expect(resolveLocalizedValue({ de: false, en: true }, ["de", "en"])).toBe(
      false
    );
  });
});

describe("populateTranslationStatus (read failures)", () => {
  /** A db whose query rejects the way a permission or schema fault would. */
  function failingDb(message: string) {
    const rejection = () => {
      throw new Error(message);
    };
    return {
      select: () => ({ from: () => ({ where: rejection }) }),
    } as never;
  }

  const args = (
    readiness: "ready" | "pre-migration" | undefined,
    message: string
  ) => ({
    db: failingDb(message),
    companionTable: { _parent: "p", _locale: "l" },
    localizedFields: [],
    rows: [{ id: "doc1" } as Record<string, unknown>],
    locales: ["en", "de"],
    defaultLocale: "en",
    hasStatus: true,
    readiness,
  });

  it("surfaces every failure once the companion is ready", async () => {
    // A rule reading `_translations` cannot tell an untranslated Single from one whose overview
    // simply failed to load, so the failure has to reach it. There is no tolerated class left:
    // the missing-table case is decided before the query rather than caught after it.
    for (const message of [
      "permission denied for relation",
      "no such table: single_branding_locales",
    ]) {
      await expect(
        populateTranslationStatus(args("ready", message))
      ).rejects.toThrow(message);
    }
  });

  it("issues no query at all before the companion migration has run", async () => {
    // A Single before its migration is not a fault, and it is also not something to find out by
    // failing: on PostgreSQL a failed statement aborts the caller's whole transaction.
    await expect(
      populateTranslationStatus(args("pre-migration", "must not be issued"))
    ).resolves.toBeUndefined();
    await expect(
      populateTranslationStatus(args(undefined, "must not be issued"))
    ).resolves.toBeUndefined();
  });
});
