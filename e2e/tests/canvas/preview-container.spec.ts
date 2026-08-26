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

  test("edits the BASE tier in a region too narrow to hold it", async ({
    page,
  }) => {
    /*
     * The regression this canvas is scaled for, and the only place it can be
     * decided.
     *
     * The editor's canvas region is around 912px on the supported 1280px shell,
     * and a site bounding its widest tier above that leaves no width an author
     * can ask for that reaches the unconditional tier. Treated as a ceiling the
     * request was capped at the region, so the narrower tier applied and every
     * style edit landed in it — while the control said the widest tier was
     * selected.
     *
     * Scaled instead, the box is LAID OUT at the width that was asked for and
     * PAINTED down into the space available. A transform or a zoom is not
     * something jsdom evaluates and a container query is not something it
     * resolves, so the whole claim — that a box painted at half size still
     * answers queries at its full width — is invisible to every unit test.
     */
    await page.goto(ROUTE);
    const subject = page.locator(SUBJECT).first();
    await expect(subject).toBeVisible();

    await page.getByTestId("go-cramped").click();
    await page.getByTestId("go-base").click();

    // Waited on the canvas having measured the width it was ASKED for, which is
    // the layout width the queries answer to. Polling the colour alone would
    // pass against a render that had not resized yet.
    await expect
      .poll(async () =>
        Number(await page.getByTestId("measured").textContent())
      )
      .toBe(800);

    // The base declaration, in a region 400px wide. A canvas that capped the
    // request would be showing the narrow tier here.
    await expect(subject).toHaveCSS("color", WIDE);
  });

  test("PAINTS that canvas down into the region it was given", async ({
    page,
  }) => {
    /*
     * The other half, and it has to be asserted separately: a canvas that
     * simply OVERFLOWED its region would satisfy the case above — the layout
     * width would be right and the queries would resolve base — while spilling
     * the page under the inspector and out of the editor.
     *
     * So the claim is that the two widths DIFFER: laid out at what was asked
     * for, painted at what fits. Reading only one of them cannot separate a
     * scaled canvas from an overflowing one.
     */
    await page.goto(ROUTE);
    await expect(page.locator(SUBJECT).first()).toBeVisible();

    await page.getByTestId("go-cramped").click();
    await page.getByTestId("go-base").click();
    await expect
      .poll(async () =>
        Number(await page.getByTestId("measured").textContent())
      )
      .toBe(800);

    const box = await page
      .locator(".nx-canvas")
      .first()
      .evaluate(element => ({
        laidOut: (element as HTMLElement).offsetWidth,
        painted: Math.round(element.getBoundingClientRect().width),
      }));

    expect(box.laidOut).toBe(800);
    // Painted into the region rather than through it. Asserted as a bound
    // rather than as an exact number: the region carries the harness's own
    // controls above the canvas, so the space left is at most its width.
    expect(box.painted).toBeLessThanOrEqual(400);
    expect(box.painted).toBeGreaterThan(0);
  });

  test("answers to the BOX rather than to the window", async ({ page }) => {
    /*
     * The property that separates a container compile from a published one, and
     * the only case in which the two give OPPOSITE answers.
     *
     * The viewport is set BELOW the fixture's 600px bound and the region is
     * then widened past it, so the box is 800px inside a 500px window:
     *
     *   `@media (max-width: 600px)`      asks the window, 500 -> MATCHES  -> red
     *   `@container … (max-width: 600px)` asks the box,    800 -> no match -> blue
     *
     * A window wider than the bound would not discriminate: neither
     * implementation applies the narrow tier there, so the case would stay green
     * against the exact regression it names.
     */
    await page.setViewportSize({ width: 500, height: 800 });
    await page.goto(ROUTE);
    const subject = page.locator(SUBJECT).first();
    await expect(subject).toBeVisible();

    await page.getByTestId("go-overflow").click();

    /*
     * Waited on the canvas having MEASURED a box wider than the bound, so the
     * assertion cannot run against the region before it widened — which would
     * be the narrow state, and would pass for the wrong reason.
     */
    await expect
      .poll(async () =>
        Number(await page.getByTestId("measured").textContent())
      )
      .toBeGreaterThan(600);

    await expect(subject).toHaveCSS("color", WIDE);
  });
});
