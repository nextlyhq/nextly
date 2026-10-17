/**
 * Retention selection rules. Pure logic, no database: the protection rules are
 * the part most likely to be wrong, so they are tested in isolation.
 */
import { describe, expect, it } from "vitest";

import { selectVersionsToPrune, type PrunableVersion } from "../retention";

/** Rows are supplied newest-first, matching the repository's ordering. */
function rows(...specs: [string, number, "draft" | "published"][]) {
  return specs.map(
    ([id, versionNo, status]): PrunableVersion => ({
      id,
      versionNo,
      status,
      locale: null,
      label: null,
      sourceVersionNo: null,
    })
  );
}

/**
 * One durable row with only the columns a case cares about set. The id is
 * `v<versionNo>` so an expectation reads as the version it names.
 */
function version(
  versionNo: number,
  fields: Partial<Omit<PrunableVersion, "id" | "versionNo">> = {}
): PrunableVersion {
  return {
    id: `v${versionNo}`,
    versionNo,
    status: "draft",
    locale: null,
    label: null,
    sourceVersionNo: null,
    ...fields,
  };
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

  it("keeps a pinned version beyond the cap, and prunes the rest as before", () => {
    const input = [5, 4, 3, 2, 1].map(no => version(no));
    expect(selectVersionsToPrune(input, 2, [], [1])).toEqual(["v3", "v2"]);
    // Without the pin the same pass removes it.
    expect(selectVersionsToPrune(input, 2)).toEqual(["v3", "v2", "v1"]);
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
  const row = (versionNo: number) => version(versionNo);

  it("keeps the named version even when the cap would remove it", () => {
    // A restore records the content it replaced and then tells the editor the
    // change can be undone. At a small cap the very next pass would remove
    // exactly that version, so the undo would be gone the moment it was
    // promised.
    const rows = [row(3), row(2), row(1)];

    const pruned = selectVersionsToPrune(rows, 1, [2]);

    expect(pruned).not.toContain("v2");
    expect(pruned).toContain("v1");
  });

  it("keeps every named version, not just the first", () => {
    // A restore protects two: the head it replaced, and the version it was
    // made FROM — the new row records that one as its source, so pruning it
    // leaves the lineage pointing at nothing.
    const rows = [row(4), row(3), row(2), row(1)];

    const pruned = selectVersionsToPrune(rows, 1, [3, 1]);

    expect(pruned).not.toContain("v3");
    expect(pruned).not.toContain("v1");
    expect(pruned).toContain("v2");
  });

  it("ignores absent entries among the named versions", () => {
    const rows = [row(3), row(2), row(1)];

    expect(selectVersionsToPrune(rows, 1, [null, undefined])).toEqual([
      "v2",
      "v1",
    ]);
  });

  it("prunes normally when no version is named", () => {
    const rows = [row(3), row(2), row(1)];

    expect(selectVersionsToPrune(rows, 1)).toEqual(["v2", "v1"]);
  });
});

describe("selectVersionsToPrune — what is kept for every language", () => {
  it("keeps each language's latest published version through a run of saves in another", () => {
    // German was published once; English has been saved and published since.
    // The document-wide "latest published" is English, so a rule keyed on the
    // document alone removes German's only published snapshot.
    const input = [
      version(6, { locale: "en", status: "published" }),
      version(5, { locale: "en" }),
      version(4, { locale: "en" }),
      version(3, { locale: "en" }),
      version(2, { locale: "de", status: "published" }),
      version(1, { locale: "en" }),
    ];

    const pruned = selectVersionsToPrune(input, 3);

    expect(pruned).not.toContain("v2");
    expect(pruned).toEqual(["v3", "v1"]);
  });

  it("keeps the latest published version with no language beside each language's", () => {
    // A version with no language is a document with no languages, a snapshot
    // of every language at once, or the shared part: the latest published one
    // is kept whatever else is.
    const input = [
      version(5, { locale: "en" }),
      version(4, { locale: "en" }),
      version(3, { locale: "en", status: "published" }),
      version(2, { locale: null, status: "published" }),
      version(1, { locale: null }),
    ];

    expect(selectVersionsToPrune(input, 2)).toEqual(["v1"]);
  });

  it("keeps only the latest published version of each language, not every one", () => {
    const input = [
      version(4, { locale: "en" }),
      version(3, { locale: "de", status: "published" }),
      version(2, { locale: "de", status: "published" }),
      version(1, { locale: "en", status: "published" }),
    ];

    // v3 is German's latest and v1 is English's only published version; v2 is
    // an older German publish and goes.
    expect(selectVersionsToPrune(input, 1)).toEqual(["v2"]);
  });

  it("protects nothing for a language that was never published", () => {
    const input = [
      version(3, { locale: "en" }),
      version(2, { locale: "de" }),
      version(1, { locale: "de" }),
    ];

    expect(selectVersionsToPrune(input, 1)).toEqual(["v2", "v1"]);
  });
});

describe("selectVersionsToPrune — named versions and restore lineage", () => {
  it("keeps every named version", () => {
    const input = [
      version(5),
      version(4, { label: "Launch copy" }),
      version(3),
      version(2, { label: "Before restore" }),
      version(1),
    ];

    expect(selectVersionsToPrune(input, 1)).toEqual(["v3", "v1"]);
  });

  it("does not treat an empty label as a name", () => {
    const input = [version(3), version(2, { label: "" }), version(1)];

    expect(selectVersionsToPrune(input, 1)).toEqual(["v2", "v1"]);
  });

  it("keeps an earlier restore's row and the version it was made from", () => {
    // The restore happened passes ago, so nothing names it to this pass. Its
    // row records the lineage and its source is what "restored from" points
    // at: both outlive the cap.
    const input = [
      version(6),
      version(5),
      version(4, { sourceVersionNo: 2 }),
      version(3),
      version(2),
      version(1),
    ];

    expect(selectVersionsToPrune(input, 2)).toEqual(["v3", "v1"]);
  });

  it("ignores a restore source that is no longer in the history", () => {
    const input = [version(3), version(2, { sourceVersionNo: 1 })];

    // v1 is already gone; v2 is kept as a restore row and nothing else is
    // asked of it.
    expect(selectVersionsToPrune(input, 1)).toEqual([]);
  });

  it("keeps the newest version at cap 0 alongside every protected one", () => {
    const input = [
      version(4, { locale: "en" }),
      version(3, { locale: "de", status: "published" }),
      version(2, { label: "Reviewed" }),
      version(1),
    ];

    expect(selectVersionsToPrune(input, 0)).toEqual(["v1"]);
  });
});
