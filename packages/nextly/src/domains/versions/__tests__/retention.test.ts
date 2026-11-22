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

  it.each(["draft", "unpublished"])(
    "keeps each language's latest version of a document without the lifecycle whose own status reads %s",
    word => {
      // Without the lifecycle a version records the document's own status,
      // and every version was what that language's readers were served, even
      // one whose word the lifecycle also uses. Saves in one language must not
      // remove the other's only copy of it.
      const served = (
        id: string,
        versionNo: number,
        locale: string
      ): PrunableVersion => ({
        id,
        versionNo,
        status: word,
        locale,
        label: null,
        sourceVersionNo: null,
      });
      const history = [
        served("en-3", 3, "en"),
        served("en-2", 2, "en"),
        served("fr-1", 1, "fr"),
      ];
      expect(
        selectVersionsToPrune(history, 1, undefined, undefined, false)
      ).toEqual(["en-2"]);
      // Under the lifecycle the same rows are drafts, and only the head stays.
      expect(
        selectVersionsToPrune(history, 1, undefined, undefined, true)
      ).toEqual(["en-2", "fr-1"]);
    }
  );

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

  it("keeps every version a save's restored fields came from, but not the save's row itself", () => {
    // A save carried fields restored from two versions: "Restored from" names
    // both, so both outlive the cap. The row that records them is not pinned:
    // its sources are named by the client's save, and pinning every such row
    // would let a caller keep each new version past the cap by resending them.
    const input = [
      version(7),
      version(6),
      version(5, { fieldSources: { title: 4, body: 2 } }),
      version(4),
      version(3),
      version(2),
      version(1),
    ];

    expect(selectVersionsToPrune(input, 2)).toEqual(["v5", "v3", "v1"]);
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

describe("selectVersionsToPrune — what is kept for every part a version records", () => {
  /**
   * A durable row whose parts are recorded. A publish of chosen parts, or of
   * every language, records no language in `locale`, so only its parts say
   * which languages it put live.
   */
  function recorded(
    versionNo: number,
    locales: string[],
    shared: boolean,
    fields: Partial<Omit<PrunableVersion, "id" | "versionNo">> = {}
  ): PrunableVersion {
    return version(versionNo, {
      changedParts: { locales, shared },
      ...fields,
    });
  }
  const published = { status: "published" } as const;

  it("keeps the other language's latest publish through a run of later saves and publishes in one language", () => {
    // English was published alone, then Spanish alone, then English again
    // with saves around it. Each of those publishes records `locale: null`, so
    // a rule keyed on `locale` sees one key and keeps only the newest of them,
    // removing Spanish's only published version.
    const input = [
      recorded(7, ["en"], false, { locale: "en" }),
      recorded(6, ["en"], false, { locale: "en" }),
      recorded(5, ["en"], false, published),
      recorded(4, ["en"], false, { locale: "en" }),
      recorded(3, ["es"], false, published),
      recorded(2, ["en"], false, published),
      recorded(1, ["en", "es"], true, published),
    ];

    const pruned = selectVersionsToPrune(input, 2);

    // v5 is English's latest publish, v3 Spanish's and v1 the shared part's.
    expect(pruned).not.toContain("v3");
    expect(pruned).toEqual(["v4", "v2"]);
  });

  it("keeps a publish of the shared part alone after many publishes of single languages", () => {
    const input = [
      recorded(6, ["en"], false, published),
      recorded(5, ["es"], false, published),
      recorded(4, ["en"], false, published),
      recorded(3, ["es"], false, published),
      recorded(2, ["en"], false, published),
      recorded(1, [], true, published),
    ];

    expect(selectVersionsToPrune(input, 2)).toEqual(["v4", "v3", "v2"]);
  });

  it("counts a publish of every language and the shared part for each of them", () => {
    // v3, a later publish of the shared part alone, takes the shared part;
    // v2 is still the latest publish of English and of Spanish, so it stays
    // though a newer publish with no language exists.
    const input = [
      recorded(5, ["en"], false, { locale: "en" }),
      recorded(4, ["es"], false, { locale: "es" }),
      recorded(3, [], true, published),
      recorded(2, ["en", "es"], true, published),
      recorded(1, ["en", "es"], true, published),
    ];

    expect(selectVersionsToPrune(input, 1)).toEqual(["v4", "v1"]);
    // Once English is published again, v2 still holds Spanish's.
    expect(
      selectVersionsToPrune(
        [recorded(6, ["en"], false, published), ...input],
        1
      )
    ).toEqual(["v5", "v4", "v1"]);
  });

  it("keeps every version recorded before the parts by the rule it had, whatever recorded versions sit beside it", () => {
    // v4, v3 and v2 were recorded before versions named their parts: each is
    // its `locale`'s latest published version among them, so each is kept as
    // it always was. A newer recorded publish carrying the same `locale` (v7's
    // null, v6's "es") must not take its place.
    const input = [
      recorded(8, ["en"], false, { locale: "en" }),
      recorded(7, ["en"], false, published),
      recorded(6, ["es"], false, { locale: "es", ...published }),
      version(5, { locale: "en" }),
      version(4, { locale: null, ...published }),
      version(3, { locale: "es", ...published }),
      version(2, { locale: "en", ...published }),
      version(1, { locale: null, ...published }),
    ];

    expect(selectVersionsToPrune(input, 1)).toEqual(["v5", "v1"]);
  });

  it("never lets a version recorded before the parts stand in for a part's latest publish", () => {
    // v1 recorded that it published Spanish; v2 has no parts recorded. v2 is
    // kept for its own `locale`, and v1 stays as Spanish's latest publish.
    const input = [
      recorded(3, ["en"], false, { locale: "en" }),
      version(2, { locale: "es", ...published }),
      recorded(1, ["es"], false, { locale: "es", ...published }),
    ];

    expect(selectVersionsToPrune(input, 1)).toEqual([]);
  });

  it("gives a version that changed no part no protection as a part's latest publish", () => {
    // v2 records content as it already stood (a restore's snapshot of what it
    // replaced): it put nothing live, so the latest publish of English and of
    // the shared part is still v1, and v2 goes.
    const input = [
      recorded(3, ["en"], false, { locale: "en" }),
      recorded(2, [], false, published),
      recorded(1, ["en"], true, published),
    ];

    expect(selectVersionsToPrune(input, 1)).toEqual(["v2"]);
  });
});
