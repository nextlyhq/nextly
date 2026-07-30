import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../../errors/nextly-error";
import { findLostIndexes, refuseLostIndexes } from "../observer";

describe("findLostIndexes", () => {
  // Renaming a table keeps its indexes on all three dialects, so a name missing
  // afterwards means one was dropped rather than moved.
  it("names an index the rename did not carry", () => {
    expect(findLostIndexes(["idx_a", "idx_b"], ["idx_a"])).toEqual({
      comparable: true,
      lost: ["idx_b"],
    });
  });

  it("reports nothing lost when every name survived", () => {
    expect(findLostIndexes(["idx_a"], ["idx_a", "idx_new"])).toEqual({
      comparable: true,
      lost: [],
    });
  });

  // The reason this compares names rather than counts: a count survives losing
  // one index and gaining another, which is exactly the shape being checked for.
  it("catches a loss that leaves the count unchanged", () => {
    const result = findLostIndexes(["idx_a", "idx_b"], ["idx_a", "idx_other"]);
    expect(result).toEqual({ comparable: true, lost: ["idx_b"] });
  });

  // `undefined` means the snapshot tracked no index data, which is not the same
  // as a table having none. Reading it as an empty list would report every index
  // intact on a snapshot that never held any.
  it.each([
    ["the source was not observed", undefined, ["idx_a"]],
    ["the target was not observed", ["idx_a"], undefined],
    ["neither was observed", undefined, undefined],
  ])("reports %s as not comparable", (_label, before, after) => {
    expect(findLostIndexes(before, after)).toEqual({ comparable: false });
  });

  // A table that genuinely has no indexes is comparable and loses nothing;
  // conflating this with the untracked case is the mistake the type prevents.
  it("treats an empty list as tracked and complete", () => {
    expect(findLostIndexes([], [])).toEqual({ comparable: true, lost: [] });
  });
});

describe("refuseLostIndexes", () => {
  it("names the table and every index that went missing", () => {
    const error = refuseLostIndexes({ table: "fg_hero", lost: ["idx_b"] });
    expect(NextlyError.is(error)).toBe(true);
    expect(error.logContext?.reason).toMatch(
      /did not carry the table's indexes/
    );
    expect(error.logContext?.table).toBe("fg_hero");
    expect(error.logContext?.lost).toEqual(["idx_b"]);
  });
});
