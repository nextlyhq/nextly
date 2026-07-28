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

describe("populateTranslationStatus (failed overview reads)", () => {
  /** A db whose query rejects the way a permission or schema fault would. */
  function failingDb(message: string) {
    const rejection = () => {
      throw new Error(message);
    };
    return {
      select: () => ({ from: () => ({ where: rejection }) }),
    } as never;
  }

  const args = (strict: boolean, message: string) => ({
    db: failingDb(message),
    companionTable: { _parent: "p", _locale: "l" },
    localizedFields: [],
    rows: [{ id: "doc1" } as Record<string, unknown>],
    locales: ["en", "de"],
    defaultLocale: "en",
    hasStatus: true,
    strict,
  });

  it("leaves the rows untouched when a caller is not judging on them", () => {
    // The default stays forgiving: an ordinary read is still served when the
    // overview cannot be loaded.
    const rows = [{ id: "doc1" } as Record<string, unknown>];
    return expect(
      populateTranslationStatus({
        ...args(false, "permission denied for relation"),
        rows,
      })
    ).resolves.toBeUndefined();
  });

  it("surfaces the failure to a caller that will judge on the overview", async () => {
    // A rule reading `_translations` cannot tell an untranslated Single from
    // one whose overview simply failed to load, so the failure has to reach it.
    await expect(
      populateTranslationStatus(args(true, "permission denied for relation"))
    ).rejects.toThrow("permission denied");
  });

  it("still tolerates a companion table that does not exist yet", async () => {
    // A Single before its migration runs is not a fault.
    await expect(
      populateTranslationStatus(
        args(true, "no such table: single_branding_locales")
      )
    ).resolves.toBeUndefined();
  });
});
