import { expect, test } from "@playwright/test";

/**
 * The spacing overlay, measured in a browser because nowhere else can measure it.
 *
 * `spacing-bands.test.ts` decides where a band goes given numbers, and
 * `spacing-overlay.test.tsx` decides which numbers it is given. Neither can say
 * whether the result lands on the space it names: jsdom lays nothing out and
 * reports every element as zero-sized, so a rectangle asserted there is a
 * statement about jsdom and passes against an overlay drawn wrongly for a real
 * author.
 *
 * Two properties are ONLY observable here:
 *
 * 1. **A logical value is reported on the physical edge it renders at.** The
 *    seed authors `padding: { blockEnd }` and `margin: { blockEnd }`; nothing in
 *    the document says "bottom". The browser resolves that, and this asserts the
 *    band came out on the bottom with the authored number on it — which is the
 *    whole argument for reading the rendered page rather than the stored tier.
 * 2. **The band covers the space.** A number drawn beside the wrong rectangle is
 *    worse than no overlay, because it reads as a measurement.
 */

const ROUTE = "/builder-canvas";
const NODE = "[data-nx-node]";

/**
 * The seeded block that carries both kinds of spacing, and the only one that
 * carries a padding at all.
 *
 * `padding: { blockEnd: "120px" }` and `margin: { blockEnd: "24px" }`. The two
 * differ so no assertion below can be satisfied by reading the wrong box.
 */
const PADDED = "hx-columns";
const PADDING_BOTTOM = 120;
const MARGIN_BOTTOM = 24;

const BAND = ".nx-spacing-overlay__band";
const band = (box: string, side: string) =>
  `${BAND}[data-box="${box}"][data-side="${side}"]`;

/** Layout is fractional, and a whole-pixel claim about it would be flaky. */
const TOLERANCE = 1.5;

test.describe("spacing values on the canvas", () => {
  test("draws nothing until a block is selected", async ({ page }) => {
    await page.goto(ROUTE);
    // The population first: an empty canvas would satisfy the assertion below
    // for a reason that has nothing to do with the overlay.
    await expect(page.locator(NODE).first()).toBeVisible();
    await expect(page.locator("[data-nx-selected]")).toHaveCount(0);

    await expect(page.locator(BAND)).toHaveCount(0);
  });

  test("reports a logical blockEnd on the PHYSICAL bottom edge", async ({
    page,
  }) => {
    await page.goto(ROUTE);
    const block = page.locator(`[data-nx-node="${PADDED}"]`);
    await expect(block).toBeVisible();

    await block.click();
    await expect(block).toHaveAttribute("data-nx-selected", "primary");

    /*
     * The document never says "bottom" — it says `blockEnd`, and the value
     * arrives on the bottom edge with the authored number on it.
     *
     * This is the END-TO-END case, not the separating one. In a horizontal
     * left-to-right document `margin-block-end` and `margin-bottom` compute to
     * the same value, so an implementation reading the LOGICAL property would
     * pass this too. The test below changes the writing mode, where the two
     * disagree and only one answer is right.
     */
    await expect(page.locator(band("padding", "bottom"))).toHaveText(
      String(PADDING_BOTTOM)
    );
    await expect(page.locator(band("margin", "bottom"))).toHaveText(
      String(MARGIN_BOTTOM)
    );

    // And the sides the seed did NOT author report nothing, which is what
    // separates this from an overlay that draws all eight sides always.
    await expect(page.locator(band("padding", "top"))).toHaveCount(0);
    await expect(page.locator(band("margin", "top"))).toHaveCount(0);
  });

  test("a vertical writing mode moves the band to the edge it RENDERS at", async ({
    page,
  }) => {
    /*
     * The separating property, and the only place it can be observed.
     *
     * `writing-mode: vertical-rl` puts the block axis horizontal, so the seed's
     * authored `padding: { blockEnd }` computes to `padding-left`. An overlay
     * reading the LOGICAL property still sees `padding-block-end: 120px` and
     * draws the band along the bottom, where there is no padding at all; one
     * reading the physical longhands follows the browser to the left edge.
     *
     * The mode is applied here rather than in the seed because that fixture is
     * shared, and other suites pin geometry that a writing mode would move.
     */
    await page.goto(ROUTE);
    const block = page.locator(`[data-nx-node="${PADDED}"]`);
    await expect(block).toBeVisible();

    await block.evaluate(node => {
      (node as HTMLElement).style.writingMode = "vertical-rl";
    });
    await block.click();
    await expect(block).toHaveAttribute("data-nx-selected", "primary");

    await expect(page.locator(band("padding", "left"))).toHaveText(
      String(PADDING_BOTTOM)
    );
    await expect(page.locator(band("padding", "bottom"))).toHaveCount(0);
  });

  test("the padding band covers the padding, at the bottom of the block", async ({
    page,
  }) => {
    await page.goto(ROUTE);
    const block = page.locator(`[data-nx-node="${PADDED}"]`);
    await expect(block).toBeVisible();
    await block.click();

    const blockBox = await block.boundingBox();
    const bandBox = await page.locator(band("padding", "bottom")).boundingBox();
    if (blockBox === null || bandBox === null) {
      throw new Error("the selected block or its padding band has no box");
    }

    // The extent is the authored padding, in real laid-out pixels.
    expect(Math.abs(bandBox.height - PADDING_BOTTOM)).toBeLessThan(TOLERANCE);

    // And it sits at the block's bottom INSIDE it, which is where padding is.
    // An overlay that drew padding outward would land this below the block and
    // still report the right height.
    const blockBottom = blockBox.y + blockBox.height;
    expect(Math.abs(bandBox.y + bandBox.height - blockBottom)).toBeLessThan(
      TOLERANCE
    );
    expect(bandBox.y).toBeGreaterThan(blockBox.y);
  });

  test("the margin band sits OUTSIDE the block, below its border edge", async ({
    page,
  }) => {
    await page.goto(ROUTE);
    const block = page.locator(`[data-nx-node="${PADDED}"]`);
    await expect(block).toBeVisible();
    await block.click();

    const blockBox = await block.boundingBox();
    const bandBox = await page.locator(band("margin", "bottom")).boundingBox();
    if (blockBox === null || bandBox === null) {
      throw new Error("the selected block or its margin band has no box");
    }

    expect(Math.abs(bandBox.height - MARGIN_BOTTOM)).toBeLessThan(TOLERANCE);

    // Its TOP is the block's bottom: margin begins where the border box ends.
    const blockBottom = blockBox.y + blockBox.height;
    expect(Math.abs(bandBox.y - blockBottom)).toBeLessThan(TOLERANCE);
  });

  test("a scaled block gets scaled BANDS and an unscaled LABEL", async ({
    page,
  }) => {
    /*
     * `transform` is a catalog property, so this is reachable by an author today
     * rather than a hypothetical about a future canvas zoom.
     *
     * The two halves pull apart under a transform and only one of them moves.
     * `getBoundingClientRect` reports the DRAWN box, so a block at half size has
     * half the padding on screen and the band has to match it. `getComputedStyle`
     * reports unscaled CSS pixels, and that is what the author typed — a band
     * reading `60` would name a value that appears nowhere in their document.
     */
    await page.goto(ROUTE);
    const block = page.locator(`[data-nx-node="${PADDED}"]`);
    await expect(block).toBeVisible();

    await block.evaluate(node => {
      (node as HTMLElement).style.transform = "scale(0.5)";
      (node as HTMLElement).style.transformOrigin = "top left";
    });
    await block.click();

    const bandBox = await page.locator(band("padding", "bottom")).boundingBox();
    if (bandBox === null) throw new Error("the padding band has no box");

    expect(Math.abs(bandBox.height - PADDING_BOTTOM / 2)).toBeLessThan(
      TOLERANCE
    );
    await expect(page.locator(band("padding", "bottom"))).toHaveText(
      String(PADDING_BOTTOM)
    );
  });

  test("a block with no layout box draws no bands at all", async ({ page }) => {
    /*
     * `display: none` keeps the element in the DOM and keeps its computed margin,
     * while every rectangle it reports reads zero. Without a guard the bands land
     * at the canvas origin naming space that is nowhere on screen — and the
     * author reaches this by selecting a hidden node in the Layers panel.
     */
    await page.goto(ROUTE);
    const block = page.locator(`[data-nx-node="${PADDED}"]`);
    await expect(block).toBeVisible();

    // Selected FIRST, so the bands demonstrably exist and their later absence is
    // the guard firing rather than a selection that never took.
    await block.click();
    await expect(page.locator(band("padding", "bottom"))).toHaveCount(1);

    /*
     * Hidden WITHOUT touching the selection, so the block under test is still
     * the one the overlay answers for. Clicking elsewhere would empty the bands
     * for the unrelated reason that the new selection has no padding, and the
     * assertion would pass against the guard being absent.
     *
     * Losing its box is a size change, so the block's own ResizeObserver entry
     * is what drives the re-measure — no extra nudge needed.
     */
    await block.evaluate(node => {
      (node as HTMLElement).style.display = "none";
    });

    await expect(page.locator(`${BAND}[data-box="padding"]`)).toHaveCount(0);
    await expect(page.locator(BAND)).toHaveCount(0);
  });

  test("bands FOLLOW the block when the ROOT's size does not change", async ({
    page,
  }) => {
    /*
     * The position-only reflow, asserted as a REDRAW and with a fixture that can
     * tell the two implementations apart.
     *
     * A sibling above the selection is grown and a sibling BELOW it shrunk by the
     * same amount, in one evaluation so the layout settles once. The selected
     * block moves down; the page's total height does not change; and
     * `.nx-canvas` is `min-height: 100%` sizing to that content, so the ROOT
     * emits no `ResizeObserver` entry at all.
     *
     * That is what makes this a separating test rather than another green. Growing
     * a sibling ALONE also moves the block, but it changes the page height too, so
     * the root reports it and an overlay watching only the root passes — measured,
     * by removing the per-node observation and watching this test stay green. The
     * unselected sibling that changed is the only element with anything to report,
     * so it has to be the one observed.
     */
    await page.goto(ROUTE);
    const block = page.locator(`[data-nx-node="${PADDED}"]`);
    await expect(block).toBeVisible();
    await block.click();

    const before = await page.locator(band("margin", "bottom")).boundingBox();
    const rootBefore = await page.locator(".nx-canvas").boundingBox();
    if (before === null || rootBefore === null) {
      throw new Error("no margin band or canvas root before the reflow");
    }

    const SHIFT = 200;
    await page.evaluate(shift => {
      const above = document.querySelector(
        '[data-nx-node="hx-heading"]'
      ) as HTMLElement;
      const below = document.querySelector(
        '[data-nx-node="hx-spacer"]'
      ) as HTMLElement;
      above.style.height = `${above.getBoundingClientRect().height + shift}px`;
      below.style.height = `${below.getBoundingClientRect().height - shift}px`;
    }, SHIFT);

    await expect
      .poll(async () => {
        const box = await page.locator(band("margin", "bottom")).boundingBox();
        return box === null ? null : Math.round(box.y - before.y);
      })
      .toBeGreaterThan(SHIFT - 5);

    // The control for the claim above: the root really did not resize, so the
    // redraw cannot be credited to the root's own entry.
    const rootAfter = await page.locator(".nx-canvas").boundingBox();
    expect(Math.abs((rootAfter?.height ?? 0) - rootBefore.height)).toBeLessThan(
      TOLERANCE
    );
  });

  test("a fractional untransformed box is NOT treated as scaled", async ({
    page,
  }) => {
    /*
     * The rounding defect, as a separating test rather than a claim that the new
     * code cannot have it.
     *
     * `offsetHeight` is integer-rounded and a bounding rectangle is not, so
     * deriving the scale from their ratio makes a block of fractional height
     * report a scale it does not have — worst at small sizes, where the rounding
     * is a large fraction of the value. Measured on this fixture: `offsetHeight`
     * reports `1` against a drawn height of `0.594`, so the ratio reads `0.594`
     * and the seeded `24px` margin band is drawn near `14px` on a block nobody
     * transformed.
     *
     * Composing the real transform has no rounded input: `transform: none` is the
     * identity whatever size the block happens to be.
     *
     * `height`, `minHeight` and `padding` are all catalog properties, so the
     * shape being set up here is one an author can author.
     */
    await page.goto(ROUTE);
    const spacer = page.locator('[data-nx-node="hx-spacer"]');
    await expect(spacer).toBeVisible();

    await spacer.evaluate(node => {
      const el = node as HTMLElement;
      el.style.height = "0.6px";
      el.style.minHeight = "0";
      el.style.padding = "0";
    });
    await spacer.click();

    const bandBox = await page.locator(band("margin", "bottom")).boundingBox();
    if (bandBox === null) throw new Error("no margin band on the spacer");

    // The seeded gap, undistorted. The ratio implementation lands near 14.3.
    expect(Math.abs(bandBox.height - MARGIN_BOTTOM)).toBeLessThan(TOLERANCE);
  });

  test.describe("a box axis-aligned bands cannot describe", () => {
    /*
     * One rule, not three patches. A band is an axis-aligned rectangle pinned to
     * a physical side, and that representation has no meaning for a rotated,
     * skewed or MIRRORED box — a mirrored block renders its left margin on the
     * right — nor for one collapsed to nothing, where the unclipped value chips
     * would pile up at the transform origin over an invisible block.
     */
    for (const [name, transform] of [
      ["collapsed by scale(0)", "scale(0)"],
      ["mirrored by scaleX(-1)", "scaleX(-1)"],
      ["rotated", "rotate(30deg)"],
      ["skewed", "skewX(20deg)"],
      /*
       * A 3D projection can flatten to a matrix with zero off-diagonal terms and
       * positive `a` and `d`, so the 2D tests alone call it describable. It
       * renders as a trapezoid whose scale varies across the box, which no
       * uniformly scaled rectangle covers.
       */
      ["projected in 3D", "perspective(500px) rotateY(30deg)"],
    ] as const) {
      test(`draws nothing for a block ${name}`, async ({ page }) => {
        await page.goto(ROUTE);
        const block = page.locator(`[data-nx-node="${PADDED}"]`);
        await expect(block).toBeVisible();

        /*
         * Selected while it is still clickable, and asserted — the POSITIVE
         * CONTROL, so the emptiness at the end is the refusal rather than a
         * selection that never took. `scale(0)` in particular leaves nothing to
         * click, so selecting afterwards is not available for every case here.
         */
        await block.click();
        await expect(page.locator(BAND)).not.toHaveCount(0);

        await block.evaluate((node, value) => {
          (node as HTMLElement).style.transform = value;
        }, transform);

        /*
         * A transform changes no LAYOUT size, so it emits no `ResizeObserver`
         * entry of its own. Growing a sibling does, which re-measures the
         * selection and re-evaluates the refusal — the same path an author takes,
         * since editing a transform in the inspector changes the document and
         * re-measures on that.
         */
        await page.locator('[data-nx-node="hx-heading"]').evaluate(node => {
          const el = node as HTMLElement;
          el.style.height = `${el.getBoundingClientRect().height + 40}px`;
        });

        await expect(page.locator(BAND)).toHaveCount(0);
      });
    }
  });

  test.describe("a box the canvas coordinates cannot hold", () => {
    /*
     * These are not transforms — they are blocks whose rendered geometry is not
     * a single upright rectangle sitting in the canvas's own coordinate space,
     * so the same refusal applies for the same reason.
     */
    for (const [name, apply] of [
      [
        "positioned fixed",
        (el: HTMLElement) => {
          el.style.position = "fixed";
        },
      ],
      [
        "positioned sticky",
        (el: HTMLElement) => {
          el.style.position = "sticky";
          el.style.top = "0px";
        },
      ],
      [
        "a scroll container reserving a scrollbar gutter",
        (el: HTMLElement) => {
          el.style.overflow = "scroll";
        },
      ],
    ] as const) {
      test(`draws nothing for ${name}`, async ({ page }) => {
        await page.goto(ROUTE);
        const block = page.locator(`[data-nx-node="${PADDED}"]`);
        await expect(block).toBeVisible();

        // The positive control, in this test: bands exist before the change.
        await block.click();
        await expect(page.locator(BAND)).not.toHaveCount(0);

        await block.evaluate((node, key) => {
          const el = node as HTMLElement;
          if (key === "positioned fixed") el.style.position = "fixed";
          if (key === "positioned sticky") {
            el.style.position = "sticky";
            el.style.top = "0px";
          }
          if (key === "a scroll container reserving a scrollbar gutter") {
            /*
             * `scrollbar-gutter: stable` reserves the space deterministically.
             * Left to the platform this is a coin toss — macOS uses overlay
             * scrollbars that reserve nothing, so the defect only appears on
             * Windows and Linux, and a test that depended on that would pass
             * locally while covering nothing.
             */
            el.style.overflow = "scroll";
            el.style.scrollbarGutter = "stable";
          }
        }, name);

        // A style change emits no resize of its own, so a sibling is grown to
        // force the re-measure that re-evaluates the refusal.
        await page.locator('[data-nx-node="hx-heading"]').evaluate(node => {
          const el = node as HTMLElement;
          el.style.height = `${el.getBoundingClientRect().height + 40}px`;
        });

        await expect(page.locator(BAND)).toHaveCount(0);
      });
    }
  });

  test("draws nothing for an inline box fragmented across lines", async ({
    page,
  }) => {
    /*
     * An inline box that wraps produces one rectangle PER LINE, and its padding
     * and margins belong to those fragments individually — while
     * `getBoundingClientRect` reports their union. Bands drawn from the union run
     * through the whitespace between lines and put the start and end padding on
     * the union's edges rather than on the first and last fragment.
     *
     * The canvas is narrowed to force the wrap. `width` does NOT apply to an
     * inline box, so constraining the element itself changes nothing — measured:
     * `display: inline` alone reports one rectangle, adding `width: 40px` still
     * reports one, and narrowing the canvas to 120px reports four.
     */
    await page.goto(ROUTE);
    const text = page.locator('[data-nx-node="hx-text-short"]');
    await expect(text).toBeVisible();

    await text.click();
    await expect(page.locator(BAND)).not.toHaveCount(0);

    await page.evaluate(() => {
      const el = document.querySelector(
        '[data-nx-node="hx-text-short"]'
      ) as HTMLElement;
      el.style.display = "inline";
      el.textContent = "wrap this text across several lines please and again";
      (document.querySelector(".nx-canvas") as HTMLElement).style.width =
        "120px";
    });

    await expect(page.locator(BAND)).toHaveCount(0);
  });

  test("bands catch up when a CSS transition finishes", async ({ page }) => {
    /*
     * `transition` is a catalog property, and a transition emits nothing an
     * observer sees: the frames resize nothing and mutate nothing.
     *
     * TRANSFORM rather than margin, and that choice is what makes this separate.
     * A transitioning margin grows the page, so the canvas root resizes on every
     * frame and its own observer does the work — measured, by removing the
     * completion listeners and watching a margin version of this test stay green.
     * A transform changes no layout at all, so nothing resizes and nothing
     * mutates after the style is set, and the only route to the final geometry is
     * the completion event.
     *
     * The mutation that starts it measures at frame zero, where the computed
     * transform is still `none` and the bands are full size. Arriving at half can
     * only come from `transitionend`.
     */
    await page.goto(ROUTE);
    const block = page.locator(`[data-nx-node="${PADDED}"]`);
    await expect(block).toBeVisible();
    await block.click();

    const before = await page.locator(band("padding", "bottom")).boundingBox();
    if (before === null)
      throw new Error("no padding band before the transition");
    expect(Math.abs(before.height - PADDING_BOTTOM)).toBeLessThan(TOLERANCE);

    await block.evaluate(node => {
      const el = node as HTMLElement;
      el.style.transformOrigin = "top left";
      el.style.transition = "transform 400ms linear";
      el.style.transform = "scale(0.5)";
    });

    await expect
      .poll(
        async () => {
          const box = await page
            .locator(band("padding", "bottom"))
            .boundingBox();
          return box === null ? null : Math.round(box.height);
        },
        { timeout: 5000 }
      )
      .toBeLessThan(PADDING_BOTTOM / 2 + 5);

    // The label never moved: the author still typed 120.
    await expect(page.locator(band("padding", "bottom"))).toHaveText(
      String(PADDING_BOTTOM)
    );
  });

  test("a scroll container with NO scrollbar still draws its bands", async ({
    page,
  }) => {
    /*
     * A REGRESSION GUARD, and not a separating test — stated so it is not read as
     * coverage of the threshold itself.
     *
     * It pins that an ordinary scroll container is not refused. It does NOT
     * exercise the rounding residue the two-pixel bound exists for: that needs
     * `offsetWidth` and `clientWidth` to round apart, and measured on this
     * platform a `0.333px` border computes to `1px` — Chrome snaps border widths
     * to device pixels — leaving a residue of exactly zero. Setting the bound to
     * `0.001` leaves this test green, which is the honest statement of what it
     * covers. The bound is derived from the arithmetic instead: half a pixel of
     * rounding from each reading against an exact border, so a whole pixel is
     * reachable with no scrollbar present.
     */
    await page.goto(ROUTE);
    const block = page.locator(`[data-nx-node="${PADDED}"]`);
    await expect(block).toBeVisible();

    await block.evaluate(node => {
      const el = node as HTMLElement;
      el.style.overflow = "auto";
      el.style.scrollbarGutter = "auto";
    });
    await block.click();

    await expect(page.locator(band("padding", "bottom"))).toHaveText(
      String(PADDING_BOTTOM)
    );
  });

  test("still draws a top margin that collapsed out of the canvas", async ({
    page,
  }) => {
    /*
     * Neither `.nx-pb-page` nor `.nx-canvas` establishes a formatting context, so
     * the first block's top margin collapses THROUGH both and out of the canvas.
     * Measured: setting `margin-top: 40px` on the first block moves the canvas
     * root down by 40 while the block's offset inside it stays 0 — the border box
     * starts at the root's top edge and the margin band belongs above it.
     *
     * What this asserts is that the overlay still DRAWS it, at a negative offset,
     * rather than dropping a band it cannot place inside the layer. Whether those
     * pixels paint is the stylesheet's half — `overflow: clip` with an
     * `overflow-clip-margin` allowance, which paints outside the layer without
     * contributing to the scroll extent — and a layout assertion cannot see paint,
     * so this does not claim to cover it.
     */
    await page.goto(ROUTE);
    const first = page.locator('[data-nx-node="hx-heading"]');
    await expect(first).toBeVisible();

    await first.evaluate(node => {
      (node as HTMLElement).style.marginTop = "40px";
    });
    await first.click();

    const layerBox = await page.locator(".nx-spacing-overlay").boundingBox();
    const bandBox = await page.locator(band("margin", "top")).boundingBox();
    if (layerBox === null || bandBox === null) {
      throw new Error("no overlay layer or top margin band");
    }

    await expect(page.locator(band("margin", "top"))).toHaveText("40");
    expect(Math.abs(bandBox.height - 40)).toBeLessThan(TOLERANCE);
    // Above the layer's own top edge, which is the escaped-margin case.
    expect(bandBox.y).toBeLessThan(layerBox.y);
  });

  test("the bands take no pointer events, so a covered block stays clickable", async ({
    page,
  }) => {
    await page.goto(ROUTE);
    const padded = page.locator(`[data-nx-node="${PADDED}"]`);
    await expect(padded).toBeVisible();
    await padded.click();

    // The margin band is drawn over the gap below the block, which is where a
    // neighbour begins. If the overlay could be hit, the author would meet this
    // as a canvas that stops responding once anything is selected.
    await expect(page.locator(band("margin", "bottom"))).toHaveCount(1);

    const neighbour = page.locator('[data-nx-node="hx-text-last"]');
    await neighbour.click();

    await expect(neighbour).toHaveAttribute("data-nx-selected", "primary");
    await expect(padded).not.toHaveAttribute("data-nx-selected", "primary");
  });

  test("the bands follow the selection to another block", async ({ page }) => {
    await page.goto(ROUTE);
    const padded = page.locator(`[data-nx-node="${PADDED}"]`);
    await expect(padded).toBeVisible();

    await padded.click();
    await expect(page.locator(band("padding", "bottom"))).toHaveCount(1);

    // A block the seed gives a margin but no padding. The padding band has to
    // GO — an overlay that only ever added bands would keep the old one and
    // report one block's padding while naming another.
    await page.locator('[data-nx-node="hx-heading"]').click();
    await expect(page.locator(band("margin", "bottom"))).toHaveCount(1);
    await expect(page.locator(band("padding", "bottom"))).toHaveCount(0);
  });
});
