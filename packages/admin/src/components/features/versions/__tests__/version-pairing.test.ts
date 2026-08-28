/**
 * Guards which version a version is compared against.
 *
 * Two properties, and they fail in opposite directions. A pair must stay within
 * ONE LOCALE — the server rejects a cross-locale pair, so getting this wrong
 * renders an API error where a comparison should be. And a predecessor that has
 * merely not LOADED must not be reported as one that does not exist, because
 * that tells a reader a version with older siblings is the first ever recorded
 * and then makes selecting it do nothing.
 */
import { describe, expect, it } from "vitest";

import {
  defaultPair,
  predecessorOf,
  sameLocaleVersions,
} from "../version-pairing";

/** A history with no locales at all, which is every non-localized document. */
const plain = (...numbers: number[]) =>
  numbers.map(versionNo => ({ versionNo, locale: null }));

/** English and French interleaved in one numbered history, newest first. */
const interleaved = [
  { versionNo: 5, locale: "en" },
  { versionNo: 4, locale: "fr" },
  { versionNo: 3, locale: "en" },
  { versionNo: 2, locale: "fr" },
];

describe("predecessorOf — within one locale", () => {
  it("takes the next-older row on a document with no locales", () => {
    expect(predecessorOf(plain(9, 8, 7), 9, false)).toEqual({
      kind: "version",
      versionNo: 8,
    });
  });

  it("MUST NOT pair across locales", () => {
    // The row below v5 is French. Pairing them is rejected by the server, so
    // this is an API error rather than a comparison.
    expect(predecessorOf(interleaved, 5, false)).toEqual({
      kind: "version",
      versionNo: 3,
    });
    expect(predecessorOf(interleaved, 4, false)).toEqual({
      kind: "version",
      versionNo: 2,
    });
  });

  it("treats an absent locale and a null locale as one locale", () => {
    const mixed = [{ versionNo: 9 }, { versionNo: 8, locale: null }];
    expect(predecessorOf(mixed, 9, false)).toEqual({
      kind: "version",
      versionNo: 8,
    });
  });

  it("is the next-older row in the set, never `versionNo - 1`", () => {
    // Retention prunes old versions and leaves gaps, so arithmetic on the
    // number names a version that may no longer exist and would 404.
    expect(predecessorOf(plain(9, 4), 9, false)).toEqual({
      kind: "version",
      versionNo: 4,
    });
  });

  it("skips autosave rows, which carry no version number to compare", () => {
    const withAutosave = [
      { versionNo: 9, locale: null },
      { versionNo: null, locale: null },
      { versionNo: 8, locale: null },
    ];
    expect(predecessorOf(withAutosave, 9, false)).toEqual({
      kind: "version",
      versionNo: 8,
    });
  });
});

describe("predecessorOf — what has not loaded", () => {
  it("says UNKNOWN at a pagination boundary rather than `first`", () => {
    // The oldest loaded row of its locale, with pages still unfetched. Calling
    // this the first recorded version is a claim about the document made from
    // the scroll position.
    expect(predecessorOf(plain(9, 8), 8, true)).toEqual({ kind: "unknown" });
  });

  it("says FIRST once the history is exhausted", () => {
    expect(predecessorOf(plain(9, 8), 8, false)).toEqual({ kind: "first" });
  });

  it("says UNKNOWN when the locale has one loaded row but more pages exist", () => {
    // Interleaving puts a predecessor beyond the page long before the selected
    // row is the last one loaded overall — v4 is not the bottom row, and its
    // French predecessor is still unfetched.
    const oneFrench = [
      { versionNo: 5, locale: "en" },
      { versionNo: 4, locale: "fr" },
      { versionNo: 3, locale: "en" },
    ];
    expect(predecessorOf(oneFrench, 4, true)).toEqual({ kind: "unknown" });
  });

  it("says UNKNOWN for a version that is not loaded at all", () => {
    expect(predecessorOf(plain(9, 8), 2, false)).toEqual({ kind: "unknown" });
  });
});

describe("sameLocaleVersions", () => {
  it("keeps only the anchor's own locale, newest first", () => {
    expect(sameLocaleVersions(interleaved, 5).map(v => v.versionNo)).toEqual([
      5, 3,
    ]);
  });

  it("is empty when the anchor is not loaded", () => {
    expect(sameLocaleVersions(interleaved, 99)).toEqual([]);
  });
});

describe("defaultPair", () => {
  it("is the newest version and what precedes it in its locale", () => {
    expect(defaultPair(interleaved, false)).toEqual({
      kind: "pair",
      from: 3,
      to: 5,
    });
  });

  it("refuses rather than pairing the two newest ROWS", () => {
    // v5 is English and v4 is French. A pair of the two newest rows is what the
    // page used to default to, and the server rejects it.
    expect(defaultPair(interleaved, false)).not.toEqual({
      kind: "pair",
      from: 4,
      to: 5,
    });
  });

  // The three reasons there is no pair are three different situations, and a
  // reader acts differently on each. Collapsing them into one empty answer told
  // a document with NO versions that it had exactly one.
  it("distinguishes a document with no history at all", () => {
    expect(defaultPair([], false)).toEqual({ kind: "no-history" });
  });

  it("distinguishes a history that genuinely holds one version", () => {
    expect(defaultPair(plain(1), false)).toEqual({ kind: "only-version" });
  });

  it("distinguishes a predecessor that has merely not loaded", () => {
    // "Load more" would find it. Telling this reader they have one version is
    // false, and telling them they have none is worse.
    expect(defaultPair(plain(9), true)).toEqual({ kind: "not-loaded" });
  });
});

describe("defaultPair — a locale's first is not the document's only", () => {
  /**
   * `predecessorOf` answers a LOCALE-SCOPED question: `first` means nothing
   * older exists in this language, not that the document holds one version.
   * Reported as `only-version`, the pane told a reader "there is only one
   * version so far" while the rail beside it listed two — and the two surfaces
   * contradicting each other is worse than either being wrong alone, because
   * the reader cannot tell which to believe.
   */
  it("does not claim one version when another language has its own", () => {
    // v2 English is newest; v1 French is the whole of the French history.
    // Nothing older in English, and no further pages.
    const history = [
      { versionNo: 2, locale: "en" },
      { versionNo: 1, locale: "fr" },
    ];

    expect(defaultPair(history, false)).toEqual({ kind: "only-in-locale" });
  });

  /**
   * The control, and it decides the whole distinction: a document that really
   * does hold one version still says so. Without it the fix could report
   * `only-in-locale` everywhere and every assertion here would pass.
   */
  it("still claims one version when that is the whole history", () => {
    expect(defaultPair(plain(1), false)).toEqual({ kind: "only-version" });
    expect(defaultPair([{ versionNo: 1, locale: "en" }], false)).toEqual({
      kind: "only-version",
    });
  });

  /** Unchanged: nothing older LOADED is still distinct from nothing older. */
  it("still separates an unfetched predecessor from an absent one", () => {
    expect(defaultPair(plain(9), true)).toEqual({ kind: "not-loaded" });
  });

  it("still pairs within a locale when there is something to pair with", () => {
    expect(defaultPair(interleaved, false)).toEqual({
      kind: "pair",
      from: 3,
      to: 5,
    });
  });

  it("still reports an empty history as having nothing to compare", () => {
    expect(defaultPair([], false)).toEqual({ kind: "no-history" });
  });
});
