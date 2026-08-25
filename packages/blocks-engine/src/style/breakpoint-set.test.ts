/**
 * What a stored breakpoint set means, as opposed to what it literally contains.
 *
 * Both questions here are answered identically by every surface that reads a
 * site's breakpoints, and neither is answered by the type. A surface getting one
 * wrong does not fail — it shows a plausible list that disagrees with the one
 * beside it, which is why these live in the engine rather than in whichever
 * package happened to ask first.
 *
 * @module breakpoint-set.test
 */
import { describe, expect, it } from "vitest";

import type { BreakpointSet } from "../document";

import { authoredBreakpoints, inCascadeOrder } from "./breakpoint-set";

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
