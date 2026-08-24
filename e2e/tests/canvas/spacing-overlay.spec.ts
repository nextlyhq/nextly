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

  test("bands follow a block inside a scrolling container", async ({
    page,
  }) => {
    /*
     * `overflow: auto` and `overflow: scroll` are catalog values, so a block can
     * sit inside a container the author scrolls. Scrolling it moves the block
     * relative to the canvas while resizing nothing, mutating nothing and
     * finishing no transition — every other subscription is silent. A scroll
     * event does not bubble either, which is why the listener is registered in
     * the CAPTURE phase on the root.
     *
     * The nested block is given a margin here because the seed gives it none —
     * measured, it carries no `styles` key at all, so without this the test would
     * assert against an overlay that correctly had nothing to draw.
     *
     * It is parked MID-SCROLL on purpose. A scroller has content outside its box
     * by definition, and a block at that boundary is genuinely cut off — which
     * the clipping guard refuses, correctly. Both scroll positions here keep the
     * block wholly inside its container, so what moves is the block and not its
     * visibility.
     */
    await page.goto(ROUTE);
    const target = page.locator('[data-nx-node="hx-nested-text"]');
    await expect(target).toBeVisible();

    await page.evaluate(() => {
      (
        document.querySelector('[data-nx-node="hx-nested-text"]') as HTMLElement
      ).style.marginBottom = "24px";
      const section = document.querySelector(
        '[data-nx-node="hx-section"]'
      ) as HTMLElement;
      /*
       * `box-sizing: border-box` with generous padding is what makes this scroll
       * at all. Padding counts INSIDE `clientHeight`, so a fixed height smaller
       * than the padding is raised to fit it — measured, this configuration gives
       * a `scrollHeight` of 848 against a `clientHeight` of 800, so the scrollable
       * range is 48px and a request beyond that is silently clamped. An earlier
       * version asked for 320, got 48, and asserted a movement that never
       * happened.
       */
      section.style.boxSizing = "border-box";
      section.style.overflow = "auto";
      section.style.height = "200px";
      section.style.paddingTop = "400px";
      section.style.paddingBottom = "400px";
    });

    await target.click({ force: true });
    const before = await page.locator(band("margin", "bottom")).boundingBox();
    if (before === null) throw new Error("no band before the scroll");

    await page.evaluate(() => {
      (
        document.querySelector('[data-nx-node="hx-section"]') as HTMLElement
      ).scrollTop = 40;
    });

    await expect
      .poll(async () => {
        const box = await page.locator(band("margin", "bottom")).boundingBox();
        return box === null ? null : Math.round(before.y - box.y);
      })
      .toBeGreaterThan(25);
  });

  test("draws nothing for a block CUT OFF by a clipping ancestor", async ({
    page,
  }) => {
    /*
     * The block's own rectangle is reported UNCLIPPED, and the overlay draws as a
     * sibling of the page rather than inside the container — so bands taken from
     * that rectangle escape the clip and paint over ground where the block is not
     * rendered.
     *
     * Only a clip that ACTUALLY cuts is refused, and the control below is what
     * pins that: a block wholly inside an `overflow: hidden` container still
     * draws. Refusing on the mere presence of a clipping ancestor would blank the
     * overlay for most well-built pages.
     */
    await page.goto(ROUTE);
    const target = page.locator('[data-nx-node="hx-nested-text"]');
    await expect(target).toBeVisible();

    await page.evaluate(() => {
      (
        document.querySelector('[data-nx-node="hx-nested-text"]') as HTMLElement
      ).style.marginBottom = "24px";
      (
        document.querySelector('[data-nx-node="hx-section"]') as HTMLElement
      ).style.overflow = "hidden";
    });
    await target.click();

    // CONTROL: a clipping ancestor that does not cut still draws.
    await expect(page.locator(BAND)).not.toHaveCount(0);

    await page.evaluate(() => {
      (
        document.querySelector('[data-nx-node="hx-section"]') as HTMLElement
      ).style.height = "10px";
    });

    await expect(page.locator(BAND)).toHaveCount(0);
  });

  test("a BORDERED clipping ancestor clips at its padding edge", async ({
    page,
  }) => {
    /*
     * Overflow clips at the PADDING edge while `getBoundingClientRect` reports
     * the BORDER box, so on a bordered container the two differ by its width —
     * measured, a 20px border puts the border box at 217 and the clip edge at
     * 237. A child pulled into that border is visibly cut while a border-box
     * comparison reports it contained, and the bands paint over the cut region.
     *
     * The control comes first: the same bordered container that does NOT cut
     * still draws, so the emptiness afterwards is the padding edge being used
     * rather than any border at all refusing the block.
     */
    await page.goto(ROUTE);
    const target = page.locator('[data-nx-node="hx-nested-text"]');
    await expect(target).toBeVisible();

    await page.evaluate(() => {
      (
        document.querySelector('[data-nx-node="hx-nested-text"]') as HTMLElement
      ).style.marginBottom = "24px";
      const section = document.querySelector(
        '[data-nx-node="hx-section"]'
      ) as HTMLElement;
      section.style.overflow = "hidden";
      section.style.border = "20px solid transparent";
    });
    await target.click();
    await expect(page.locator(BAND)).not.toHaveCount(0);

    /*
     * Pulled UP into the border by a negative margin. The child is now above the
     * padding edge and below the border-box top, so it is genuinely cut — and a
     * border-box comparison would still call it contained.
     */
    await page.evaluate(() => {
      (
        document.querySelector('[data-nx-node="hx-nested-text"]') as HTMLElement
      ).style.marginTop = "-15px";
    });

    await expect(page.locator(BAND)).toHaveCount(0);
  });

  test("an ancestor clipping ONE axis does not refuse overflow on the other", async ({
    page,
  }) => {
    /*
     * `overflow` is a two-value catalog keyword, so the axes can clip
     * differently — and `clip visible` is the only mixed pair that survives
     * computation: measured in Chromium, pairing `visible` with `hidden`, `auto`
     * or `scroll` resolves the `visible` side to `auto`, while `clip visible`
     * stays exactly as written.
     *
     * A block overflowing only the axis that is still `visible` is not cut at
     * all, and its overflow is rendered. Comparing all four edges whenever
     * EITHER axis clips refuses it, and a refusal costs every band on the block.
     *
     * The control comes first and is the same geometry under `clip` on BOTH
     * axes, where the refusal is correct — so the bands returning afterwards are
     * the axis being respected rather than the block having stopped overflowing.
     */
    await page.goto(ROUTE);
    const target = page.locator('[data-nx-node="hx-nested-text"]');
    await expect(target).toBeVisible();

    await page.evaluate(() => {
      (
        document.querySelector('[data-nx-node="hx-nested-text"]') as HTMLElement
      ).style.marginBottom = "24px";
      const section = document.querySelector(
        '[data-nx-node="hx-section"]'
      ) as HTMLElement;
      section.style.overflow = "clip";
    });
    // Selected while the container still shows it. Shrinking first would clip
    // the target out of reach and the click would land on the page instead.
    await target.click();

    // CONTROL: a clipping ancestor that does not cut still draws.
    await expect(page.locator(BAND)).not.toHaveCount(0);

    await page.evaluate(() => {
      (
        document.querySelector('[data-nx-node="hx-section"]') as HTMLElement
      ).style.height = "10px";
    });

    // CONTROL: clipped on BOTH axes, that same vertical overflow IS a cut.
    await expect(page.locator(BAND)).toHaveCount(0);

    await page.evaluate(() => {
      const section = document.querySelector(
        '[data-nx-node="hx-section"]'
      ) as HTMLElement;
      section.style.overflow = "clip visible";
      /*
       * Asserted rather than assumed. If the engine collapsed this pair the way
       * it collapses every other mixed pair, the fixture would be testing two
       * fully-clipped containers and the bands would stay absent for a reason
       * that has nothing to do with the axis rule.
       */
      const computed = getComputedStyle(section);
      if (computed.overflowX !== "clip" || computed.overflowY !== "visible") {
        throw new Error(
          `expected clip/visible, got ${computed.overflowX}/${computed.overflowY}`
        );
      }
    });

    await expect(page.locator(BAND)).not.toHaveCount(0);
  });

  test("a SCALED bordered ancestor clips at its rendered padding edge", async ({
    page,
  }) => {
    /*
     * `getBoundingClientRect` reports post-transform pixels while a computed
     * border width is unscaled CSS pixels, so the two are only comparable once
     * the ancestor's own scale is applied. Under `scale(2)` a 20px border
     * renders 40px thick, and insetting the rectangle by 20 puts the clip edge
     * half way through the border — accepting a child the container visibly cuts
     * and painting its bands over the hidden area.
     *
     * The margin is deliberately SMALL. At `-15px` the child clears the
     * unscaled inset as well, so both implementations refuse it and the fixture
     * separates nothing; `-5px` scales to ten rendered pixels and lands the
     * child between the two answers — inside the rendered border, outside the
     * unscaled one.
     */
    await page.goto(ROUTE);
    const target = page.locator('[data-nx-node="hx-nested-text"]');
    await expect(target).toBeVisible();
    await target.click();

    await page.evaluate(() => {
      (
        document.querySelector('[data-nx-node="hx-nested-text"]') as HTMLElement
      ).style.marginBottom = "24px";
      const section = document.querySelector(
        '[data-nx-node="hx-section"]'
      ) as HTMLElement;
      section.style.overflow = "hidden";
      section.style.border = "20px solid transparent";
      // From the top left, so the border's rendered thickness is a plain
      // doubling rather than a function of where the box happens to sit.
      section.style.transformOrigin = "0 0";
      section.style.transform = "scale(2)";
    });

    // CONTROL: the scaled bordered container that does NOT cut still draws, so
    // the emptiness below is the clip edge moving rather than the transform or
    // the border refusing the block outright.
    await expect(page.locator(BAND)).not.toHaveCount(0);

    await page.evaluate(() => {
      (
        document.querySelector('[data-nx-node="hx-nested-text"]') as HTMLElement
      ).style.marginTop = "-5px";
    });

    await expect(page.locator(BAND)).toHaveCount(0);
  });

  test("declines a clipping ancestor that is not axis-aligned", async ({
    page,
  }) => {
    /*
     * A rotated ancestor's `getBoundingClientRect` is an axis-aligned BOUNDING
     * box whose edges are not the clip edges — the real clip is a slanted
     * rectangle inside it — so a child cut by that clip still reads as
     * contained, and its bands paint over ground the container hides.
     *
     * The block's OWN describability check does not cover this, which is the
     * whole point of the fixture: the block carries the inverse rotation, so the
     * composition from block to root is axis-aligned and passes. Measured, that
     * composition comes back `a=0.999999, b=0, c=0, d=0.999999` while the
     * ancestor's own matrix carries `b=0.5, c=-0.5`.
     *
     * The control is therefore load-bearing rather than decorative: it shows the
     * counter-rotated block still draws while the ancestor merely rotates, so
     * the emptiness afterwards is the CLIP being declined and not the rotation
     * being refused by the guard that was already there.
     *
     * The block is given PADDING for that control, not a margin. It carries its
     * own transform here, and a transformed block's margin bands are declined
     * for a different reason entirely — so a margin-only fixture would empty at
     * the control and prove nothing about the clip.
     */
    await page.goto(ROUTE);
    const target = page.locator('[data-nx-node="hx-nested-text"]');
    await expect(target).toBeVisible();
    await target.click();

    await page.evaluate(() => {
      const section = document.querySelector(
        '[data-nx-node="hx-section"]'
      ) as HTMLElement;
      const text = document.querySelector(
        '[data-nx-node="hx-nested-text"]'
      ) as HTMLElement;
      text.style.padding = "6px";
      section.style.position = "relative";
      section.style.width = "200px";
      section.style.height = "200px";
      section.style.transform = "rotate(30deg)";
      /*
       * Placed so the block is INSIDE the ancestor's axis-aligned bounding box
       * while hanging past its rotated right edge. That is what makes this
       * fixture separate the decline from the four-edge comparison: a block
       * that also escapes the bounding box is refused by that comparison, and
       * removing the decline changes nothing.
       */
      text.style.position = "absolute";
      text.style.left = "180px";
      text.style.top = "90px";
      text.style.width = "60px";
      text.style.height = "20px";
      text.style.transform = "rotate(-30deg)";
    });

    // The fixture's separating property, asserted rather than assumed: layout
    // that drifted so the block escaped the bounding box would leave this test
    // passing on the comparison below the decline.
    const contained = await page.evaluate(() => {
      const outer = (
        document.querySelector('[data-nx-node="hx-section"]') as HTMLElement
      ).getBoundingClientRect();
      const box = (
        document.querySelector('[data-nx-node="hx-nested-text"]') as HTMLElement
      ).getBoundingClientRect();
      const slack = 0.5;
      return !(
        box.top < outer.top - slack ||
        box.left < outer.left - slack ||
        box.bottom > outer.bottom + slack ||
        box.right > outer.right + slack
      );
    });
    expect(contained).toBe(true);

    // CONTROL: the composition is axis-aligned, so the block is describable and
    // still draws under a rotated — but not yet clipping — ancestor.
    await expect(page.locator(BAND)).not.toHaveCount(0);

    await page.evaluate(() => {
      (
        document.querySelector('[data-nx-node="hx-section"]') as HTMLElement
      ).style.overflow = "hidden";
    });

    await expect(page.locator(BAND)).toHaveCount(0);
  });

  test("drops the MARGIN bands for a block carrying its own transform, and keeps padding", async ({
    page,
  }) => {
    /*
     * A transform does not affect layout, so the margin of a transformed block
     * is not beside its rendered border edge — and no scale factor moves it
     * there. Measured on a 100px block with `margin-bottom: 20px`: the gap to
     * the next sibling is 70px under `scale(0.5)`, and NEGATIVE eighty under
     * `scale(2)`, where the block is drawn over the neighbour its margin is
     * holding away.
     *
     * PADDING is the control, and it is the reason this is not a whole-element
     * refusal: padding lies inside the transform and renders scaled with the
     * box, so those bands stay correct and must still be drawn. A fix that
     * refused the block outright would pass the margin assertion and fail here.
     */
    await page.goto(ROUTE);
    const block = page.locator(`[data-nx-node="${PADDED}"]`);
    await expect(block).toBeVisible();
    await block.click();

    // CONTROL: both boxes are drawn before the transform.
    await expect(page.locator(band("margin", "bottom"))).toHaveCount(1);
    await expect(page.locator(band("padding", "bottom"))).toHaveCount(1);

    await block.evaluate(node => {
      const el = node as HTMLElement;
      el.style.transformOrigin = "0 0";
      el.style.transform = "scale(0.5)";
    });

    // A transform changes no layout size, so it emits no resize of its own;
    // growing a sibling forces the re-measure, as the refusal tests do.
    await page.locator('[data-nx-node="hx-heading"]').evaluate(node => {
      const el = node as HTMLElement;
      el.style.height = `${el.getBoundingClientRect().height + 40}px`;
    });

    await expect(page.locator(`${BAND}[data-box="margin"]`)).toHaveCount(0);
    await expect(page.locator(band("padding", "bottom"))).toHaveCount(1);
  });

  test("keeps every margin band under an IDENTITY-valued transform", async ({
    page,
  }) => {
    /*
     * `scale(1)`, `translate(0)`, `translateY(0)` and `rotate(360deg)` all
     * compute to a non-`none` transform and all serialize to exactly
     * `matrix(1, 0, 0, 1, 0, 0)`. They move nothing — measured, the gap to the
     * next sibling is the authored 20px on both axes for each of them.
     *
     * They are also the RESTING STATE of every hover animation, so a check that
     * read the presence of a declaration rather than its effect would blank the
     * margins of a large share of real pages. That is the separating case
     * between the two implementations and the reason this test exists.
     */
    await page.goto(ROUTE);
    const block = page.locator(`[data-nx-node="${PADDED}"]`);
    await expect(block).toBeVisible();
    await block.click();
    await expect(page.locator(band("margin", "bottom"))).toHaveCount(1);

    for (const transform of [
      "scale(1)",
      "translate(0)",
      "translateY(0)",
      "rotate(360deg)",
    ]) {
      await block.evaluate((node, value) => {
        (node as HTMLElement).style.transform = value;
      }, transform);
      await page.locator('[data-nx-node="hx-heading"]').evaluate(node => {
        const el = node as HTMLElement;
        el.style.height = `${el.getBoundingClientRect().height + 8}px`;
      });
      await expect(page.locator(band("margin", "bottom"))).toHaveCount(1);
      await expect(page.locator(band("margin", "bottom"))).toHaveText(
        String(MARGIN_BOTTOM)
      );
    }
  });

  test("drops EVERY band when a plain translate moves the whole box", async ({
    page,
  }) => {
    /*
     * An earlier version of this test asserted the opposite for the horizontal
     * side — that `translateY` left the right margin drawable, on the grounds
     * that the gap it names is still 32px wide. That was wrong, and the reason
     * is worth keeping: an edge is a SEGMENT, and the right edge's endpoints are
     * both displaced vertically by a `translateY`. Its band therefore has the
     * correct WIDTH forty pixels away from the space it names, which is the
     * failure this module treats as worse than drawing nothing.
     *
     * A pinned edge is a different case and still keeps its band — the test
     * below covers it. What a plain translate cannot do is pin anything.
     */
    await page.goto(ROUTE);
    const block = page.locator(`[data-nx-node="${PADDED}"]`);
    await expect(block).toBeVisible();
    await block.evaluate(node => {
      (node as HTMLElement).style.marginRight = "32px";
    });
    await block.click();

    // CONTROL: both axes draw before the transform, so the emptiness afterwards
    // is the rule firing rather than a fixture that authored nothing.
    await expect(page.locator(band("margin", "bottom"))).toHaveCount(1);
    await expect(page.locator(band("margin", "right"))).toHaveCount(1);

    await block.evaluate(node => {
      (node as HTMLElement).style.transform = "translateY(40px)";
    });
    await page.locator('[data-nx-node="hx-heading"]').evaluate(node => {
      const el = node as HTMLElement;
      el.style.height = `${el.getBoundingClientRect().height + 40}px`;
    });

    await expect(page.locator(`${BAND}[data-box="margin"]`)).toHaveCount(0);
    // PADDING is the control on the other side: it lies inside the transform and
    // travels with the box, so it stays correct and must still be drawn. Without
    // this, a whole-element refusal would satisfy the assertion above.
    await expect(page.locator(band("padding", "bottom"))).toHaveCount(1);
  });

  test("keeps the band beside an edge its transform leaves STATIONARY", async ({
    page,
  }) => {
    /*
     * A transform is applied about `transform-origin`, so a translate composed
     * with a scale can pin one edge and move only the other. Measured on a 100px
     * block: `translateY(-25px) scaleY(0.5)` computes to
     * `matrix(1, 0, 0, 0.5, 0, -25)` and renders its top edge at exactly the
     * position layout gave it, while plain `scaleY(0.5)` moves that edge by 25.
     * The shift below is derived from the block's measured height for that
     * reason — the pinning is a relationship between the two, not a number.
     *
     * Reachable with `transform` ALONE, which is a catalog property —
     * `transform-origin` is not, and an earlier version of this rule concluded
     * from that fact that a pinned edge could not arise. It can; composing two
     * functions is enough.
     *
     * So the top band must survive while the bottom one goes, and an answer per
     * axis fails this while satisfying every other transform test in the file.
     */
    await page.goto(ROUTE);
    const block = page.locator(`[data-nx-node="${PADDED}"]`);
    await expect(block).toBeVisible();
    await block.evaluate(node => {
      (node as HTMLElement).style.marginTop = "28px";
    });
    await block.click();

    // CONTROL: both vertical bands draw before the transform.
    await expect(page.locator(band("margin", "top"))).toHaveCount(1);
    await expect(page.locator(band("margin", "bottom"))).toHaveCount(1);

    const pinned = await block.evaluate(node => {
      const el = node as HTMLElement;
      const before = el.getBoundingClientRect();
      /*
       * The shift is DERIVED from the block's own height rather than written as
       * a constant. With the initial origin at the box's centre, halving the
       * height draws the top edge down by a quarter of it, so the translate that
       * cancels that is a function of the height — a literal would pin the edge
       * only for a block that happened to be the size the literal was written
       * for, and the seed's is not.
       */
      const shift = (before.height / 2) * (1 - 0.5);
      el.style.transform = `translateY(${String(-shift)}px) scaleY(0.5)`;
      return Math.abs(el.getBoundingClientRect().top - before.top) < 0.5;
    });
    // The fixture's separating property, asserted rather than assumed: layout
    // that drifted so the top edge DID move would leave this test passing on the
    // axis rule it exists to reject.
    expect(pinned).toBe(true);

    await page.locator('[data-nx-node="hx-heading"]').evaluate(node => {
      const el = node as HTMLElement;
      el.style.height = `${el.getBoundingClientRect().height + 40}px`;
    });

    await expect(page.locator(band("margin", "top"))).toHaveCount(1);
    await expect(page.locator(band("margin", "bottom"))).toHaveCount(0);
  });

  test("drops the band when a STRONG own scale moves the edge", async ({
    page,
  }) => {
    /*
     * The case that separates converting the displacement by the ancestors from
     * converting it by the composed scale. The displacement is already in the
     * parent's coordinates — the element's own transform is what produced it —
     * so multiplying by that transform again counts it twice.
     *
     * Measured on a 100px block under `scaleY(0.01)`: each vertical edge moves
     * 49.5 rendered pixels, while the composed conversion answers 0.495, which
     * is under the half-pixel threshold and would call a plainly moved edge
     * stationary. The pinned-edge test above cannot catch this — its
     * displacement is exactly zero, so both multipliers agree there.
     */
    await page.goto(ROUTE);
    const block = page.locator(`[data-nx-node="${PADDED}"]`);
    await expect(block).toBeVisible();
    await block.evaluate(node => {
      const el = node as HTMLElement;
      el.style.marginTop = "28px";
    });
    await block.click();
    await expect(page.locator(band("margin", "top"))).toHaveCount(1);

    /*
     * The scale is chosen rather than picked, and it is what makes this test
     * separate at all. The wrong conversion answers `displacement * scale`, so
     * the two implementations only disagree while that product is under the
     * half-pixel threshold — and the displacement is about half the block's
     * height, which the seed's own padding puts at 120. A tenth of a percent
     * clears it with room; a hundredth of the box, tried first, did not, and
     * both implementations dropped the bands for the same reason.
     */
    const OWN_SCALE = 0.001;
    const moved = await block.evaluate((node, value) => {
      const el = node as HTMLElement;
      const before = el.getBoundingClientRect().top;
      el.style.transform = `scaleY(${String(value)})`;
      return Math.abs(el.getBoundingClientRect().top - before);
    }, OWN_SCALE);
    // The separating property, asserted BOTH ways: the edge really moves far,
    // and the wrong conversion of that same displacement lands under the
    // threshold — so the two implementations must disagree here.
    expect(moved).toBeGreaterThan(5);
    expect(moved * OWN_SCALE).toBeLessThan(0.5);

    await page.locator('[data-nx-node="hx-heading"]').evaluate(node => {
      const el = node as HTMLElement;
      el.style.height = `${el.getBoundingClientRect().height + 40}px`;
    });

    await expect(page.locator(`${BAND}[data-box="margin"]`)).toHaveCount(0);
  });

  test("draws a retained margin band at its FULL height, not the scaled one", async ({
    page,
  }) => {
    /*
     * A transform does not scale the space a margin reserves. With the top edge
     * pinned the band survives, and it has to cover the real gap: measured, a
     * block with `margin-top: 28px` under a pinning transform leaves 28 rendered
     * pixels above it, while the composed scale would draw 14 and name half the
     * space it points at.
     *
     * The pinned-edge test asserts the band EXISTS and stops there, so it stays
     * green against the halved geometry. This one reads the rectangle.
     */
    await page.goto(ROUTE);
    const block = page.locator(`[data-nx-node="${PADDED}"]`);
    await expect(block).toBeVisible();
    await block.evaluate(node => {
      (node as HTMLElement).style.marginTop = "28px";
    });
    await block.click();

    const before = await page.locator(band("margin", "top")).boundingBox();
    if (before === null) throw new Error("the margin band has no box");
    expect(Math.abs(before.height - 28)).toBeLessThan(TOLERANCE);

    await block.evaluate(node => {
      const el = node as HTMLElement;
      const shift = (el.getBoundingClientRect().height / 2) * (1 - 0.5);
      el.style.transform = `translateY(${String(-shift)}px) scaleY(0.5)`;
    });
    await page.locator('[data-nx-node="hx-heading"]').evaluate(node => {
      const el = node as HTMLElement;
      el.style.height = `${el.getBoundingClientRect().height + 40}px`;
    });

    const after = await page.locator(band("margin", "top")).boundingBox();
    if (after === null) throw new Error("the margin band was dropped");
    expect(Math.abs(after.height - 28)).toBeLessThan(TOLERANCE);
    // And the number still reads what the author typed.
    await expect(page.locator(band("margin", "top"))).toHaveText("28");
  });

  test("drops a band whose edge is pinned on its own axis but slid ALONG itself", async ({
    page,
  }) => {
    /*
     * An edge is a SEGMENT, so its own coordinate is only half the question.
     * Measured, `translate(30px, -25px) scaleY(0.5)` leaves the top edge's Y
     * exactly where layout put it and slides the whole edge thirty pixels
     * sideways — a band anchored to it then names pixels the margin never
     * occupied, at exactly the right height.
     *
     * The pinned-edge test above varies only Y, so it passes whether or not the
     * perpendicular extent is considered. This is the case that separates them.
     */
    await page.goto(ROUTE);
    const block = page.locator(`[data-nx-node="${PADDED}"]`);
    await expect(block).toBeVisible();
    await block.evaluate(node => {
      (node as HTMLElement).style.marginTop = "28px";
    });
    await block.click();
    await expect(page.locator(band("margin", "top"))).toHaveCount(1);

    const shifted = await block.evaluate(node => {
      const el = node as HTMLElement;
      const before = el.getBoundingClientRect();
      // Derived so the vertical pin holds for this block's height, exactly as
      // the pinned-edge test does; the sideways slide is what this one adds.
      const lift = (before.height / 2) * (1 - 0.5);
      el.style.transform = `translate(30px, ${String(-lift)}px) scaleY(0.5)`;
      const after = el.getBoundingClientRect();
      return {
        topStillPinned: Math.abs(after.top - before.top) < 0.5,
        movedSideways: Math.abs(after.left - before.left),
      };
    });
    // Both halves of the separating property, asserted rather than assumed.
    expect(shifted.topStillPinned).toBe(true);
    expect(shifted.movedSideways).toBeGreaterThan(5);

    await page.locator('[data-nx-node="hx-heading"]').evaluate(node => {
      const el = node as HTMLElement;
      el.style.height = `${el.getBoundingClientRect().height + 40}px`;
    });

    await expect(page.locator(band("margin", "top"))).toHaveCount(0);
  });

  test("declines margins under an ancestor reflection the block cancels", async ({
    page,
  }) => {
    /*
     * A reflection cancelled by the element's own composes to a POSITIVE matrix,
     * so the describability guard — which reads the composed matrix — passes.
     * Measured: a parent at `scaleX(-1)` holding a child at
     * `translateX(-width) scaleX(-1)` composes to `a = 1` while the ancestor's
     * own `a` is still −1.
     *
     * That negative factor is what a margin would be scaled by, turning a
     * positive margin into a negative extent — drawn INWARD over the content and
     * still labelled as ordinary positive spacing. The mirrored space is real; a
     * rectangle claiming to be it is not.
     */
    await page.goto(ROUTE);
    const block = page.locator(`[data-nx-node="hx-nested-text"]`);
    await expect(block).toBeVisible();
    await block.evaluate(node => {
      (node as HTMLElement).style.marginLeft = "24px";
    });
    await block.click();

    // CONTROL: the band draws before either reflection exists.
    await expect(page.locator(band("margin", "left"))).toHaveCount(1);

    /*
     * Both transforms go on together, because neither alone reaches the state.
     * The element's reflection ALONE composes to a negative matrix and the
     * describability guard refuses the whole overlay; the ancestor's alone does
     * the same. Only the pair composes to a positive matrix that passes.
     *
     * The element's shift is `-2 * originX`, which pins the endpoint at local
     * `v = 0`: a transform about `o` maps `v` to `o + a(v - o) + e`, so with
     * `a = -1` that endpoint moves by `2o + e`, and `e = -2o` makes it zero.
     * That endpoint is what the per-edge rule consults for the LEFT side, so the
     * left margin survives the endpoint rule and the ancestor's sign becomes the
     * only thing left to refuse it.
     *
     * Note the reflection SWAPS which edge is which on screen — the image of
     * `v = 0` is the rendered box's right side — so an on-screen check of
     * `rect.left` would be measuring the wrong endpoint. The separation is
     * established by the break instead: removing the ancestor guard puts this
     * band back.
     */
    const cancelled = await page.evaluate(() => {
      const section = document.querySelector(
        '[data-nx-node="hx-section"]'
      ) as HTMLElement;
      const text = document.querySelector(
        '[data-nx-node="hx-nested-text"]'
      ) as HTMLElement;
      const originX = Number.parseFloat(
        getComputedStyle(text).transformOrigin.split(" ")[0] ?? "0"
      );
      section.style.transform = "scaleX(-1)";
      text.style.transform = `translateX(${String(-2 * originX)}px) scaleX(-1)`;
      const compose = (el: Element | null): DOMMatrix => {
        let m = new DOMMatrix();
        for (let n = el; n !== null; n = n.parentElement) {
          const t = getComputedStyle(n).transform;
          if (t !== "" && t !== "none") m = new DOMMatrix(t).multiply(m);
        }
        return m;
      };
      return {
        ancestorNegative: compose(section).a < 0,
        composedPositive:
          compose(document.querySelector('[data-nx-node="hx-nested-text"]')).a >
          0,
      };
    });
    // The separating property: the describability guard upstream sees a POSITIVE
    // composition and lets this through, so an ancestor-side check is the only
    // thing that can refuse it.
    expect(cancelled.ancestorNegative).toBe(true);
    expect(cancelled.composedPositive).toBe(true);

    await page.locator('[data-nx-node="hx-heading"]').evaluate(node => {
      const el = node as HTMLElement;
      el.style.height = `${el.getBoundingClientRect().height + 40}px`;
    });

    await expect(page.locator(`${BAND}[data-box="margin"]`)).toHaveCount(0);
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

/**
 * A rounded block is not the rectangle its bands are cut from.
 *
 * `borderRadius` is a catalog property, so an author reaches every case here
 * from the inspector. Two separate things go wrong on a curve, and only a
 * browser can settle either: whether the paint lands where the block is, and
 * whether a rounded container's clip removes a corner the rectangle comparison
 * calls contained.
 */
test.describe("rounded geometry", () => {
  /**
   * One pixel out of a screenshot, in CSS pixels.
   *
   * Hit-testing cannot stand in for this. `elementFromPoint` reports a child
   * sitting in the cut-away corner of an `overflow: hidden` ancestor as hit —
   * measured in Chromium — so it answers about the box tree while the question
   * here is about what was painted.
   */
  async function pixels(
    page: import("@playwright/test").Page,
    points: readonly (readonly [number, number])[]
  ): Promise<string[]> {
    const shot = (await page.screenshot()).toString("base64");
    const ratio = await page.evaluate(() => window.devicePixelRatio);
    return page.evaluate(
      async ({ b64, at, r }) => {
        const img = new Image();
        img.src = `data:image/png;base64,${b64}`;
        await img.decode();
        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext("2d");
        if (ctx === null) throw new Error("no 2d context");
        ctx.drawImage(img, 0, 0);
        return at.map(([x, y]) => {
          const d = ctx.getImageData(
            Math.round(x * r),
            Math.round(y * r),
            1,
            1
          ).data;
          return `${String(d[0])},${String(d[1])},${String(d[2])}`;
        });
      },
      { b64: shot, at: points, r: ratio }
    );
  }

  test("paints nothing in the corner a rounded block curves away from", async ({
    page,
  }) => {
    /*
     * The padding box of a rounded block has curved corners while its bands are
     * full-width strips, so the strip covers ground the block does not occupy —
     * and a band is read as a MEASUREMENT, so one painted over the page beside
     * the block states a measurement that is false.
     *
     * Asserted as pixels rather than as a `clip-path` attribute because the
     * attribute is the mechanism and this is the property: a clip applied to the
     * wrong element, in the wrong coordinate space, or to a band that then paints
     * its chip over the gap would all satisfy an attribute check.
     */
    await page.goto(ROUTE);
    const block = page.locator(`[data-nx-node="${PADDED}"]`);
    await expect(block).toBeVisible();
    await block.scrollIntoViewIfNeeded();

    const where = await block.evaluate(node => {
      const el = node as HTMLElement;
      const box = el.getBoundingClientRect();
      /*
       * Small enough that CSS's overlap reduction leaves it alone, so the corner
       * measured below is the one declared rather than a shrunk one.
       */
      const radius = Math.min(80, box.width / 2, box.height / 2);
      el.style.borderRadius = `${String(radius)}px`;
      /*
       * Six pixels into the bottom-left corner: inside the band's rectangle on
       * both axes, and outside the arc, since (74/80)² + (74/80)² is 1.71.
       *
       * It is also some twenty-four pixels clear of the rendered edge along the
       * diagonal, so a selection outline drawn on that edge cannot reach it and
       * be mistaken for a band.
       */
      const inset = 6;
      return {
        radius,
        corner: [box.left + inset, box.bottom - inset] as [number, number],
        middle: [box.left + box.width / 2, box.bottom - inset] as [
          number,
          number,
        ],
      };
    });

    // The corner really is outside the curve, stated here so the assertion below
    // cannot be satisfied by a fixture that drifted into a gentler radius.
    const depth = where.radius - 6;
    expect((depth / where.radius) ** 2 * 2).toBeGreaterThan(1);

    const before = await pixels(page, [where.corner, where.middle]);

    await block.click();
    await expect(page.locator(band("padding", "bottom"))).toHaveCount(1);

    const after = await pixels(page, [where.corner, where.middle]);

    /*
     * The separating half FIRST: the band really did paint, at the same distance
     * from the bottom edge, in the middle of the same strip. Without this the
     * corner assertion is satisfied by an overlay that drew nothing at all.
     */
    expect(after[1]).not.toBe(before[1]);

    // And the corner is untouched. Selecting a block must not colour the page
    // beside it.
    expect(after[0]).toBe(before[0]);
  });

  test("draws nothing for a block cut by a rounded ancestor's CORNER", async ({
    page,
  }) => {
    /*
     * A container with `border-radius` and `overflow: hidden` clips on the
     * curve. A child inside all four padding edges can still lose a corner, and
     * a rectangular comparison accepts it.
     *
     * The control is the point of the test as much as the refusal is: the
     * rounded card is the ordinary layout, so an implementation that declined
     * every rounded clipping ancestor would blank the overlay for most blocks on
     * a real page and would pass a test that only checked the refusal.
     */
    await page.goto(ROUTE);
    const target = page.locator('[data-nx-node="hx-nested-text"]');
    await expect(target).toBeVisible();

    await page.evaluate(() => {
      (
        document.querySelector('[data-nx-node="hx-nested-text"]') as HTMLElement
      ).style.marginBottom = "24px";
      const section = document.querySelector(
        '[data-nx-node="hx-section"]'
      ) as HTMLElement;
      section.style.overflow = "hidden";
      section.style.borderRadius = "100px";
      // Holds the child clear of all four arcs without moving it out of the
      // container, which is what makes the first phase a control and not a
      // second copy of the refusal.
      section.style.padding = "40px";
    });
    await target.click();

    /** How far the child reaches past a corner's arc centre, per axis. */
    const reach = () =>
      page.evaluate(() => {
        const section = document.querySelector(
          '[data-nx-node="hx-section"]'
        ) as HTMLElement;
        const child = document.querySelector(
          '[data-nx-node="hx-nested-text"]'
        ) as HTMLElement;
        const outer = section.getBoundingClientRect();
        const box = child.getBoundingClientRect();
        const radius = Number.parseFloat(
          getComputedStyle(section).borderTopLeftRadius
        );
        const dx = outer.left + radius - box.left;
        const dy = outer.top + radius - box.top;
        return (dx / radius) ** 2 + (dy / radius) ** 2;
      });

    // CONTROL: inside the arc, and the bands are drawn.
    expect(await reach()).toBeLessThan(1);
    await expect(page.locator(BAND)).not.toHaveCount(0);

    await page.evaluate(() => {
      (
        document.querySelector('[data-nx-node="hx-section"]') as HTMLElement
      ).style.padding = "0px";
    });

    // The same block, now genuinely through the curve — and still inside all
    // four straight edges, which is the case the rectangle comparison misses.
    expect(await reach()).toBeGreaterThan(1);
    await expect(page.locator(BAND)).toHaveCount(0);
  });

  test("keeps drawing at the corner of an ancestor that clips ONE axis", async ({
    page,
  }) => {
    /*
     * `overflow: clip visible` is the one mixed pair that survives computation,
     * and it leaves the clip region unbounded on the visible axis — a corner
     * needs two bounds to exist at all.
     *
     * Measured in Chromium: a child at the corner of a 60px-radius box under
     * `overflow: clip visible` is painted in full, while the same child under
     * `overflow: hidden` is cut away. Applying the arc on one axis would refuse
     * a block nothing removes.
     */
    await page.goto(ROUTE);
    const target = page.locator('[data-nx-node="hx-nested-text"]');
    await expect(target).toBeVisible();

    await page.evaluate(() => {
      (
        document.querySelector('[data-nx-node="hx-nested-text"]') as HTMLElement
      ).style.marginBottom = "24px";
      const section = document.querySelector(
        '[data-nx-node="hx-section"]'
      ) as HTMLElement;
      section.style.overflow = "clip visible";
      section.style.borderRadius = "100px";
      section.style.padding = "0px";
    });
    await target.click();

    const axes = await page.evaluate(() => {
      const style = getComputedStyle(
        document.querySelector('[data-nx-node="hx-section"]') as HTMLElement
      );
      return [style.overflowX, style.overflowY];
    });
    // The separating property: only ONE axis clips. Were both clipping, the
    // refusal would be correct and this test would pin the opposite of its name.
    expect(axes).toEqual(["clip", "visible"]);

    await expect(page.locator(BAND)).not.toHaveCount(0);
  });
  test("keeps drawing for a rounded block FLUSH inside a rounded container", async ({
    page,
  }) => {
    /*
     * The nested rounded card, and the case a rectangular comparison gets wrong
     * in the opposite direction from the corner test above.
     *
     * A block whose curve matches the container it fills is not cut anywhere —
     * but its BOUNDING RECTANGLE's corners lie outside every one of that
     * container's arcs, so a check that reads only the rectangle refuses it and
     * takes the whole overlay with it.
     *
     * The two boxes are given the same SIZE as well as the same radius, and that
     * is not tidiness. CSS reduces the radii to fit the box, so the same
     * declaration on two differently-sized boxes produces two different curves:
     * on the seeded 1280x48 section a declared 60px is drawn at 24, while the
     * 1280x24 child inside it is drawn at 12 — and that child really is cut.
     */
    await page.goto(ROUTE);
    const target = page.locator('[data-nx-node="hx-nested-text"]');
    await expect(target).toBeVisible();

    await page.evaluate(() => {
      const section = document.querySelector(
        '[data-nx-node="hx-section"]'
      ) as HTMLElement;
      section.style.overflow = "hidden";
      section.style.borderRadius = "60px";
      section.style.padding = "0px";
      section.style.height = "200px";
      const child = document.querySelector(
        '[data-nx-node="hx-nested-text"]'
      ) as HTMLElement;
      child.style.marginBottom = "24px";
      // Matched to the container it fills, which is how the pattern is authored.
      child.style.borderRadius = "60px";
      child.style.height = "200px";
    });
    await target.click();

    const geometry = await page.evaluate(() => {
      const section = document.querySelector(
        '[data-nx-node="hx-section"]'
      ) as HTMLElement;
      const child = document.querySelector(
        '[data-nx-node="hx-nested-text"]'
      ) as HTMLElement;
      const outer = section.getBoundingClientRect();
      const box = child.getBoundingClientRect();
      const radius = Number.parseFloat(
        getComputedStyle(section).borderTopLeftRadius
      );
      const dx = outer.left + radius - box.left;
      const dy = outer.top + radius - box.top;
      return {
        cornerReach: (dx / radius) ** 2 + (dy / radius) ** 2,
        sameBox:
          Math.abs(box.left - outer.left) < 1.5 &&
          Math.abs(box.top - outer.top) < 1.5 &&
          Math.abs(box.right - outer.right) < 1.5 &&
          Math.abs(box.bottom - outer.bottom) < 1.5,
        sameRadius:
          getComputedStyle(section).borderTopLeftRadius ===
          getComputedStyle(child).borderTopLeftRadius,
      };
    });

    /*
     * The separating properties, asserted so this cannot pass for a reason other
     * than the one it names. The two boxes coincide and carry the same
     * declaration — so CSS reduces both by the same factor and the two curves
     * are the same curve — while the block's RECTANGULAR corner is outside the
     * container's arc, which is precisely what the earlier implementation
     * refused on.
     */
    expect(geometry.sameBox).toBe(true);
    expect(geometry.sameRadius).toBe(true);
    expect(geometry.cornerReach).toBeGreaterThan(1);

    await expect(page.locator(BAND)).not.toHaveCount(0);
  });
  test("draws nothing under an ancestor whose curve cannot be read", async ({
    page,
  }) => {
    /*
     * A radius the computed value does not resolve is a clip of UNKNOWN shape,
     * and the block is refused rather than treated as sitting inside a square
     * one — the same answer this package gives for every other geometry it
     * cannot describe.
     *
     * Reachable, and measured: a percentage inside a math function still depends
     * on the box, so `border-radius: calc(10% + 5px)` stays exactly that in the
     * computed value where `calc(10px + 5px)` resolves to `15px`. The catalog
     * accepts a `calc()` length, so an author reaches this from the inspector.
     *
     * The control comes first, with the resolvable form of the same declaration:
     * a block clear of the corners keeps its bands, so the emptiness afterwards
     * is the value being unreadable and not the shape being wrong.
     */
    await page.goto(ROUTE);
    const target = page.locator('[data-nx-node="hx-nested-text"]');
    await expect(target).toBeVisible();

    await page.evaluate(() => {
      (
        document.querySelector('[data-nx-node="hx-nested-text"]') as HTMLElement
      ).style.marginBottom = "24px";
      const section = document.querySelector(
        '[data-nx-node="hx-section"]'
      ) as HTMLElement;
      section.style.overflow = "hidden";
      section.style.padding = "40px";
      section.style.borderRadius = "calc(10px + 5px)";
    });
    await target.click();

    const resolved = await page.evaluate(
      () =>
        getComputedStyle(
          document.querySelector('[data-nx-node="hx-section"]') as HTMLElement
        ).borderTopLeftRadius
    );
    // The control's radius really did resolve, so the bands below are drawn
    // under a curve this can read.
    expect(resolved).toBe("15px");
    await expect(page.locator(BAND)).not.toHaveCount(0);

    await page.evaluate(() => {
      (
        document.querySelector('[data-nx-node="hx-section"]') as HTMLElement
      ).style.borderRadius = "calc(10% + 5px)";
    });

    const unresolved = await page.evaluate(
      () =>
        getComputedStyle(
          document.querySelector('[data-nx-node="hx-section"]') as HTMLElement
        ).borderTopLeftRadius
    );
    /*
     * The separating property: the browser really did leave this unresolved. A
     * version of Chromium that resolved it would make the refusal below wrong
     * rather than merely untested, and this says so loudly instead.
     */
    expect(unresolved).toBe("calc(10% + 5px)");

    await expect(page.locator(BAND)).toHaveCount(0);
  });
  test("keeps drawing under an ancestor whose overflow CANNOT clip", async ({
    page,
  }) => {
    /*
     * A computed `overflow` is not an overflow that clips. The property does not
     * apply to every generated box, and the computed value says nothing about
     * that — so an author who writes `overflow: hidden` where it has no effect
     * would otherwise lose the whole overlay to a clip that does not exist.
     *
     * `display: contents` is the sharpest of the nine measured cases, because it
     * fails twice over: the element generates NO BOX, so nothing clips AND
     * `getBoundingClientRect` answers 0x0 — and a descendant compared against a
     * zero-sized rectangle is outside it on every edge.
     */
    await page.goto(ROUTE);
    const target = page.locator('[data-nx-node="hx-nested-text"]');
    await expect(target).toBeVisible();

    await page.evaluate(() => {
      (
        document.querySelector('[data-nx-node="hx-nested-text"]') as HTMLElement
      ).style.marginBottom = "24px";
      const section = document.querySelector(
        '[data-nx-node="hx-section"]'
      ) as HTMLElement;
      section.style.overflow = "hidden";
      section.style.borderRadius = "60px";
      section.style.display = "contents";
    });
    await target.click();

    const ancestor = await page.evaluate(() => {
      const section = document.querySelector(
        '[data-nx-node="hx-section"]'
      ) as HTMLElement;
      const style = getComputedStyle(section);
      const box = section.getBoundingClientRect();
      return {
        display: style.display,
        overflow: style.overflowX,
        area: box.width * box.height,
      };
    });

    /*
     * The separating properties. The computed overflow really does say `hidden`,
     * so a reader that trusted it would act — and the box really is empty, so
     * acting would refuse every descendant on the rectangle alone, before the
     * curve was ever consulted.
     */
    expect(ancestor.display).toBe("contents");
    expect(ancestor.overflow).toBe("hidden");
    expect(ancestor.area).toBe(0);

    await expect(page.locator(BAND)).not.toHaveCount(0);
  });
});
