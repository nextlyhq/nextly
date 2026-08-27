import { describe, it, expect } from "vitest";

import {
  AUTHORIZATION_CONCURRENCY,
  MAX_WORKLIST_COLLECTIONS,
  authorizationGroups,
  byMostRecentlyUpdated,
  eligibleCollections,
  hasTranslatableFields,
  notConsultedSources,
  planWorklistFanOut,
  translatedFilter,
  worklistId,
  worklistTitle,
  worklistTotal,
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

describe("notConsultedSources", () => {
  it("gathers every reason a collection went uncovered into one list", () => {
    // A collection the cap never reached and one whose read FAILED make the
    // same statement to a reader: this answer did not cover that collection.
    expect(notConsultedSources(["pages"], ["posts"])).toEqual([
      "pages",
      "posts",
    ]);
  });

  it("names a collection once even when both reasons apply", () => {
    expect(notConsultedSources(["posts"], ["posts"])).toEqual(["posts"]);
  });

  it("describes the same site the same way whatever order it arrives in", () => {
    // An order that varies between two identical requests reads as the content
    // having changed.
    expect(notConsultedSources(["zebra"], ["alpha"])).toEqual(
      notConsultedSources(["alpha"], ["zebra"])
    );
  });

  it("is empty when the answer covered everything", () => {
    // The field's PRESENCE is the signal, so it must not appear as an empty
    // list on a complete answer.
    expect(notConsultedSources([], [])).toEqual([]);
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

describe("authorizationGroups", () => {
  it("resolves ONE decision before any others are started", () => {
    // The warm-up, and the reason the first group is a single slug rather than
    // a rounding artefact. `canReadEntity` resolves a session caller through
    // `isSuperAdmin`, a per-user TTL cache: fired all at once from cold, every
    // call misses before the first populates it, so one question becomes N
    // simultaneous permission reads. Letting one finish converts the rest into
    // cache hits.
    const groups = authorizationGroups(["a", "b", "c", "d"], 2);
    expect(groups[0]).toEqual(["a"]);
  });

  it("never puts more than `concurrency` decisions in flight together", () => {
    const groups = authorizationGroups(
      Array.from({ length: 50 }, (_, i) => `c${i}`),
      8
    );
    expect(groups.slice(1).every(g => g.length <= 8)).toBe(true);
  });

  it("decides EVERY candidate, because a collection with no verdict is unusable", () => {
    // Bounding the COUNT rather than the concurrency would leave collections
    // undecided, and there is nothing safe to do with one: naming it as
    // unconsulted discloses a collection the caller may not read, and dropping
    // it silently is the "nothing to do there" lie the endpoint exists to
    // prevent. Every slug in, every slug out, once.
    const slugs = Array.from({ length: 137 }, (_, i) => `c${i}`);
    expect(authorizationGroups(slugs).flat()).toEqual(slugs);
  });

  it("has no group at all for no candidates", () => {
    // A lone empty group would fire one authorization round-trip for a site
    // with nothing to authorize.
    expect(authorizationGroups([])).toEqual([]);
  });

  it("is one group for one candidate", () => {
    expect(authorizationGroups(["only"])).toEqual([["only"]]);
  });

  it("bounds concurrency below the query cap it precedes", () => {
    // These bound different resources — queries and permission reads — but a
    // concurrency wider than the fan-out itself would bound nothing in the
    // common case.
    expect(AUTHORIZATION_CONCURRENCY).toBeLessThan(MAX_WORKLIST_COLLECTIONS);
  });
});

describe("hasTranslatableFields", () => {
  it("refuses a collection whose fields cannot be translated", () => {
    // `localized: true` with nothing localizable generates NO companion table,
    // so the `_translated` predicate produces no condition, so the query
    // narrows nothing and every document is reported as outstanding work.
    expect(hasTranslatableFields([{ type: "number", name: "count" }])).toBe(
      false
    );
  });

  it("refuses a collection whose text fields all opted OUT", () => {
    expect(
      hasTranslatableFields([
        { type: "text", name: "sku", localized: false },
        { type: "text", name: "code", localized: false },
      ])
    ).toBe(false);
  });

  it("accepts a collection with one translatable field", () => {
    expect(
      hasTranslatableFields([
        { type: "number", name: "count" },
        { type: "text", name: "title" },
      ])
    ).toBe(true);
  });

  it("refuses a collection with no fields at all", () => {
    expect(hasTranslatableFields([])).toBe(false);
  });
});

describe("worklistTotal", () => {
  it("counts the backlog, not the page it could carry", () => {
    // The failure this exists to prevent: one collection with 51 outstanding
    // documents is asked for 50, and reporting what came back presents a
    // truncated backlog as a complete census.
    expect(worklistTotal([51], 50)).toBe(51);
  });

  it("sums across collections rather than reporting the largest", () => {
    expect(worklistTotal([7, 11, 2], 20)).toBe(20);
    expect(worklistTotal([7, 11, 2], 5)).toBe(20);
  });

  it("never reports fewer than the rows sitting beside it on screen", () => {
    // A count query that fails falls back to zero inside the query service. A
    // total below the visible rows is the one answer a reader cannot interpret.
    expect(worklistTotal([0, 0], 12)).toBe(12);
  });

  it("is zero for an empty worklist", () => {
    expect(worklistTotal([], 0)).toBe(0);
  });
});
