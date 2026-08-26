/**
 * That a canvas width decides which tiers apply and which one an edit lands in,
 * and that this module's arithmetic still agrees with the query the compiler
 * emits.
 *
 * The last one is the point of the file. Everything else here could be correct
 * against a compiler that has moved, and the failure would be silent: the
 * canvas would size a box, report a tier, and the sheet inside it would be
 * obeying a different condition.
 *
 * @module canvas-width.test
 */
import { describe, expect, it } from "vitest";

import {
  BASE_BREAKPOINT,
  breakpointContexts,
  type BreakpointSet,
} from "@nextlyhq/blocks-engine";

import {
  baseWidth,
  breakpointsAtWidth,
  editedBreakpointAtWidth,
  widthForBreakpoint,
  offeredTiers,
} from "./canvas-width";

const site = (): BreakpointSet => ({
  viewport: [
    { id: "tablet", label: "Tablet", maxWidth: 991 },
    { id: "mobile", label: "Mobile", maxWidth: 575 },
  ],
  container: [],
});

describe("which tiers a canvas of a given width is applying", () => {
  it("applies a tier AT its bound, because the query is inclusive", () => {
    /*
     * The boundary, and the direction that matters. `(max-width: 991px)` applies
     * at exactly 991, so an off-by-one here puts the canvas one pixel outside
     * the tier the switcher just selected — the author picks Tablet, the box is
     * sized to the tablet bound, and the page renders desktop.
     *
     * Asserted at 991 and at 992 together, so a version that simply always
     * included the tier passes neither.
     */
    expect(breakpointsAtWidth(site(), 991)).toContain("tablet");
    expect(breakpointsAtWidth(site(), 992)).not.toContain("tablet");
  });

  it("applies EVERY tier the width is inside, not just the narrowest", () => {
    // Desktop-first: at 500 the base, tablet and mobile declarations are all in
    // play and the cascade decides between them. Reporting only the narrowest
    // would tell the panel that a value authored at tablet is not live, when it
    // is exactly what the browser falls back to for anything mobile omits.
    const live = breakpointsAtWidth(site(), 500);

    expect(live).toContain("base");
    expect(live).toContain("tablet");
    expect(live).toContain("mobile");
  });

  it("applies the unconditional tier ALONE at a width above every bound", () => {
    // The control for the case above: without it, a function returning every
    // id at every width would satisfy the containment assertions there.
    expect(breakpointsAtWidth(site(), 1600)).toEqual(["base"]);
  });

  it("reports the unconditional tier alone when nothing has been MEASURED", () => {
    /*
     * `undefined` is "no layout has run yet", which is a different fact from any
     * particular width and must not be guessed at.
     *
     * Reporting the widest preset here would be a claim about a box nobody has
     * measured, and it would also disagree with the server render — React
     * discards a subtree whose two renders differ, which would take the Style
     * tab with it.
     */
    expect(breakpointsAtWidth(site(), undefined)).toEqual(["base"]);
  });

  it("EXCLUDES the container axis, which a width cannot answer for", () => {
    /*
     * Even at its widest a container context emits `@container (min-width: 0)`,
     * which matches only an element that HAS a query container above it.
     * Whether the selected block does is a fact about the rendered tree, so a
     * width cannot decide it — and including it would report a container
     * declaration as live for a block the browser applies nothing to.
     *
     * The viewport tier of the same width is asserted alongside, so a function
     * that dropped every tier would not pass by excluding this one.
     */
    const withContainer: BreakpointSet = {
      viewport: [{ id: "tablet", label: "Tablet", maxWidth: 991 }],
      container: [{ id: "card", label: "Card", maxWidth: 991 }],
    };

    const live = breakpointsAtWidth(withContainer, 500);

    expect(live).toContain("tablet");
    expect(live).not.toContain("card");
  });
});

describe("which tier an edit lands in", () => {
  it("lands in the NARROWEST tier applying, which is what the browser paints", () => {
    /*
     * At 500 both tablet and mobile apply and mobile is what wins. An edit that
     * landed in tablet there would change a value the author cannot see change,
     * because the mobile declaration is still covering it.
     */
    expect(editedBreakpointAtWidth(site(), 500)).toBe("mobile");
    expect(editedBreakpointAtWidth(site(), 800)).toBe("tablet");
  });

  it("lands in the unconditional tier above every bound", () => {
    expect(editedBreakpointAtWidth(site(), 1600)).toBe("base");
  });

  it("lands in the unconditional tier for a site defining NO breakpoints", () => {
    // Not an error and not a guess: a site with no tiers edits the tier it has.
    expect(editedBreakpointAtWidth({ viewport: [], container: [] }, 400)).toBe(
      "base"
    );
  });

  it("never lands in a CONTAINER tier, however narrow the canvas", () => {
    // The counterpart to the exclusion above, stated where it would do damage:
    // an edit addressed to a container tier is written into a context the
    // canvas cannot show, so the author sees nothing happen.
    const withContainer: BreakpointSet = {
      viewport: [],
      container: [{ id: "card", label: "Card", maxWidth: 300 }],
    };

    expect(editedBreakpointAtWidth(withContainer, 200)).toBe("base");
  });
});

describe("the width a tier is shown at", () => {
  it("is the tier's OWN bound, where it is at its roomiest", () => {
    // Inclusive, so the bound is inside the tier — and it is the width at which
    // a layout decision for that tier is actually made.
    expect(widthForBreakpoint(site(), "tablet")).toBe(991);
    expect(widthForBreakpoint(site(), "mobile")).toBe(575);
  });

  it("is UNBOUNDED for the unconditional tier, not a number", () => {
    /*
     * `undefined` means "as wide as the region allows". Pinning the widest tier
     * to a number would invent a bound the site never declared and make the
     * widest preset narrower than the space available — the canvas would gain
     * empty gutters on selecting the tier it was already showing.
     */
    expect(widthForBreakpoint(site(), "base")).toBeUndefined();
  });

  it("is UNBOUNDED for an id the site does not define", () => {
    // Refusing to size rather than sizing to a guess: an unknown id is a
    // caller's mistake, and a canvas that silently narrowed would look like the
    // switcher worked.
    expect(widthForBreakpoint(site(), "watch")).toBeUndefined();
  });
});

describe("the arithmetic still agrees with the query the compiler emits", () => {
  it("matches the emitted at-rule at every boundary, for every tier", () => {
    /*
     * The test this file exists for.
     *
     * `matchedBreakpoints` deliberately evaluates each context's OWN at-rule
     * text and its docblock warns that width arithmetic beside it would be a
     * second implementation of the same condition. This module does its
     * arithmetic on `maxWidth` — the structured field the compiler DERIVES that
     * text from — so the two are downstream of one value rather than two
     * readings of one string.
     *
     * That is an argument, not a guarantee. This pins it: the emitted text is
     * parsed back and compared against this module's answer at each tier's
     * bound and one pixel either side. A compiler that moved to `min-width`, to
     * a different unit, to a half-open bound, or to a range syntax fails here —
     * rather than silently sizing a box the sheet inside it disagrees with.
     */
    const set = site();
    const contexts = breakpointContexts(set).filter(
      context => context.axis !== "container" && context.maxWidth !== undefined
    );

    // The population, asserted before the property: an empty context list would
    // satisfy every comparison below without comparing anything.
    expect(contexts).toHaveLength(2);

    for (const context of contexts) {
      const emitted = /^@media \(max-width: (\d+)px\)$/.exec(
        context.atRule ?? ""
      );
      // The emitted FORM is part of the claim, not incidental to it. A context
      // whose at-rule this cannot read is a compiler change, and failing here
      // is the whole point.
      expect(
        emitted,
        `unreadable at-rule: ${context.atRule ?? "none"}`
      ).not.toBeNull();
      const bound = Number(emitted?.[1]);
      expect(bound).toBe(context.maxWidth);

      for (const width of [bound - 1, bound, bound + 1]) {
        expect(
          breakpointsAtWidth(set, width).includes(context.id),
          `${context.id} at ${width}px`
        ).toBe(width <= bound);
      }
    }
  });
});

describe("two tiers sharing one bound", () => {
  /*
   * A stored set can carry two viewport ids with the same `maxWidth` — written
   * through the API or an import, which the document model calls an error and
   * compilation does not assume validation caught.
   *
   * Measured against the compiler: both are emitted, in order, into a SINGLE
   * at-rule, so the LATER one's declarations are what the browser paints.
   */
  const shared = (): BreakpointSet => ({
    viewport: [
      { id: "alpha", label: "Alpha", maxWidth: 991 },
      { id: "beta", label: "Beta", maxWidth: 991 },
    ],
    container: [],
  });

  it("offers ONE of them, since selecting a tier only sets a width", () => {
    /*
     * Two radios emitting the same number are not two choices: the match
     * resolves to one, and clicking the other silently selects the first.
     */
    expect(offeredTiers(shared())).toHaveLength(1);
  });

  it("offers the one the browser PAINTS, not the one stored first", () => {
    /*
     * The discriminating half. A collapse keeping the first would satisfy the
     * count above while naming a tier whose value is overridden by the one
     * below it in the same at-rule — the author edits `alpha`, the page shows
     * `beta`, and nothing on screen says why.
     */
    expect(offeredTiers(shared())[0]?.id).toBe("beta");
  });

  it("lands an edit in the tier that WINS at that width", () => {
    /*
     * The same rule read through the other derivation, which has to agree with
     * the list above or the control offers one tier and the inspector writes to
     * another.
     */
    expect(editedBreakpointAtWidth(shared(), 991)).toBe("beta");
  });

  it("resolves NO width for the tier that lost the bound", () => {
    /*
     * `offeredTiers` collapses the two to the one the browser paints, and
     * `editedBreakpointAtWidth` writes there. A width lookup that still
     * answered for the loser would let a host set that width believing it
     * selected `alpha` while every edit lands in `beta` — the disagreement
     * between the control and the write that collapsing exists to remove.
     */
    expect(widthForBreakpoint(shared(), "beta")).toBe(991);
    expect(widthForBreakpoint(shared(), "alpha")).toBeUndefined();
  });

  it("still separates tiers whose bounds DIFFER", () => {
    /*
     * The control. Without it, a collapse keyed on something other than the
     * bound — or one that kept a single tier unconditionally — would satisfy
     * every case above.
     */
    const distinct: BreakpointSet = {
      viewport: [
        { id: "tablet", label: "Tablet", maxWidth: 991 },
        { id: "mobile", label: "Mobile", maxWidth: 575 },
      ],
      container: [],
    };

    expect(offeredTiers(distinct).map(tier => tier.id)).toEqual([
      "tablet",
      "mobile",
    ]);
  });
});

describe("the width at which the UNCONDITIONAL tier applies", () => {
  it("is one past the widest bound", () => {
    /*
     * A bounded tier applies at `width <= bound`, so the first width no bounded
     * tier claims is `bound + 1`. Asserted against the tier arithmetic rather
     * than against the literal alone, because the two agreeing is the property:
     * a number that did not actually resolve base would be a control that sizes
     * the canvas and selects the wrong tier, which is the defect this exists to
     * remove rather than a smaller version of it.
     */
    expect(baseWidth(site())).toBe(992);
    expect(editedBreakpointAtWidth(site(), 992)).toBe(BASE_BREAKPOINT);
    // The control: one pixel narrower is still the bounded tier, so the +1 is
    // load-bearing rather than decorative.
    expect(editedBreakpointAtWidth(site(), 991)).toBe("tablet");
  });

  it("is the SMALLEST width that resolves base", () => {
    /*
     * The canvas is scaled to fit, so every pixel past the first one costs the
     * author legibility and buys nothing. A conventional desktop number would
     * also be a width the site never declared — the same invention the tier
     * list refuses.
     */
    expect(baseWidth(site())).toBe(992);
    expect(editedBreakpointAtWidth(site(), baseWidth(site()) ?? 0)).toBe(
      BASE_BREAKPOINT
    );
  });

  it("is UNDEFINED when the site bounds no viewport tier", () => {
    /*
     * Base already applies at every width there, so there is no width to go to.
     * A number would size the canvas to a bound the site never declared.
     */
    expect(baseWidth(undefined)).toBeUndefined();
    expect(baseWidth({ viewport: [], container: [] })).toBeUndefined();
  });

  it("ignores the CONTAINER axis, as the tier list does", () => {
    /*
     * A container tier bounds a box inside the page, not the viewport, so the
     * width that would clear it says nothing about which viewport tier applies.
     * Counted here it would push the canvas wider than any viewport tier needs.
     */
    expect(
      baseWidth({
        viewport: [{ id: "tablet", label: "Tablet", maxWidth: 991 }],
        container: [{ id: "narrow", label: "Narrow", maxWidth: 1600 }],
      })
    ).toBe(992);
  });
});
