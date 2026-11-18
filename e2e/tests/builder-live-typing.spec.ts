/**
 * The block settings panel's typed fields show on the canvas as they are
 * typed, in the real editor:
 *
 * 1. A Heading's text typed in the panel changes the heading on the canvas
 *    with each letter, while the field still has focus; one Undo takes the
 *    whole edit back. A field that wrote on blur would leave the canvas
 *    unchanged until the field is left; one that wrote a step per letter
 *    would need an Undo per letter.
 * 2. A Section's top padding typed as `24` moves the canvas before the field
 *    is left; `24p` keeps the 24px look while the field says why; `24px`
 *    goes on. One Undo puts the old padding back.
 * 3. A Heading's colour typed as `#ff` keeps the colour it had; `#ff0000`
 *    turns it red, before the field is left.
 *
 * @module builder-live-typing.spec
 */
import { expect, type Locator, type Page } from "@playwright/test";

import {
  block,
  clickBlock,
  openEditorWith,
  selection,
} from "./canvas/editor-driver";
import { LOCK } from "./support/locks";
import { test } from "./support/test";

test.describe.configure({ mode: "serial", lock: [LOCK.homepage] });

/** The editor's undo: `mod` is Control in the suite's browser. */
const UNDO = "Control+z";

const HEADING = "lt-heading";
const SECTION = "lt-section";

const NODES = [
  {
    id: HEADING,
    type: "core/heading",
    version: 1,
    props: { text: "Old words", level: "h2" },
    styles: { base: { base: { color: "rgb(0, 0, 255)" } } },
  },
  {
    id: SECTION,
    type: "core/section",
    version: 1,
    props: { as: "section", contained: true },
    styles: { base: { base: { padding: { blockStart: "8px" } } } },
    slots: {
      children: [
        {
          id: `${SECTION}-text`,
          type: "core/text",
          version: 1,
          props: { text: "A band" },
        },
      ],
    },
  },
];

function computed(locator: Locator, property: string): Promise<string> {
  return locator.evaluate(
    (element, name) => getComputedStyle(element).getPropertyValue(name),
    property
  );
}

async function selectBlock(page: Page, id: string, click = id): Promise<void> {
  await clickBlock(page, click);
  if (click !== id) await page.keyboard.press("Escape");
  await expect.poll(() => selection(page)).toEqual([id]);
}

/** Open a Style section of the selected block by the start of its name. */
async function openStyleSection(page: Page, name: RegExp): Promise<void> {
  const inspector = page.getByTestId("inspector");
  await inspector.getByRole("tab", { name: "Style" }).click();
  const header = inspector.getByRole("button", { name }).first();
  if ((await header.getAttribute("aria-expanded")) !== "true") {
    await header.click();
  }
  await expect(header).toHaveAttribute("aria-expanded", "true");
}

test.beforeEach(async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openEditorWith(page, NODES, HEADING);
});

test("a Heading's text follows typing before blur, and one Undo takes the edit back", async ({
  page,
}) => {
  await selectBlock(page, HEADING);
  const field = page
    .getByTestId("inspector")
    .getByRole("textbox", { name: "Text", exact: true });
  await field.click();
  await field.press("End");
  const heading = await block(page, HEADING);
  await field.pressSequentially(" and new", { delay: 40 });
  // Still in the field: nothing has blurred it.
  await expect(field).toBeFocused();
  await expect(heading).toHaveText("Old words and new");

  // Blur by Tab, then one Undo: the whole edit goes, not one letter.
  await field.press("Tab");
  await page.keyboard.press(UNDO);
  await expect(heading).toHaveText("Old words");
  await expect(field).toHaveValue("Old words");
});

test("a padding typed as 24 moves the canvas, 24p keeps the last valid look", async ({
  page,
}) => {
  await selectBlock(page, SECTION, `${SECTION}-text`);
  await openStyleSection(page, /^Spacing/);
  const band = await block(page, SECTION);
  await expect.poll(() => computed(band, "padding-top")).toBe("8px");

  await page
    .locator(".nx-spacing-box")
    .getByRole("button", { name: /^Padding top / })
    .click();
  const number = page.getByLabel("Value for Padding top");
  await number.fill("");
  await number.pressSequentially("24", { delay: 40 });
  await expect(number).toBeFocused();
  await expect.poll(() => computed(band, "padding-top")).toBe("24px");

  // A unit on its way in: the canvas keeps 24px, and the field says why.
  await number.press("p");
  await expect(number).toHaveAttribute("aria-invalid", "true");
  expect(await computed(band, "padding-top")).toBe("24px");
  await number.press("x");
  await expect(number).not.toHaveAttribute("aria-invalid", "true");
  await expect.poll(() => computed(band, "padding-top")).toBe("24px");

  await number.press("Enter");
  await page.keyboard.press(UNDO);
  await expect.poll(() => computed(band, "padding-top")).toBe("8px");
});

test("half a hex colour keeps the colour the Heading had; the whole one turns it red", async ({
  page,
}) => {
  await selectBlock(page, HEADING);
  await openStyleSection(page, /^Typography/);
  const heading = await block(page, HEADING);
  const field = page
    .getByTestId("inspector")
    .locator('[data-property="color"] input')
    .first();
  await field.fill("");
  await field.pressSequentially("#ff", { delay: 40 });
  await expect(field).toBeFocused();
  expect(await computed(heading, "color")).toBe("rgb(0, 0, 255)");
  await field.pressSequentially("0000", { delay: 40 });
  await expect.poll(() => computed(heading, "color")).toBe("rgb(255, 0, 0)");
  await expect(field).toBeFocused();
});
