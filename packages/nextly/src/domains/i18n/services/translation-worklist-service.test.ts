import { describe, it, expect } from "vitest";

import {
  MAX_WORKLIST_COLLECTIONS,
  byMostRecentlyUpdated,
  eligibleCollections,
  planWorklistFanOut,
  translatedFilter,
  worklistId,
  worklistTitle,
  worklistUpdatedAt,
  type TranslationWorkRow,
} from "./translation-worklist-service";

const row = (over: Partial<TranslationWorkRow>): TranslationWorkRow => ({
  collection: "posts",
  collectionLabel: "Posts",
  id: "1",
  title: "t",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

describe("worklistId", () => {
  it("reads a string or numeric id", () => {
    expect(worklistId({ id: "abc" })).toBe("abc");
    expect(worklistId({ id: 42 })).toBe("42");
  });

  it("answers an id that is neither with an empty string", () => {
    // `String({})` is "[object Object]" — a plausible-looking URL segment that
    // addresses no document. An empty id is visibly wrong instead.
    expect(worklistId({ id: { nested: true } })).toBe("");
    expect(worklistId({})).toBe("");
  });
});

describe("worklistTitle", () => {
  it("prefers the collection's own useAsTitle", () => {
    expect(
      worklistTitle({ id: "1", headline: "H", title: "T" }, "headline")
    ).toBe("H");
  });

  it("falls back the same way the dashboard does, so one document has one name", () => {
    expect(worklistTitle({ id: "1", title: "T", name: "N" }, undefined)).toBe(
      "T"
    );
    expect(worklistTitle({ id: "1", name: "N" }, undefined)).toBe("N");
  });

  it("skips a blank useAsTitle rather than rendering an unnamed row", () => {
    // A row titled "" is unclickable in practice: there is nothing to aim at.
    expect(
      worklistTitle({ id: "7", headline: "   ", title: "T" }, "headline")
    ).toBe("T");
  });

  it("keeps a numeric title instead of falling through it", () => {
    // `0` and `2026` are legitimate titles. A truthiness test drops both.
    expect(worklistTitle({ id: "1", year: 0 }, "year")).toBe("0");
  });

  it("ends at the id, which always addresses the row", () => {
    expect(worklistTitle({ id: "abc" }, "nope")).toBe("abc");
  });
});

describe("worklistUpdatedAt", () => {
  it("normalises a Date to ISO 8601", () => {
    expect(worklistUpdatedAt(new Date("2026-03-04T05:06:07Z"))).toBe(
      "2026-03-04T05:06:07.000Z"
    );
  });

  it("answers an unusable value with an empty string, not a fabricated date", () => {
    expect(worklistUpdatedAt(null)).toBe("");
    expect(worklistUpdatedAt(undefined)).toBe("");
  });
});

describe("byMostRecentlyUpdated", () => {
  it("puts the most recently touched document first", () => {
    const rows = [
      row({ id: "old", updatedAt: "2026-01-01T00:00:00.000Z" }),
      row({ id: "new", updatedAt: "2026-06-01T00:00:00.000Z" }),
    ].sort(byMostRecentlyUpdated);
    expect(rows.map(r => r.id)).toEqual(["new", "old"]);
  });

  it("sorts an unknown date LAST, never first", () => {
    // An unknown date is not a fresh one. Sorting it first would let one
    // collection with broken timestamps occupy every page of the list.
    const rows = [
      row({ id: "unknown", updatedAt: "" }),
      row({ id: "dated", updatedAt: "2020-01-01T00:00:00.000Z" }),
    ].sort(byMostRecentlyUpdated);
    expect(rows.map(r => r.id)).toEqual(["dated", "unknown"]);
  });
});

describe("eligibleCollections", () => {
  const coll = (slug: string, hasStatus = true) => ({
    slug,
    label: slug,
    hasStatus,
  });

  it("drops collections the caller cannot read", () => {
    const out = eligibleCollections(
      [coll("posts"), coll("secrets"), coll("pages")],
      "missing",
      new Set(["posts", "pages"])
    );
    expect(out.map(c => c.slug)).toEqual(["posts", "pages"]);
  });

  it("treats an absent readable set as super-admin, not as nothing readable", () => {
    const out = eligibleCollections([coll("posts")], "missing", undefined);
    expect(out.map(c => c.slug)).toEqual(["posts"]);
  });

  it("excludes a statusless collection from a LIFECYCLE state", () => {
    // The companion condition is deliberately absent for a collection with no
    // status, so the query returns EVERY document — and the worklist would
    // present all of them as being in the state that was asked for.
    for (const state of ["draft", "published"] as const) {
      const out = eligibleCollections(
        [coll("posts", true), coll("tags", false)],
        state,
        undefined
      );
      expect(out.map(c => c.slug)).toEqual(["posts"]);
    }
  });

  it("keeps a statusless collection for states that do not need status", () => {
    // "missing" and "translated" are answerable without a lifecycle, and
    // excluding those collections would hide real outstanding work.
    for (const state of ["missing", "translated"] as const) {
      const out = eligibleCollections(
        [coll("posts", true), coll("tags", false)],
        state,
        undefined
      );
      expect(out.map(c => c.slug)).toEqual(["posts", "tags"]);
    }
  });

  it("narrows BEFORE the cap, so an unreadable collection cannot consume a slot", () => {
    // The ordering property, stated as one test. `a`-prefixed unreadable
    // collections would otherwise fill every slot alphabetically and push the
    // readable one into `skippedCollections` — where its work is never queried
    // and its slug is named to someone with no right to know it exists.
    const all = [
      ...Array.from({ length: MAX_WORKLIST_COLLECTIONS }, (_, i) =>
        coll(`a${String(i).padStart(3, "0")}`)
      ),
      coll("zebra"),
    ];
    const plan = planWorklistFanOut(
      eligibleCollections(all, "missing", new Set(["zebra"]))
    );
    expect(plan.queried.map(c => c.slug)).toEqual(["zebra"]);
    expect(plan.skippedCollections).toEqual([]);
  });
});

describe("planWorklistFanOut", () => {
  const many = Array.from({ length: MAX_WORKLIST_COLLECTIONS + 3 }, (_, i) => ({
    slug: `c${String(i).padStart(3, "0")}`,
    label: `C${i}`,
    hasStatus: true,
  }));

  it("names what the cap excluded rather than dropping it", () => {
    // A worklist that silently omits a collection reads as "nothing to do
    // there" — indistinguishable from the truth at a glance.
    const plan = planWorklistFanOut(many);
    expect(plan.queried).toHaveLength(MAX_WORKLIST_COLLECTIONS);
    expect(plan.skippedCollections).toEqual(["c020", "c021", "c022"]);
  });

  it("skips nothing when the site is under the cap", () => {
    const plan = planWorklistFanOut(many.slice(0, 3));
    expect(plan.queried).toHaveLength(3);
    expect(plan.skippedCollections).toEqual([]);
  });

  it("gives the same answer for the same site whatever order it arrives in", () => {
    // Otherwise two identical requests disagree about which collections were
    // skipped, and the omission looks like a change in the content.
    const forward = planWorklistFanOut(many, 5);
    const shuffled = planWorklistFanOut([...many].reverse(), 5);
    expect(shuffled.queried.map(c => c.slug)).toEqual(
      forward.queried.map(c => c.slug)
    );
    expect(shuffled.skippedCollections).toEqual(forward.skippedCollections);
  });
});

describe("translatedFilter", () => {
  it("puts `_translated` at the TOP level, where the extractor reads it", () => {
    // Nested inside `and` it is silently ignored, the query returns every
    // entry, and the worklist reads as "nothing outstanding".
    expect(translatedFilter("es", "missing")).toEqual({
      _translated: { locale: "es", state: "missing" },
    });
  });
});
