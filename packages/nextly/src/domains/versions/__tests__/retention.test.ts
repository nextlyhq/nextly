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

describe("selectVersionsToPrune — protecting a restore's undo", () => {
  const row = (versionNo: number, status = "draft") => ({
    id: `v${versionNo}`,
    versionNo,
    status,
  });

  it("keeps the named version even when the cap would remove it", () => {
    // A restore records the content it replaced and then tells the editor the
    // change can be undone. At a small cap the very next pass would remove
    // exactly that version, so the undo would be gone the moment it was
    // promised.
    const rows = [row(3), row(2), row(1)];

    const pruned = selectVersionsToPrune(rows, 1, 2);

    expect(pruned).not.toContain("v2");
    expect(pruned).toContain("v1");
  });

  it("prunes normally when no version is named", () => {
    const rows = [row(3), row(2), row(1)];

    expect(selectVersionsToPrune(rows, 1)).toEqual(["v2", "v1"]);
  });
});
