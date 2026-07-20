/**
 * Retention selection rules. Pure logic, no database: the protection rules are
 * the part most likely to be wrong, so they are tested in isolation.
 */
import { describe, expect, it } from "vitest";

import { selectVersionsToPrune, type PrunableVersion } from "../retention";

/** Rows are supplied newest-first, matching the repository's ordering. */
function rows(...specs: [string, number, "draft" | "published"][]) {
  return specs.map(
    ([id, versionNo, status]): PrunableVersion => ({ id, versionNo, status })
  );
}

describe("selectVersionsToPrune", () => {
  it("returns nothing when the cap is false (unlimited)", () => {
    const input = rows(
      ["c", 3, "published"],
      ["b", 2, "draft"],
      ["a", 1, "draft"]
    );
    expect(selectVersionsToPrune(input, false)).toEqual([]);
  });

  it("returns nothing when the row count is at or under the cap", () => {
    const input = rows(["c", 3, "draft"], ["b", 2, "draft"], ["a", 1, "draft"]);
    expect(selectVersionsToPrune(input, 3)).toEqual([]);
  });

  it("prunes the oldest rows beyond the cap", () => {
    const input = rows(
      ["e", 5, "draft"],
      ["d", 4, "draft"],
      ["c", 3, "draft"],
      ["b", 2, "draft"],
      ["a", 1, "draft"]
    );
    expect(selectVersionsToPrune(input, 3)).toEqual(["b", "a"]);
  });

  it("never prunes the newest version even at cap 0", () => {
    const input = rows(["b", 2, "draft"], ["a", 1, "draft"]);
    expect(selectVersionsToPrune(input, 0)).toEqual(["a"]);
  });

  it("never prunes the most recent published version", () => {
    // `a` is published and falls beyond the cap, so it must survive.
    const input = rows(
      ["e", 5, "draft"],
      ["d", 4, "draft"],
      ["c", 3, "draft"],
      ["b", 2, "draft"],
      ["a", 1, "published"]
    );
    expect(selectVersionsToPrune(input, 3)).toEqual(["b"]);
  });

  it("protects only the MOST RECENT published version, not every published one", () => {
    const input = rows(
      ["e", 5, "draft"],
      ["d", 4, "draft"],
      ["c", 3, "draft"],
      ["b", 2, "published"],
      ["a", 1, "published"]
    );
    // `b` is the most recent published and survives; `a` does not.
    expect(selectVersionsToPrune(input, 3)).toEqual(["a"]);
  });
});
