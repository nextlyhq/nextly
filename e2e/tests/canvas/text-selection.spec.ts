import { expect, test, type Page } from "@playwright/test";

/**
 * A press on a block is a grab, not a text selection.
 *
 * Blocks are made of text, so the two gestures start identically: pointer down
 * on a word, then movement. The browser resolves that as a selection on the
 * FIRST move, while `useCanvasDrag` does not call itself dragging until the
 * pointer has travelled its activation distance — so without something saying
 * otherwise, the browser's answer is the one that lands and the author gets
 * highlighted words instead of a moved block.
 *
 * Whether a given press hits text at all depends on where the glyphs fall, so
 * this reproduced on CI's font metrics while passing on the machine the canvas
 * was written on. That is why the press here is aimed at a word deliberately
 * rather than at a block's corner: the corner is only sometimes over text, and
 * a test that is only sometimes over text only sometimes tests this.
 *
 * @module tests/canvas/text-selection
 */

const ROUTE = "/builder-canvas";
const HOST = '[data-testid="canvas-harness"]';

async function openCanvas(page: Page): Promise<void> {
  await page.goto(ROUTE);
  await page.locator(HOST).waitFor();
}

/** The middle of a rendered word, which is the ambiguous place to press. */
async function wordPoint(
  page: Page,
  nodeId: string
): Promise<{ x: number; y: number }> {
  const point = await page
    .locator(`[data-nx-node="${nodeId}"]`)
    .evaluate(element => {
      const text = element.ownerDocument.evaluate(
        ".//text()[normalize-space()]",
        element,
        null,
        9 /* FIRST_ORDERED_NODE_TYPE */,
        null
      ).singleNodeValue;
      if (text === null) return null;
      const range = element.ownerDocument.createRange();
      range.selectNodeContents(text);
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return null;
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    });
  if (point === null) throw new Error(`${nodeId} renders no measurable text`);
  return point;
}

test.describe("pressing a block's text", () => {
  test("drags the block instead of selecting the words", async ({ page }) => {
    await openCanvas(page);

    const from = await wordPoint(page, "hx-text-short");
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    // Stepped, because both the activation threshold and the browser's own
    // selection respond to movement rather than to a final position.
    await page.mouse.move(from.x, from.y + 120, { steps: 16 });

    const dragging = await page.locator(HOST).getAttribute("data-nx-dragging");
    const selected = await page.evaluate(() =>
      (globalThis.getSelection()?.toString() ?? "").trim()
    );

    await page.mouse.up();

    expect(
      dragging,
      "a press on a word then a drag must pick the block up"
    ).toBeTruthy();
    expect(
      selected,
      `the drag selected text instead of moving a block: ${JSON.stringify(selected)}`
    ).toBe("");
  });

  test("still lets an editable block's own text be selected", async ({
    page,
  }) => {
    // The canvas turns selection off; anything editable turns it back on. This
    // is the half that keeps the rule from breaking inline editing, and it is
    // asserted on a real element rather than by reading the stylesheet.
    await openCanvas(page);
    const editable = await page.evaluate(() => {
      const canvas = document.querySelector(".nx-canvas");
      if (canvas === null) return null;
      const probe = document.createElement("p");
      probe.setAttribute("contenteditable", "true");
      probe.textContent = "editable text";
      canvas.appendChild(probe);
      const style = getComputedStyle(probe).userSelect;
      probe.remove();
      return style;
    });
    expect(editable).toBe("text");
  });
});
