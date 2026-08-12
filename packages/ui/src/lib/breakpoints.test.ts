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

import {
  BASE_BREAKPOINT_ID,
  MAX_BREAKPOINTS_PER_AXIS,
  storedLimitFor,
  validateBreakpoints,
  inCascadeOrder,
  type BreakpointIssueCode,
  type BreakpointSet,
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
          viewport: [{ id: BASE_BREAKPOINT_ID, label: "Base", maxWidth: 1200 }],
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
    const result = validateBreakpoints(
      set({ viewport: [{ id: "  ", label: "", maxWidth: 600 }] })
    );

    expect(result.map(i => ({ field: i.field, code: i.code }))).toEqual([
      { field: "id", code: "id-required" },
      { field: "label", code: "label-required" },
    ]);
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
