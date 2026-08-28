/**
 * Guards reading a comparison out of the address bar.
 *
 * The pair lives in the URL so it can be shared, which means anyone can type
 * it. These functions therefore treat the query as untrusted input: the
 * headline is that nothing a person can put in the address bar reaches a
 * request as a version number, and that arriving without a pair still shows
 * something useful rather than an error.
 */
import { describe, expect, it } from "vitest";

import {
  readLocaleParam,
  readVersionParam,
  resolvePair,
} from "../version-search-params";

describe("readVersionParam", () => {
  it("reads a version number", () => {
    expect(readVersionParam("7")).toBe(7);
  });

  it("takes the first value of a repeated parameter, as a browser does", () => {
    expect(readVersionParam(["3", "9"])).toBe(3);
  });

  it("rejects anything that is not a version number", () => {
    // Version numbers start at one, so zero and negatives are as meaningless
    // as a word and must not reach a request.
    for (const value of ["0", "-1", "1.5", "abc", "", "  ", "1e3abc"]) {
      expect(readVersionParam(value)).toBeUndefined();
    }
  });

  it("is undefined when the parameter is absent", () => {
    expect(readVersionParam(undefined)).toBeUndefined();
    expect(readVersionParam([])).toBeUndefined();
  });
});

describe("resolvePair", () => {
  /** A history of one locale, newest first. */
  const rows = (...numbers: number[]) =>
    numbers.map(versionNo => ({ versionNo, locale: null }));

  it("takes the pair the URL names", () => {
    expect(resolvePair(rows(9, 8, 7), 7, 9, false)).toEqual({
      kind: "pair",
      from: 7,
      to: 9,
    });
  });

  it("defaults to the two newest versions when the URL names none", () => {
    // Arriving without a pair is the ordinary case, and the most recent change
    // is what that reader came for.
    expect(resolvePair(rows(9, 8, 7), undefined, undefined, false)).toEqual({
      kind: "pair",
      from: 8,
      to: 9,
    });
  });

  it("honours a named pair that is not in the loaded page of history", () => {
    // History is paginated. Refusing an older pair because it has not been
    // fetched yet would break exactly the shared link this supports; the
    // request that follows is what decides whether those versions exist.
    expect(resolvePair(rows(9, 8), 2, 3, true)).toEqual({
      kind: "pair",
      from: 2,
      to: 3,
    });
  });

  it("refuses when only one half is named, rather than inventing the other", () => {
    expect(resolvePair(rows(9, 8), 5, undefined, false)).toEqual({
      kind: "pair",
      from: 8,
      to: 9,
    });
    expect(resolvePair(rows(9, 8), undefined, 5, false)).toEqual({
      kind: "pair",
      from: 8,
      to: 9,
    });
  });

  it("has nothing to compare with a single version", () => {
    expect(resolvePair(rows(1), undefined, undefined, false)).toEqual({
      kind: "only-version",
    });
    expect(resolvePair([], undefined, undefined, false)).toEqual({
      kind: "no-history",
    });
  });

  it("MUST NOT default to a pair spanning two locales", () => {
    // The server rejects a cross-locale pair outright, so defaulting to the two
    // newest ROWS renders an API error on a page opened with no parameters —
    // which is how every reader arrives from the history panel.
    const interleaved = [
      { versionNo: 5, locale: "en" },
      { versionNo: 4, locale: "fr" },
      { versionNo: 3, locale: "en" },
    ];
    expect(resolvePair(interleaved, undefined, undefined, false)).toEqual({
      kind: "pair",
      from: 3,
      to: 5,
    });
  });

  it("refuses a default when the newest version's predecessor has not loaded", () => {
    // Its locale has one loaded row and more pages exist, so whether anything
    // older exists is not yet known. Guessing the row below is what produced a
    // cross-locale pair.
    const interleaved = [
      { versionNo: 5, locale: "en" },
      { versionNo: 4, locale: "fr" },
    ];
    expect(resolvePair(interleaved, undefined, undefined, true)).toEqual({
      kind: "not-loaded",
    });
  });
});

describe("readLocaleParam", () => {
  /**
   * A version's locale decides which text the document HAS, so it decides what
   * the document is called. It is carried in the address rather than inferred
   * because the page is addressable: a link shared from a French history has
   * to open the French comparison, named in French, for a reader whose editor
   * was last in English.
   */
  it("takes a locale the address names", () => {
    expect(readLocaleParam("fr")).toBe("fr");
    expect(readLocaleParam("  fr  ")).toBe("fr");
  });

  /**
   * Absent means the default language, which is what the server resolves when
   * none is asked for — so a non-localized document needs no parameter. An
   * EMPTY one is not a language either: it reads as a locale that failed to
   * resolve rather than one never asked for.
   */
  it("treats absent and empty alike, as no locale at all", () => {
    expect(readLocaleParam(undefined)).toBeUndefined();
    expect(readLocaleParam("")).toBeUndefined();
    expect(readLocaleParam("   ")).toBeUndefined();
  });

  /** A repeated parameter is ambiguous, and guessing which one is meant is
   *  worse than answering with the default. */
  it("refuses a repeated parameter rather than picking one", () => {
    expect(readLocaleParam(["fr", "en"])).toBeUndefined();
  });
});
