/**
 * Moving blocks from the Layers panel, as an author meets it in the editor:
 * a drag the placement rule refuses says why and leaves the page as it was,
 * and every move a drag makes also has a keyboard path and a menu path
 * (WCAG 2.2 SC 2.5.7).
 *
 * The drag that succeeds — reordering, and nesting by dragging right — is E14
 * of the editor acceptance suite; this file holds the rest.
 */
import { expect, type Page } from "@playwright/test";

import { LOCK } from "../support/locks";
import { test } from "../support/test";

import {
  announcer,
  boxOf,
  layerRow,
  openEditorWith,
  openLayers,
  selection,
  structure,
} from "./editor-driver";

test.describe.configure({ lock: [LOCK.homepage] });

const REFUSED = "A Button can't go inside this Card.";

/** A linked card, and a button below it that may not go inside one. */
const LINKED_CARD = [
  {
    id: "ld-card",
    type: "core/card",
    version: 1,
    props: { as: "div", link: "/somewhere" },
  },
  {
    id: "ld-button",
    type: "core/button",
    version: 1,
    props: { label: "Go", type: "button" },
  },
];

/** A section with a block inside it, and a block after it. */
const SECTION = [
  {
    id: "ld-section",
    type: "core/section",
    version: 1,
    props: { as: "section", contained: true },
    slots: {
      children: [
        {
          id: "ld-inner",
          type: "core/text",
          version: 1,
          props: { text: "In" },
        },
      ],
    },
  },
  { id: "ld-after", type: "core/text", version: 1, props: { text: "After" } },
];

/**
 * Open the block menu over a block, pressed at its right edge as `clickBlock`
 * presses, clear of the toolbar that floats at the selected block's left.
 */
async function openMenuOn(page: Page, id: string): Promise<void> {
  const box = await boxOf(page, id);
  await page.mouse.click(box.x + box.width - 8, box.y + box.height / 2, {
    button: "right",
  });
  await expect(page.getByRole("menu")).toBeVisible();
}

/** The Layers panel's own live region, where a refused drop is spoken. */
function layersAnnouncer(page: Page) {
  return page.locator(".nx-layers-panel").getByRole("status");
}

test.describe("moving blocks from Layers", () => {
  test("a refused drag says why by the row and leaves the block where it was", async ({
    page,
  }) => {
    await openEditorWith(page, LINKED_CARD, "ld-card");
    await openLayers(page);
    const from = await layerRow(page, "ld-button").boundingBox();
    if (from === null) throw new Error("[e2e] the button's row has no box");
    const x = from.x + 48;
    await page.mouse.move(x, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(x, from.y + from.height / 2 + 6, { steps: 3 });
    // Its own row's upper half, one level right: inside the card above.
    await page.mouse.move(x + 26, from.y + from.height * 0.25, { steps: 8 });

    const reason = page.locator(".nx-layers-drop-refusal");
    await expect(reason).toBeVisible();
    await expect(reason).toContainText(REFUSED);
    await expect(
      page.locator(".nx-layers-drop-line[data-refused]")
    ).toBeVisible();
    await expect(layersAnnouncer(page)).toContainText(REFUSED);

    await page.mouse.up();
    await expect(reason).toHaveCount(0);
    // Polled: the page in the canvas's frame is drawn again after the release,
    // and a single reading can land between the two renders.
    await expect.poll(() => structure(page)).toEqual(["ld-card", "ld-button"]);
  });

  test("a Layers row moves by keyboard, in and out", async ({ page }) => {
    await openEditorWith(page, SECTION, "ld-section");
    await openLayers(page);
    await layerRow(page, "ld-after").click();
    expect(await selection(page)).toEqual(["ld-after"]);

    await page.keyboard.press("Alt+ArrowRight");
    await expect
      .poll(() => structure(page))
      .toEqual(["ld-section", "ld-section>ld-inner", "ld-section>ld-after"]);
    await expect(announcer(page)).toHaveText(
      "Block moved into the container above it"
    );

    await page.keyboard.press("Alt+ArrowLeft");
    await expect
      .poll(() => structure(page))
      .toEqual(["ld-section", "ld-section>ld-inner", "ld-after"]);
  });

  test("the block menu moves a block in and out", async ({ page }) => {
    await openEditorWith(page, SECTION, "ld-section");
    await openMenuOn(page, "ld-after");
    await page.getByRole("menuitem", { name: "Move in" }).click();
    await expect
      .poll(() => structure(page))
      .toEqual(["ld-section", "ld-section>ld-inner", "ld-section>ld-after"]);

    await openMenuOn(page, "ld-after");
    await page.getByRole("menuitem", { name: "Move out" }).click();
    await expect
      .poll(() => structure(page))
      .toEqual(["ld-section", "ld-section>ld-inner", "ld-after"]);
  });
});
