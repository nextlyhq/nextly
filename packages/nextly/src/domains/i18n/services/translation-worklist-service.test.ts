import { describe, it, expect } from "vitest";

import {
  AUTHORIZATION_CONCURRENCY,
  MAX_WORKLIST_COLLECTIONS,
  authorizationGroups,
  countIsTrustworthy,
  byMostRecentlyUpdated,
  eligibleCollections,
  hasTranslatableFields,
  classifyForWorklist,
  notConsultedSources,
  planWorklistFanOut,
  unanswerableCollections,
  translatedFilter,
  worklistId,
  worklistTitle,
  worklistTotal,
  worklistTotalPages,
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

describe("worklistTotalPages", () => {
  it("does not claim a backlog larger than the page fits on one page", () => {
    // `total: 100` beside `totalPages: 1` at `limit: 50` asserts that a hundred
    // documents fit in fifty — so a reader who believes the pair concludes the
    // fifty rows in hand ARE the hundred. That is the truncation-as-census
    // failure the summed total exists to end, moved one field along.
    expect(worklistTotalPages(100, 50)).toBe(2);
  });

  it("rounds a partial page up", () => {
    expect(worklistTotalPages(51, 50)).toBe(2);
  });

  it("is one page when the backlog fits", () => {
    // The control: deriving must not inflate an answer that was already whole.
    expect(worklistTotalPages(50, 50)).toBe(1);
  });

  it("is one empty page for an empty worklist, never zero", () => {
    // Zero pages is not a thing a list can have, and a consumer dividing by it
    // or rendering "page 1 of 0" is the reason to say so here.
    expect(worklistTotalPages(0, 50)).toBe(1);
  });

  it("survives a limit of zero rather than answering Infinity", () => {
    // `limit` is clamped upstream, which is exactly why this is cheap: the
    // guard costs nothing while its branch never runs, and `Math.ceil(n / 0)`
    // is Infinity — a number that would serialize into the envelope.
    expect(worklistTotalPages(10, 0)).toBe(1);
  });
});

describe("countIsTrustworthy", () => {
  it("disbelieves a zero count reported beside rows that exist", () => {
    // The case that costs something. `listEntries` returns success with
    // `totalDocs: 0` when the ROWS arrived and the paired COUNT failed, so
    // taking the zero hides that collection's whole backlog behind however many
    // rows happened to fit — and nothing in the response says so.
    expect(countIsTrustworthy(0, 50)).toBe(false);
  });

  it("disbelieves any count smaller than the rows it came with", () => {
    // A count is the number of rows MATCHING, so it cannot be smaller than the
    // rows returned. Impossible for a count that ran; certain for one that did
    // not.
    expect(countIsTrustworthy(12, 13)).toBe(false);
  });

  it("believes a count that is larger than the page it accompanies", () => {
    // The control, and the whole point of summing counts: 100 matches behind a
    // page of 50 is the ordinary, correct case and must not be discarded as
    // untrustworthy.
    expect(countIsTrustworthy(100, 50)).toBe(true);
  });

  it("believes an exact count", () => {
    expect(countIsTrustworthy(50, 50)).toBe(true);
  });

  it("believes zero against no rows", () => {
    // An empty collection. A failed count here is undetectable and harmless —
    // there is no backlog for it to hide.
    expect(countIsTrustworthy(0, 0)).toBe(true);
  });

  it("disbelieves a count that is not a number at all", () => {
    expect(countIsTrustworthy(undefined, 0)).toBe(false);
  });

  it("disbelieves a count that only LOOKS like a number", () => {
    // The reason the type check is there rather than relying on `>=` alone:
    // `"100" >= 50` coerces and is true, so a stringified count would be
    // trusted and summed into a total as a string.
    expect(countIsTrustworthy("100", 50)).toBe(false);
  });
});

describe("authorizationGroups — a step that cannot advance", () => {
  it("refuses a concurrency of zero rather than looping forever", () => {
    // `i += 0` never reaches `rest.length`. Unreachable today, which is what
    // makes the guard cheap rather than what makes it unnecessary.
    expect(() => authorizationGroups(["a", "b"], 0)).toThrow(
      expect.objectContaining({ code: "INTERNAL_ERROR" })
    );
  });

  it("refuses a negative concurrency, which walks the index backwards", () => {
    expect(() => authorizationGroups(["a", "b"], -1)).toThrow(
      expect.objectContaining({ code: "INTERNAL_ERROR" })
    );
  });

  it("refuses a fractional concurrency", () => {
    expect(() => authorizationGroups(["a", "b"], 1.5)).toThrow(
      expect.objectContaining({ code: "INTERNAL_ERROR" })
    );
  });

  it("still accepts the smallest useful step", () => {
    // The control: the guard must reject the values that cannot work, not the
    // edge of the ones that can.
    expect(authorizationGroups(["a", "b", "c"], 1)).toEqual([
      ["a"],
      ["b"],
      ["c"],
    ]);
  });
});

describe("a collection that cannot answer the staleness question", () => {
  const coll = (slug: string, canAnswerStaleness?: boolean) => ({
    slug,
    label: slug,
    hasStatus: true,
    ...(canAnswerStaleness === undefined ? {} : { canAnswerStaleness }),
  });

  it("is left out of the stale fan-out rather than contributing zero", () => {
    // 🔴 The filter answers `1=0` for a companion that has no timestamp column, so querying it
    // returns nothing — and nothing is indistinguishable from "this collection has no stale
    // translations". Excluding it is what makes the difference reportable at all.
    const eligible = eligibleCollections(
      [coll("posts", true), coll("legacy", false)],
      "stale",
      undefined
    );
    expect(eligible.map(c => c.slug)).toEqual(["posts"]);
  });

  it("is NOT left out of the other four states, which never ask", () => {
    // The capability is only consulted for `stale`; the flag is absent for every other state
    // because the probe that fills it is not run. A filter that excluded on an unasked question
    // would silently shrink every other tab.
    for (const state of [
      "missing",
      "translated",
      "draft",
      "published",
    ] as const) {
      const eligible = eligibleCollections(
        [coll("posts"), coll("legacy")],
        state,
        undefined
      );
      expect(eligible.map(c => c.slug)).toEqual(["posts", "legacy"]);
    }
  });

  it("is NAMED, so a zero is never mistaken for good news", () => {
    expect(
      unanswerableCollections(
        [coll("posts", true), coll("legacy", false)],
        "stale",
        undefined
      )
    ).toEqual(["legacy"]);
  });

  it("names nobody for a state that does not ask the question", () => {
    expect(
      unanswerableCollections(
        [coll("posts", true), coll("legacy", false)],
        "missing",
        undefined
      )
    ).toEqual([]);
  });

  it("🔴 never names a collection the caller cannot read", () => {
    // Same rule the fan-out already keeps: a slug reported back is a statement that the collection
    // EXISTS. Someone with no right to know that must not learn it from a coverage notice, which
    // is the softest-looking place for it to leak.
    expect(
      unanswerableCollections(
        [coll("posts", false), coll("secret", false)],
        "stale",
        new Set(["posts"])
      )
    ).toEqual(["posts"]);
  });

  it("treats an unresolved capability as answerable, not as unanswerable", () => {
    // `undefined` means the question was never asked — which is every state but `stale`, and also
    // a collection the probe never reached. Excluding on it would turn "not asked" into "cannot",
    // and quietly empty the tab.
    expect(
      eligibleCollections([coll("posts")], "stale", undefined).map(c => c.slug)
    ).toEqual(["posts"]);
    expect(
      unanswerableCollections([coll("posts")], "stale", undefined)
    ).toEqual([]);
  });
});

describe("the two views cannot disagree", () => {
  const coll = (slug: string, canAnswerStaleness?: boolean) => ({
    slug,
    label: slug,
    hasStatus: true,
    ...(canAnswerStaleness === undefined ? {} : { canAnswerStaleness }),
  });

  it("🔴 puts every readable collection in exactly one of the two lists", () => {
    // The property the single classification exists for. Two filters with complementary
    // predicates can drift: one later edit to eligibility excludes a collection without naming it,
    // or names one that was still queried. The first is a silent zero presented as good news --
    // the exact error this feature was built to prevent, arriving through the code that prevents
    // it. Asserted as a PARTITION rather than as two independent expectations, because that is the
    // invariant a future edit would break.
    const all = [
      coll("alpha", true),
      coll("beta", false),
      coll("gamma", true),
      coll("delta", false),
    ];
    const { eligible, unanswerable } = classifyForWorklist(
      all,
      "stale",
      undefined
    );
    const named = new Set(unanswerable);
    const queried = new Set(eligible.map(c => c.slug));

    expect([...queried].filter(s => named.has(s))).toEqual([]);
    expect([...queried, ...named].sort()).toEqual([
      "alpha",
      "beta",
      "delta",
      "gamma",
    ]);
  });

  it("keeps the derived views agreeing with the classification", () => {
    // `eligibleCollections` and `unanswerableCollections` survive as narrow views because most
    // callers want one of them. They must stay derivations, not re-implementations.
    const all = [coll("alpha", true), coll("beta", false)];
    const one = classifyForWorklist(all, "stale", undefined);
    expect(eligibleCollections(all, "stale", undefined)).toEqual(one.eligible);
    expect(unanswerableCollections(all, "stale", undefined)).toEqual(
      one.unanswerable
    );
  });

  it("names nobody an unreadable collection, in either view", () => {
    const { eligible, unanswerable } = classifyForWorklist(
      [coll("visible", false), coll("secret", false)],
      "stale",
      new Set(["visible"])
    );
    expect(eligible).toEqual([]);
    expect(unanswerable).toEqual(["visible"]);
  });
});
