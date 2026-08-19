import { expect, test } from "@playwright/test";

/**
 * The canvas harness route is real, and the canvas on it is live.
 *
 * NOT the twelve-point acceptance suite — that is its own task and its own
 * file. This spec certifies the thing that suite will stand on: that a browser
 * can reach a mounted `Canvas` driven by `useCanvasDrag`, over a document whose
 * blocks are actually there. Until this passes, every canvas property is
 * untestable in a browser for want of a route rather than for want of a test.
 *
 * It asserts its POPULATION before it asserts anything else. A drag test
 * against an empty canvas reports the same green as a drag test against a
 * working one, and this programme has already paid for that twice — a fixture
 * whose block insert silently missed, twice read as "no save and no warning".
 */

const ROUTE = "/builder-canvas";

/** The renderer's own attribute. NOT `data-nx-id`, which nothing emits. */
const NODE = "[data-nx-node]";

/** The seeded ids, in document order. */
const SEEDED = [
  "hx-heading",
  "hx-text-tall",
  "hx-divider",
  "hx-text-short",
  "hx-spacer",
  "hx-text-last",
];

test.describe("the canvas harness route", () => {
  test("renders every seeded block, addressable by id", async ({ page }) => {
    await page.goto(ROUTE);

    // The population, before any claim about behaviour.
    await expect(page.locator(NODE)).toHaveCount(SEEDED.length);

    const ids = await page
      .locator(NODE)
      .evaluateAll(nodes =>
        nodes.map(node => node.getAttribute("data-nx-node"))
      );
    expect(ids).toEqual(SEEDED);
  });

  test("the canvas is live: a click selects the block under the pointer", async ({
    page,
  }) => {
    await page.goto(ROUTE);
    await expect(page.locator(NODE)).toHaveCount(SEEDED.length);

    const heading = page.locator('[data-nx-node="hx-heading"]');
    // Nothing is selected before the click — the positive control for the
    // assertion below, which would otherwise pass against a canvas that marks
    // everything selected.
    await expect(page.locator("[data-nx-selected]")).toHaveCount(0);

    await heading.click();

    await expect(heading).toHaveAttribute("data-nx-selected", "primary");
  });

  test("a press that does not travel is a click, not a drag", async ({
    page,
  }) => {
    await page.goto(ROUTE);
    const harness = page.locator('[data-testid="canvas-harness"]');
    await expect(page.locator(NODE)).toHaveCount(SEEDED.length);

    const box = await page
      .locator('[data-nx-node="hx-text-short"]')
      .boundingBox();
    if (box === null) throw new Error("the seeded block has no box to press");

    // Two pixels: inside the 4px activation threshold the engine keys on
    // accumulated travel. A drag must NOT start.
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 2, box.y + box.height / 2, {
      steps: 4,
    });

    await expect(harness).toHaveAttribute("data-nx-dragging", "");

    await page.mouse.up();

    // The document did not reorder.
    const ids = await page
      .locator(NODE)
      .evaluateAll(nodes =>
        nodes.map(node => node.getAttribute("data-nx-node"))
      );
    expect(ids).toEqual(SEEDED);
  });

  test("a press that travels far enough DOES start a drag", async ({
    page,
  }) => {
    await page.goto(ROUTE);
    const harness = page.locator('[data-testid="canvas-harness"]');
    await expect(page.locator(NODE)).toHaveCount(SEEDED.length);

    const box = await page
      .locator('[data-nx-node="hx-text-short"]')
      .boundingBox();
    if (box === null) throw new Error("the seeded block has no box to press");

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    // Well past the 4px activation threshold, moved through intermediate
    // points rather than jumped: the engine accumulates travel from real
    // `pointermove` events, so a single hop exercises none of it.
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 60, {
      steps: 12,
    });

    // The engine's own report, not an inference from pixels.
    await expect(harness).toHaveAttribute("data-nx-dragging", "hx-text-short");

    await page.mouse.up();
  });
});
