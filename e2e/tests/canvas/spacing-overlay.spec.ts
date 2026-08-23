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
