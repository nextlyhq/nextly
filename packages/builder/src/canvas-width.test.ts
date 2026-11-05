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
  editingBreakpointOf,
  fallbackBreakpoint,
  frameFitScale,
  frameFillingRegion,
  previewHeight,
  previewWidth,
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

  it("is the APPLIES-FROM width for the unconditional tier", () => {
    /*
     * It used to be `undefined` — as wide as the region allows — on the
     * reasoning that pinning the widest tier to a number would invent a bound
     * the site never declared and put empty gutters around a canvas that was
     * already the right size. The number is not invented: it is one past the
     * widest bound, and the canvas is scaled to fit rather than guttered.
     *
     * A JUMP and a CHOICE are the same act reached two ways, so this has to
     * agree with what the switcher sets. Answering `undefined` here released
     * the canvas to the region — which, wherever the region is narrower than
     * the widest bound, lands on the tier the author was jumping AWAY from.
     */
    expect(widthForBreakpoint(site(), "base")).toBe(baseWidth(site()));
    expect(widthForBreakpoint(site(), "base")).toBe(992);
  });

  it("is UNBOUNDED for base where the site bounds NOTHING", () => {
    /*
     * The control, and the case the old reasoning was right about: with no
     * viewport tier there is no width to go to, base applies everywhere, and
     * the region is where the canvas belongs.
     */
    expect(
      widthForBreakpoint({ viewport: [], container: [] }, "base")
    ).toBeUndefined();
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

describe("the width a device is previewed at", () => {
  it("shows the base breakpoint, Desktop, at 1280", () => {
    expect(previewWidth(site(), BASE_BREAKPOINT)).toBe(1280);
  });

  it("shows a bounded breakpoint at its own bound, not a device's width", () => {
    expect(previewWidth(site(), "tablet")).toBe(991);
    expect(previewWidth(site(), "mobile")).toBe(575);
  });

  it("keeps the base outside the widest breakpoint on a site with a wide one", () => {
    // At 1280 a site whose widest bound is 1439 would put the base preview
    // inside that breakpoint, so editing "Desktop" would style the wider tier.
    const wide: BreakpointSet = {
      viewport: [{ id: "laptop", label: "Laptop", maxWidth: 1439 }],
      container: [],
    };
    expect(previewWidth(wide, BASE_BREAKPOINT)).toBe(1440);
    expect(editedBreakpointAtWidth(wide, 1440)).toBe(BASE_BREAKPOINT);
  });

  it("previews nothing for a breakpoint the site does not define", () => {
    expect(previewWidth(site(), "watch")).toBeUndefined();
  });

  it("previews nothing on a site with no viewport breakpoints", () => {
    // Nothing to simulate: the canvas fills its region.
    const none: BreakpointSet = { viewport: [], container: [] };
    expect(previewWidth(none, BASE_BREAKPOINT)).toBeUndefined();
  });

  it("previews each bounded breakpoint at a width that edits that breakpoint", () => {
    for (const tier of offeredTiers(site())) {
      const width = previewWidth(site(), tier.id);
      expect(editedBreakpointAtWidth(site(), width)).toBe(tier.id);
    }
  });
});

describe("the device an edit goes to", () => {
  it("is the base breakpoint when none was chosen", () => {
    expect(editingBreakpointOf(site(), null)).toBe(BASE_BREAKPOINT);
  });

  it("is the breakpoint the author chose", () => {
    expect(editingBreakpointOf(site(), "tablet")).toBe("tablet");
    expect(editingBreakpointOf(site(), BASE_BREAKPOINT)).toBe(BASE_BREAKPOINT);
  });

  it("falls back to the base breakpoint when the chosen one was removed", () => {
    // Deterministic, and never a breakpoint the site no longer defines: an
    // edit stored under that would never be drawn.
    expect(editingBreakpointOf(site(), "watch")).toBe(BASE_BREAKPOINT);
    const none: BreakpointSet = { viewport: [], container: [] };
    expect(editingBreakpointOf(none, "tablet")).toBe(BASE_BREAKPOINT);
  });

  it("never edits a container breakpoint as a device", () => {
    const withContainer: BreakpointSet = {
      viewport: [{ id: "tablet", label: "Tablet", maxWidth: 991 }],
      container: [{ id: "card", label: "Card", maxWidth: 400 }],
    };
    expect(editingBreakpointOf(withContainer, "card")).toBe(BASE_BREAKPOINT);
  });
});

describe("the device edited once the chosen one is removed", () => {
  /*
   * Four bounded devices, so a removal in the middle has both a narrower and
   * a wider neighbour, and the answer shows which way the fallback moves.
   */
  const four = (): BreakpointSet => ({
    viewport: [
      { id: "laptop", label: "Laptop", maxWidth: 1199 },
      { id: "tablet", label: "Tablet", maxWidth: 991 },
      { id: "small", label: "Small tablet", maxWidth: 767 },
      { id: "mobile", label: "Mobile", maxWidth: 575 },
    ],
    container: [],
  });
  const without = (set: BreakpointSet, ...ids: string[]): BreakpointSet => ({
    ...set,
    viewport: set.viewport.filter(entry => !ids.includes(entry.id)),
  });

  it("moves to the narrowest breakpoint wider than the removed one", () => {
    // Tablet, the next one up: not Laptop, the widest remaining, and not
    // Mobile, the next one down.
    expect(fallbackBreakpoint(four(), without(four(), "small"), "small")).toBe(
      "tablet"
    );
    // With the next one up removed too, the one beyond it.
    expect(
      fallbackBreakpoint(four(), without(four(), "small", "tablet"), "small")
    ).toBe("laptop");
  });

  it("keeps the width when a breakpoint at the same bound remains", () => {
    /*
     * Two at one bound: only the later is offered, until it is removed and the
     * earlier one is offered at that same width. Strictly wider would skip it
     * for Laptop.
     */
    const doubled: BreakpointSet = {
      viewport: [
        { id: "laptop", label: "Laptop", maxWidth: 1199 },
        { id: "tablet", label: "Tablet", maxWidth: 991 },
        { id: "tablet-wide", label: "Wide tablet", maxWidth: 991 },
        { id: "mobile", label: "Mobile", maxWidth: 575 },
      ],
      container: [],
    };
    expect(
      fallbackBreakpoint(
        doubled,
        without(doubled, "tablet-wide"),
        "tablet-wide"
      )
    ).toBe("tablet");
  });

  it("moves to the base when no wider breakpoint remains", () => {
    // Narrower ones remain, and none of them is chosen.
    expect(
      fallbackBreakpoint(four(), without(four(), "laptop", "tablet"), "tablet")
    ).toBe(BASE_BREAKPOINT);
  });

  it("moves to the base when the removed one was the widest", () => {
    expect(
      fallbackBreakpoint(four(), without(four(), "laptop"), "laptop")
    ).toBe(BASE_BREAKPOINT);
  });

  it("keeps the chosen breakpoint while the site still has it", () => {
    // Another one removed, a wider one among them.
    expect(fallbackBreakpoint(four(), without(four(), "laptop"), "small")).toBe(
      "small"
    );
    // Its own bound moved: still the same breakpoint.
    const moved: BreakpointSet = {
      ...four(),
      viewport: four().viewport.map(entry =>
        entry.id === "small" ? { ...entry, maxWidth: 1300 } : entry
      ),
    };
    expect(fallbackBreakpoint(four(), moved, "small")).toBe("small");
    expect(fallbackBreakpoint(four(), four(), null)).toBe(BASE_BREAKPOINT);
  });

  it("goes to the base for a choice the earlier set never offered", () => {
    // No width to compare: a stored choice for a breakpoint already gone.
    expect(fallbackBreakpoint(four(), four(), "watch")).toBe(BASE_BREAKPOINT);
  });
});

describe("the height a device is previewed at", () => {
  it("changes band exactly at 600 and at 1024", () => {
    // Each pair straddles a bound, so a band written with `<=` instead of `<`
    // moves one of the four and fails here.
    expect(previewHeight(599)).toBe(844);
    expect(previewHeight(600)).toBe(1024);
    expect(previewHeight(1023)).toBe(1024);
    expect(previewHeight(1024)).toBe(800);
  });

  it("gives a site-added breakpoint the height of the band its width is in", () => {
    // A breakpoint no preset knows about still has a width, and the bands
    // answer for it. Read through `previewWidth`, which is how the frame gets
    // its width, so the pair is tested as the frame will use it.
    const custom: BreakpointSet = {
      viewport: [
        { id: "phablet", label: "Phablet", maxWidth: 700 },
        { id: "small", label: "Small", maxWidth: 480 },
      ],
      container: [],
    };
    const phablet = previewWidth(custom, "phablet");
    const small = previewWidth(custom, "small");
    const base = previewWidth(custom, BASE_BREAKPOINT);
    expect(phablet).toBe(700);
    expect(small).toBe(480);
    expect(base).toBe(1280);
    expect(previewHeight(phablet ?? 0)).toBe(1024);
    expect(previewHeight(small ?? 0)).toBe(844);
    expect(previewHeight(base ?? 0)).toBe(800);
  });
});

describe("a frame that fills its region's height", () => {
  const region = { width: 1000, height: 820 };

  it("fits the device's width, and is as tall as the region at that scale", () => {
    // Desktop at 1280 in a 1000-wide region: scaled to fit its width, and
    // tall enough that painted it fills the region from top to bottom.
    const { scale, height } = frameFillingRegion(1280, region, { kind: "fit" });
    expect(scale).toBeCloseTo(1000 / 1280);
    expect(height * scale).toBeCloseTo(820);
  });

  it("fills the region at a chosen zoom too", () => {
    for (const chosen of [0.5, 1, 2]) {
      const { scale, height } = frameFillingRegion(1280, region, {
        kind: "fixed",
        scale: chosen,
      });
      expect(scale).toBe(chosen);
      expect(height * scale, String(chosen)).toBeCloseTo(820);
    }
  });

  it("is never drawn larger than life to fit", () => {
    // A phone in a wide region fits at 1, not magnified.
    const { scale, height } = frameFillingRegion(390, region, { kind: "fit" });
    expect(scale).toBe(1);
    expect(height).toBe(820);
  });

  it("holds a chosen zoom before the region is measured", () => {
    expect(
      frameFillingRegion(1280, undefined, { kind: "fixed", scale: 0.5 })
    ).toEqual({ scale: 0.5, height: previewHeight(1280) });
  });

  it("keeps the device's own height until the region is measured", () => {
    expect(frameFillingRegion(1280, undefined, { kind: "fit" })).toEqual({
      scale: 1,
      height: previewHeight(1280),
    });
  });
});

describe("the scale that fits a frame into its region", () => {
  const desktop = { width: 1280, height: 800 };

  it("fits the width when the width is what does not fit", () => {
    expect(frameFitScale(desktop, { width: 640, height: 2000 })).toBe(0.5);
  });

  it("fits the HEIGHT when the height is what does not fit", () => {
    // The case a width-only fit gets wrong: the region is as wide as the
    // frame, so fitting the width alone answers 1 and the bottom half of the
    // previewed viewport is off screen.
    expect(frameFitScale(desktop, { width: 1280, height: 400 })).toBe(0.5);
  });

  it("takes the smaller ratio when neither dimension fits", () => {
    expect(frameFitScale(desktop, { width: 960, height: 200 })).toBe(0.25);
    expect(frameFitScale(desktop, { width: 320, height: 600 })).toBe(0.25);
  });

  it("never magnifies a frame smaller than its region", () => {
    expect(frameFitScale(desktop, { width: 4000, height: 4000 })).toBe(1);
  });

  it("is the identity for a region not measured yet, or of zero", () => {
    expect(frameFitScale(desktop, {})).toBe(1);
    expect(frameFitScale(desktop, { width: 640 })).toBe(1);
    expect(frameFitScale(desktop, { width: 0, height: 800 })).toBe(1);
    expect(frameFitScale(desktop, { width: 640, height: Number.NaN })).toBe(1);
  });
});
