/**
 * The order a plugin's modules run in is decided by their names alone, the
 * same way on every host whatever its locale.
 */
import { describe, expect, it } from "vitest";

import { compareModuleNames } from "../plugin-migration";

const sorted = (names: string[]): string[] =>
  [...names].sort(compareModuleNames);

describe("compareModuleNames", () => {
  it("orders a non-ASCII name by code unit, not by the host's collation", () => {
    // An English collation puts `ä` beside `a`, ahead of `z`; a Swedish one
    // puts it after `z`. Neither may decide the run order: `ä` (U+00E4) is
    // after `z` (U+007A) wherever this runs.
    expect(sorted(["001_ä", "001_z"])).toEqual(["001_z", "001_ä"]);
    expect(sorted(["001_z", "001_ä"])).toEqual(["001_z", "001_ä"]);
  });

  it("ignores case when ordering, as the uniqueness rule does", () => {
    // Plain code-unit order would run `B_more` (0x42) before `a_init` (0x61).
    expect(sorted(["B_more", "a_init"])).toEqual(["a_init", "B_more"]);
  });

  it("is total over names that differ only in case", () => {
    // `assertUniqueModuleNames` refuses such a pair before anything runs; an
    // unvalidated list still sorts the same way every time.
    expect(sorted(["a_init", "A_init"])).toEqual(["A_init", "a_init"]);
    expect(sorted(["A_init", "a_init"])).toEqual(["A_init", "a_init"]);
    expect(compareModuleNames("a_init", "a_init")).toBe(0);
  });
});
