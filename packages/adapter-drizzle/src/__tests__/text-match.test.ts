/**
 * The case fold SQLite connections apply as `nextly_fold_case`, held to what PostgreSQL's and
 * MySQL's `lower()` give, letter by letter.
 *
 * Each case below is one a plain `text.toLowerCase()` gets differently: it writes a final sigma
 * at the end of a word and "i" plus a combining dot for "İ", either of which would make SQLite
 * alone miss a match the other two dialects find.
 */
import { describe, expect, it } from "vitest";

import { foldCase } from "../text-match";

describe("foldCase", () => {
  it("folds capitals outside ASCII, as the other dialects' lower() does", () => {
    expect(foldCase("CRÈME BRÛLÉE")).toBe("crème brûlée");
    expect(foldCase("ÄRGER")).toBe("ärger");
    expect(foldCase("ΑΘΉΝΑ")).toBe("αθήνα");
  });

  it("folds a capital sigma to σ wherever it stands, never to the final ς", () => {
    // The word ends in the sigma, where `toLowerCase()` on the whole string writes "ς".
    expect(foldCase("ΟΔΟΣ")).toBe("οδοσ");
    expect(foldCase("ΟΔΟΣ")).not.toBe("ΟΔΟΣ".toLowerCase());
  });

  it("folds the Turkish dotted capital İ to a plain i, and leaves the dotless ı as it is", () => {
    expect(foldCase("İSTANBUL")).toBe("istanbul");
    expect(foldCase("İ")).toHaveLength(1);
    expect(foldCase("ılık")).toBe("ılık");
  });

  it("leaves a letter with no single capital, and ASCII punctuation, as it is", () => {
    expect(foldCase("STRAßE")).toBe("straße");
    expect(foldCase("50% A_B!")).toBe("50% a_b!");
  });
});
