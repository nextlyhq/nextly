/**
 * Each rule exists because the compiler DROPS the definition silently. So the
 * property under test is not "invalid input is rejected" — it is that the exact
 * shapes which disappear at compile time are the shapes reported here.
 *
 * A definition that is merely unusual must NOT be reported, or the editor
 * refuses settings that would have worked; that is what the accepted cases
 * below pin.
 */
import { describe, expect, it } from "vitest";

import { MAX_BREAKPOINT_ID_LENGTH } from "@nextlyhq/blocks-engine";

import {
  authoredBreakpoints,
  BASE_BREAKPOINT,
  MAX_BREAKPOINTS_PER_AXIS,
  storedLimitFor,
  validateBreakpoints,
  inCascadeOrder,
  type BreakpointIssueCode,
  type BreakpointSet,
  breakpointQueries,
  liveBreakpointsFor,
  matchedBreakpoints,
} from "./breakpoints";

function set(partial: Partial<BreakpointSet>): BreakpointSet {
  return { viewport: [], container: [], ...partial };
}

/** The codes reported for a set, in order. */
function codes(value: BreakpointSet): BreakpointIssueCode[] {
  return validateBreakpoints(value).map(issue => issue.code);
}

/** `count` valid definitions, each with a distinct id and a distinct width. */
function rows(prefix: string, count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}-${i}`,
    label: `${prefix} ${i}`,
    maxWidth: 1000 - i * 50,
  }));
}

describe("the authored set", () => {
  it("strips a stored base row from both axes", () => {
    /*
     * A stored set CAN carry a `base` row and the plugin's README documents a
     * host config that does, while the compiler claims that id before reading
     * any stored definition. Three surfaces ask "what has this site defined" —
     * the dialog's draft, the trigger's count, and the host deciding whether
     * config defaults exist — and each one that answered differently produced
     * its own defect.
     */
    const stripped = authoredBreakpoints({
      viewport: [
        { id: "base", label: "Base" },
        { id: "tablet", label: "Tablet", maxWidth: 991 },
      ],
      container: [{ id: "base", label: "Base" }],
    } as unknown as BreakpointSet);

    expect(stripped.viewport.map(def => def.id)).toEqual(["tablet"]);
    expect(stripped.container).toEqual([]);
  });

  it("answers for an absent set rather than throwing", () => {
    // The host's config states no breakpoints at all far more often than it
    // states some, and that caller reads the field optionally.
    expect(authoredBreakpoints(undefined)).toEqual({
      viewport: [],
      container: [],
    });
  });
});

describe("an id the compiler would drop", () => {
  it("is reported, rather than saved into nothing", () => {
    /*
     * The COMPILER's limit, not one chosen here. `namedDefinition` keeps a
     * definition only while `def.id.length <= MAX_BREAKPOINT_ID_LENGTH`, so an
     * id this screen accepted would save, report success, and then exist
     * nowhere — with every style filed under it silently unapplied.
     *
     * Asserted at the boundary in both directions, because an off-by-one here
     * is the whole defect: one character over must be reported, and exactly at
     * the limit must not.
     */
    const idOf = (length: number) => "b".repeat(length);
    const setWith = (id: string) =>
      ({
        viewport: [{ id, label: "Wide", maxWidth: 900 }],
        container: [],
      }) as unknown as BreakpointSet;

    expect(
      validateBreakpoints(setWith(idOf(MAX_BREAKPOINT_ID_LENGTH + 1))).map(
        issue => issue.code
      )
    ).toContain("id-too-long");
    expect(
      validateBreakpoints(setWith(idOf(MAX_BREAKPOINT_ID_LENGTH))).map(
        issue => issue.code
      )
    ).not.toContain("id-too-long");
  });
});

describe("breakpoint definitions the compiler would keep", () => {
  it("reports nothing for an ordinary desktop-first set", () => {
    // The positive control. Without it every rule below could be satisfied by a
    // validator that reports on everything.
    expect(
      codes(
        set({
          viewport: [
            { id: "tablet", label: "Tablet", maxWidth: 991 },
            { id: "mobile", label: "Mobile", maxWidth: 767 },
          ],
          container: [{ id: "card", label: "Card", maxWidth: 400 }],
        })
      )
    ).toEqual([]);
  });

  it("accepts ONE unbounded container definition", () => {
    // The container axis stores its own unbounded context and the compiler
    // keeps the first one, so reporting it would refuse a working set.
    expect(
      codes(set({ container: [{ id: "card-base", label: "Card base" }] }))
    ).toEqual([]);
  });
});

describe("definitions the compiler drops", () => {
  it("reports a viewport definition with no bound", () => {
    // Dropped: it would emit no at-rule and override the real base everywhere.
    expect(codes(set({ viewport: [{ id: "wide", label: "Wide" }] }))).toEqual([
      "width-required",
    ]);
  });

  it("reports a SECOND unbounded container definition, not the first", () => {
    const result = validateBreakpoints(
      set({
        container: [
          { id: "c1", label: "One" },
          { id: "c2", label: "Two" },
        ],
      })
    );

    expect(result.map(i => i.code)).toEqual(["second-unbounded-container"]);
    // The index matters: reporting row 0 would send the author to the
    // definition that is actually being kept.
    expect(result[0]?.index).toBe(1);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "reports a bound of %p, which is not a usable width",
    width => {
      expect(
        codes(set({ viewport: [{ id: "x", label: "X", maxWidth: width }] }))
      ).toEqual(["width-not-positive"]);
    }
  );

  it("reports an id repeated on the OTHER axis", () => {
    // The compiler claims ids across both axes at once, so this is a duplicate
    // even though neither list repeats itself.
    const result = validateBreakpoints(
      set({
        viewport: [{ id: "small", label: "Small", maxWidth: 600 }],
        container: [{ id: "small", label: "Small card", maxWidth: 300 }],
      })
    );

    expect(result.map(i => i.code)).toEqual(["id-duplicate"]);
    expect(result[0]?.axis).toBe("container");
  });

  it("reports the reserved base id", () => {
    // Claimed by the compiler before settings are read, so a definition using
    // it is a duplicate of something absent from the author's list.
    expect(
      codes(
        set({
          viewport: [{ id: BASE_BREAKPOINT, label: "Base", maxWidth: 1200 }],
        })
      )
    ).toEqual(["id-reserved"]);
  });

  it("reports two definitions ending at the same width", () => {
    expect(
      codes(
        set({
          viewport: [
            { id: "a", label: "A", maxWidth: 768 },
            { id: "b", label: "B", maxWidth: 768 },
          ],
        })
      )
    ).toEqual(["width-duplicate"]);
  });

  it("allows the same width on DIFFERENT axes", () => {
    // Different at-rules, so they do not collide. Counting widths globally
    // would report this and refuse a legitimate set.
    expect(
      codes(
        set({
          viewport: [{ id: "v", label: "V", maxWidth: 500 }],
          container: [{ id: "c", label: "C", maxWidth: 500 }],
        })
      )
    ).toEqual([]);
  });

  // The two caps are LITERALS. Sizing the fixture with `storedLimitFor` would
  // make it move with the function under test, so any cap the function returns
  // agrees with itself and the assertion holds for every value of it.
  it("stores 6 viewport breakpoints, one fewer than the declared maximum", () => {
    // The compiler inserts the unconditional viewport context itself and it
    // counts against the same cap, so only 6 can be stored.
    expect(storedLimitFor("viewport")).toBe(6);
    expect(codes(set({ viewport: rows("bp", 6) }))).toEqual([]);
    expect(codes(set({ viewport: rows("bp", 7) }))).toEqual([
      "over-axis-limit",
    ]);
  });

  it("marks the NARROWEST row when stored order is reversed", () => {
    // The separating case. `rows()` above happens to be widest-first, so the
    // last stored row is also the narrowest and a check keyed on stored
    // position agrees with the compiler by coincidence. Reversed, they
    // disagree: the compiler sorts widest-first and keeps the front, so it
    // drops the narrowest — while stored position points at the widest, which
    // it keeps. Directing an author to delete that one is worse than silence.
    const narrowestFirst = Array.from({ length: 7 }, (_, i) => ({
      id: `bp-${i}`,
      label: `BP ${i}`,
      maxWidth: 400 + i * 100,
    }));

    const reported = validateBreakpoints(set({ viewport: narrowestFirst }))
      .filter(issue => issue.code === "over-axis-limit")
      .map(issue => issue.index);

    expect(reported).toEqual([0]);
  });

  it("stores the full 7 on the container axis", () => {
    // The separating case: the container axis stores its own unbounded context,
    // so it keeps the whole cap. A validator applying the viewport's reduced
    // limit to both would report this legal set.
    expect(storedLimitFor("container")).toBe(MAX_BREAKPOINTS_PER_AXIS);
    expect(codes(set({ container: rows("c", 7) }))).toEqual([]);
    expect(codes(set({ container: rows("c", 8) }))).toEqual([
      "over-axis-limit",
    ]);
  });

  it("reports an empty id and an empty label on their own fields", () => {
    // Empty, not blank. A stored id of `"  "` is a legal key the compiler uses
    // verbatim, and an author's typing is trimmed on a NEW row before it
    // arrives here — so blank reaching this point means a saved id nobody can
    // edit, and reporting it would disable Save with no way out.
    const result = validateBreakpoints(
      set({ viewport: [{ id: "", label: "", maxWidth: 600 }] })
    );

    expect(result.map(i => ({ field: i.field, code: i.code }))).toEqual([
      { field: "id", code: "id-required" },
      { field: "label", code: "label-required" },
    ]);
  });
});

describe("ids are compared as the compiler compares them", () => {
  it("treats a padded id as its own breakpoint, not a duplicate", () => {
    // The compiler keys styles by the stored string, so these are two
    // breakpoints. Reporting them as duplicates would disable Save on a legal
    // set the author cannot repair, because a saved id is read-only.
    expect(
      codes(
        set({
          viewport: [
            { id: "tablet", label: "Tablet", maxWidth: 991 },
            { id: " tablet ", label: "Legacy tablet", maxWidth: 900 },
          ],
        })
      )
    ).toEqual([]);
  });

  it("does not treat a padded base as the reserved id", () => {
    expect(
      codes(
        set({
          viewport: [{ id: " base ", label: "Legacy base", maxWidth: 1200 }],
        })
      )
    ).toEqual([]);
  });

  it("still reports the reserved id exactly", () => {
    // The positive control for the two above: dropping the reserved check
    // entirely would satisfy them both.
    expect(
      codes(set({ viewport: [{ id: "base", label: "B", maxWidth: 1200 }] }))
    ).toEqual(["id-reserved"]);
  });
});

describe("cascade order", () => {
  it("puts an unbounded definition first, then widest to narrowest", () => {
    const ordered = inCascadeOrder([
      { id: "narrow", label: "Narrow", maxWidth: 400 },
      { id: "unbounded", label: "Unbounded" },
      { id: "wide", label: "Wide", maxWidth: 900 },
    ]);

    expect(ordered.map(d => d.id)).toEqual(["unbounded", "wide", "narrow"]);
  });

  it("does not mutate the array it was given", () => {
    const defs = [
      { id: "a", label: "A", maxWidth: 100 },
      { id: "b", label: "B", maxWidth: 900 },
    ];
    inCascadeOrder(defs);

    expect(defs.map(d => d.id)).toEqual(["a", "b"]);
  });
});

describe("which breakpoints are live while one is being edited", () => {
  /**
   * Both axes populated and the widths deliberately interleaved ACROSS them, so
   * a implementation that pooled the two axes and compared widths would pick up
   * a container definition here and be caught.
   */
  const SET = {
    viewport: [
      { id: "base", label: "Base" },
      { id: "vp-lg", label: "Large", maxWidth: 1024 },
      { id: "vp-md", label: "Medium", maxWidth: 768 },
      { id: "vp-sm", label: "Small", maxWidth: 480 },
    ],
    container: [
      { id: "c-base", label: "Container base" },
      { id: "c-wide", label: "Wide", maxWidth: 900 },
      { id: "c-narrow", label: "Narrow", maxWidth: 600 },
    ],
  };

  it("runs OUTWARD from the edited breakpoint, never inward", () => {
    /*
     * Desktop-first: every bounded definition compiles to `max-width`, so a
     * narrow width satisfies its own query and every wider one too. The
     * narrower `vp-sm` is NOT live at 768 — an implementation that returned the
     * whole axis would include it, and the control would report a value from a
     * rule the browser is not applying.
     */
    const live = liveBreakpointsFor(SET, "vp-md");
    expect([...live].sort()).toEqual(["base", "vp-lg", "vp-md"].sort());
  });

  it("includes the edited breakpoint itself", () => {
    expect(liveBreakpointsFor(SET, "vp-sm")).toContain("vp-sm");
  });

  it("takes the widest breakpoint to be live with only the base", () => {
    const live = liveBreakpointsFor(SET, "vp-lg");
    expect([...live].sort()).toEqual(["base", "vp-lg"].sort());
  });

  it("excludes the container axis ENTIRELY while a viewport breakpoint is edited", () => {
    /*
     * Including the container's unbounded context looks harmless and is not.
     * Even at its widest a container context emits `@container (min-width: 0)`,
     * which matches only an element that HAS a query-container ancestor —
     * whether the selected block does is a fact about the rendered tree this
     * arithmetic cannot see. Treated as live, a container declaration can win
     * for a root block the browser applies nothing to, and the control states
     * something false rather than staying quiet.
     *
     * `c-wide` at 900 would also be picked up by any rule comparing widths
     * across the axes, which is the second thing this pins.
     */
    const live = liveBreakpointsFor(SET, "vp-md");
    expect(live).not.toContain("c-base");
    expect(live).not.toContain("c-wide");
    expect(live).not.toContain("c-narrow");
  });

  it("reads the container axis the same way when a container is edited", () => {
    // The symmetry matters: the axes are peers, and a rule written only for the
    // viewport would silently report every container edit against the bases.
    const live = liveBreakpointsFor(SET, "c-narrow");
    expect([...live].sort()).toEqual(
      ["base", "c-base", "c-narrow", "c-wide"].sort()
    );
    expect(live).not.toContain("vp-md");
  });

  it("yields the viewport base alone for the unconditional breakpoint", () => {
    expect(liveBreakpointsFor(SET, "base")).toEqual(["base"]);
  });

  it("yields the viewport base alone for an id belonging to neither axis", () => {
    // What an unrecognised breakpoint actually leaves matching, rather than an
    // empty set that would report every control as unset.
    expect(liveBreakpointsFor(SET, "gone")).toEqual(["base"]);
  });

  it("admits the container axis once the author is EDITING it", () => {
    /*
     * The one case where the context is not a guess: choosing to edit a
     * container breakpoint is the author saying which container they mean. The
     * viewport base stays in because it matches at every width regardless.
     */
    const live = liveBreakpointsFor(SET, "c-narrow");
    expect([...live].sort()).toEqual(
      ["base", "c-base", "c-narrow", "c-wide"].sort()
    );
  });

  it("never names a definition the COMPILER dropped", () => {
    /*
     * The whole reason this reads `breakpointContexts` rather than the stored
     * set, and the case a raw read gets wrong in both directions.
     *
     * `vp-broken` has a bound of zero. A `@media (max-width: 0px)` query is
     * well-formed and can never match, so the compiler drops the definition
     * entirely — the id is simply not one this site defines. Read raw it looks
     * like an ordinary breakpoint, and naming it would tell an author a value
     * came from a rule no stylesheet contains.
     */
    const set = {
      viewport: [
        { id: "base", label: "Base" },
        { id: "vp-broken", label: "Broken", maxWidth: 0 },
        { id: "vp-md", label: "Medium", maxWidth: 768 },
      ],
      container: [],
    };
    const live = liveBreakpointsFor(set, "vp-md");
    expect(live).toContain("vp-md");
    // The separating half: it IS wider by the stored number, so anything
    // comparing stored widths would include it.
    expect(live).not.toContain("vp-broken");
  });

  it("yields only the unbounded contexts when the edited id was dropped", () => {
    // An author can be sitting on a breakpoint whose definition the compiler
    // refuses. Reporting its own id as live would claim rules exist under a
    // query that was never emitted.
    const set = {
      viewport: [
        { id: "base", label: "Base" },
        { id: "vp-broken", label: "Broken", maxWidth: Number.NaN },
      ],
      container: [],
    };
    expect(liveBreakpointsFor(set, "vp-broken")).toEqual(["base"]);
  });

  it("keeps only the FIRST of a duplicated id, as the compiler does", () => {
    /*
     * One id resolves to one definition. The second `dup` is not a breakpoint
     * this site defines, and the width that decides liveness is the first
     * one's — so a reader that took the last would answer against a bound no
     * rule was emitted under.
     */
    const set = {
      viewport: [
        { id: "base", label: "Base" },
        { id: "dup", label: "First", maxWidth: 1024 },
        { id: "dup", label: "Second", maxWidth: 320 },
        { id: "vp-md", label: "Medium", maxWidth: 768 },
      ],
      container: [],
    };
    // Live at 768 because the surviving `dup` is the 1024 one, which is wider.
    expect(liveBreakpointsFor(set, "vp-md")).toContain("dup");
    // And editing `dup` itself puts the narrower `vp-md` out of play, which is
    // only true if the 1024 definition is the one that survived.
    expect(liveBreakpointsFor(set, "dup")).not.toContain("vp-md");
  });

  it("drops an unbounded VIEWPORT definition rather than adding a second base", () => {
    // It would emit no at-rule at all and override the real base at every
    // width. The compiler refuses it, so naming it would report a value as
    // arriving from a context that does not exist.
    const set = {
      viewport: [
        { id: "base", label: "Base" },
        { id: "vp-nobound", label: "No bound" },
      ],
      container: [],
    };
    expect(liveBreakpointsFor(set, "base")).toEqual(["base"]);
  });

  it("survives a settings record with no breakpoints at all", () => {
    // `breakpointContexts` accepts undefined and answers with the base context,
    // so an unconfigured site gets an honest answer rather than an empty one
    // that would report every control as unset.
    expect(liveBreakpointsFor(undefined, "base")).toEqual(["base"]);
  });
});

describe("which breakpoints the BROWSER is applying", () => {
  const SET2 = {
    viewport: [
      { id: "base", label: "Base" },
      { id: "vp-lg", label: "Large", maxWidth: 1024 },
      { id: "vp-md", label: "Medium", maxWidth: 768 },
    ],
    container: [
      { id: "c-base", label: "Container base" },
      { id: "c-narrow", label: "Narrow", maxWidth: 600 },
    ],
  };

  it("asks exactly these conditions, in this order", () => {
    /*
     * The observable contract, pinned.
     *
     * What this does NOT establish, and it is worth saying rather than implying:
     * that the condition was DERIVED from the compiler's at-rule rather than
     * rebuilt from `maxWidth`. For the emitted form the two produce identical
     * strings, so no fixture can separate them today. Taking the at-rule is
     * still the right construction — it cannot drift when the emitted form
     * changes, where a rebuild would — but that is an argument about future
     * change, and this test cannot make it.
     */
    const asked: string[] = [];
    matchedBreakpoints(SET2, query => {
      asked.push(query);
      return false;
    });
    expect(asked).toEqual(["(max-width: 1024px)", "(max-width: 768px)"]);
  });

  it("reports the contexts whose query matches, plus the unconditional one", () => {
    const live = matchedBreakpoints(SET2, query => query.includes("1024"));
    expect([...live].sort()).toEqual(["base", "vp-lg"].sort());
  });

  it("reports the unconditional context when nothing matches", () => {
    // What is certainly live anywhere, and what a runtime with no `matchMedia`
    // is given.
    expect(matchedBreakpoints(SET2, () => false)).toEqual(["base"]);
  });

  it("never asks about a CONTAINER context, whatever the browser answers", () => {
    /*
     * A `@container` query resolves against an element's query container rather
     * than the viewport, so `matchMedia` has nothing to say about it — and an
     * answer of `true` would be picked up as live for every block on the page.
     *
     * The `matches => true` argument is what makes this bite: a filter that
     * merely happened not to match would pass a permissive probe, and this one
     * fails unless the context is never asked about at all.
     */
    const asked: string[] = [];
    matchedBreakpoints(SET2, query => {
      asked.push(query);
      return true;
    });
    expect(asked.some(query => query.includes("600"))).toBe(false);
    expect(matchedBreakpoints(SET2, () => true)).not.toContain("c-narrow");
    expect(matchedBreakpoints(SET2, () => true)).not.toContain("c-base");
  });

  it("subscribes to exactly the queries it evaluates", () => {
    /*
     * The two must agree. A subscriber listening to a different set than the
     * reader evaluates is a panel that stops updating at precisely the widths it
     * was added for.
     */
    const evaluated: string[] = [];
    matchedBreakpoints(SET2, query => {
      evaluated.push(query);
      return false;
    });
    expect(breakpointQueries(SET2)).toEqual(evaluated);
  });
});
