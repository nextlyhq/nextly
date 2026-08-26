import { expect, test } from "@playwright/test";

/**
 * The preview compile, measured in a browser because nowhere else can decide it.
 *
 * `canvas.test.tsx` asserts the emitted sheet names the box and the element
 * establishes that container; `compile-page.test.ts` asserts the at-rule text.
 * Neither can say whether the browser then APPLIES it. jsdom ships no `CSS`
 * object and evaluates no container query, so a correct stylesheet over a box
 * that establishes nothing produces exactly the same green as a working one.
 *
 * The claim this whole mechanism exists to support is a single sentence:
 * narrowing the canvas changes which declaration wins. It is the reason the
 * viewport tiers are compiled as `@container` at all, and this is the only
 * place it can be checked.
 *
 * The width is driven by the harness's own control rather than by resizing the
 * VIEWPORT, and that is load-bearing rather than convenient: a spec that moved
 * the window would pass just as well against a canvas still compiling `@media`,
 * which is precisely the bug the container compile removes. Moving the box while
 * the window holds still is the only motion that separates the two.
 */

const ROUTE = "/builder-canvas-preview";
const SUBJECT = '[data-nx-node="subject"]';

/** The two colours the fixture authors, one per tier. */
const WIDE = "rgb(0, 0, 255)";
const NARROW = "rgb(255, 0, 0)";

test.describe("the canvas preview compile", () => {
  test("changes which declaration wins when the BOX narrows", async ({
    page,
  }) => {
    await page.goto(ROUTE);
    const subject = page.locator(SUBJECT).first();
    await expect(subject).toBeVisible();

    /*
     * Waited on the canvas's own measurement rather than on a timeout: the
     * request is a ceiling and what the queries resolve against is the width the
     * box actually got, so this is the number the assertions are about.
     */
    await expect(page.getByTestId("measured")).not.toHaveText("");

    await expect(subject).toHaveCSS("color", WIDE);

    await page.getByTestId("go-narrow").click();

    /*
     * The window has not moved. Only the box has. A canvas compiling `@media`
     * reaches this line still showing the wide colour.
     */
    await expect(subject).toHaveCSS("color", NARROW);
  });

  test("returns to the wider declaration when the box is released", async ({
    page,
  }) => {
    /*
     * The control. Without it a canvas that applied the narrow rule
     * unconditionally — a container established at a width nothing ever
     * exceeds, say — would satisfy the case above, and the suite would certify
     * a preview that is simply always narrow.
     */
    await page.goto(ROUTE);
    const subject = page.locator(SUBJECT).first();
    await expect(subject).toBeVisible();

    await page.getByTestId("go-narrow").click();
    await expect(subject).toHaveCSS("color", NARROW);

    await page.getByTestId("go-wide").click();

    await expect(subject).toHaveCSS("color", WIDE);
  });

  test("answers to the BOX rather than to the window", async ({ page }) => {
    /*
     * The property that separates a container compile from a published one, and
     * the one no unit test can reach. The window is made narrower than the tier
     * bound while the box stays unconstrained: under `@media` the narrow rule
     * would now apply, and under `@container` against a box wider than the
     * bound it must not.
     *
     * The viewport is set below the fixture's 600px bound and the canvas fills
     * the page, so this also pins that the box is measured rather than assumed
     * — a canvas reporting its requested width would read as unbounded here.
     */
    await page.setViewportSize({ width: 900, height: 800 });
    await page.goto(ROUTE);
    const subject = page.locator(SUBJECT).first();
    await expect(subject).toBeVisible();
    await expect(page.getByTestId("measured")).not.toHaveText("");

    await expect(subject).toHaveCSS("color", WIDE);
  });
});
