/**
 * The colour picker reads hex, rgb() and hsl(), switches its field between
 * Hex, RGB and HSL without moving the colour, offers "Pick from screen" only
 * where the browser has an eyedropper, and keeps the author's Recent colours
 * across a reload, in a block's picker and a colour variable's alike.
 *
 * Nothing is saved: the heading is added in the editor and left unsaved,
 * and Recent colours are the author's own, never the site's.
 */
import { expect, type Locator, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { LOCK } from "./support/locks";
import { test } from "./support/test";

test.describe.configure({ lock: [LOCK.homepage] });

const OPEN_BUILDER_ACTION = /^Open in builder$/;
/**
 * The Page Builder card on the form, whose way in is named as the document
 * bar's is, so a lookup by that name is scoped to the card.
 */
const PAGE_BUILDER_CARD = '[data-slot="page-builder-card"]';

const recent = (page: Page): Locator =>
  page.getByRole("group", { name: "Recent colours" });

/**
 * Add a heading from the Add panel; it is selected once added. The editor
 * reopens the panel it last showed, so the panel is opened only if shut.
 */
async function addHeading(page: Page): Promise<void> {
  const heading = page.getByRole("option", { name: "Heading", exact: true });
  const rail = page.locator('button[data-panel="add"]');
  await expect(rail).toBeVisible({ timeout: 60_000 });
  if (!(await heading.isVisible())) await rail.click();
  await heading.click();
  await expect(page.getByTestId("inspector")).toContainText("Heading");
}

/** The selected heading's Style tab, with its Text section open, where its colour is. */
async function showColour(page: Page): Promise<Locator> {
  const inspector = page.getByTestId("inspector");
  await inspector.getByRole("tab", { name: "Style" }).click();
  const typography = inspector.getByRole("button", {
    name: "Text",
    exact: true,
  });
  if ((await typography.getAttribute("aria-expanded")) !== "true") {
    await typography.click();
  }
  await expect(typography).toHaveAttribute("aria-expanded", "true");
  return inspector;
}

/** Open the heading's colour picker. */
async function openPicker(page: Page): Promise<void> {
  const inspector = await showColour(page);
  await inspector.getByRole("button", { name: /^Colour for Colou?r/ }).click();
  await expect(recent(page)).toBeVisible();
}

async function recentNames(page: Page): Promise<(string | null)[]> {
  return recent(page)
    .getByRole("button")
    .evaluateAll(buttons => buttons.map(b => b.getAttribute("aria-label")));
}

/** Whether one element comes after another in the document. */
async function follows(first: Locator, second: Locator): Promise<boolean> {
  const handle = await second.elementHandle();
  return first.evaluate(
    (element, other) =>
      other !== null &&
      (element.compareDocumentPosition(other) &
        Node.DOCUMENT_POSITION_FOLLOWING) !==
        0,
    handle
  );
}

/** Reload the editor and add a heading again: the last one was not saved. */
async function reloadEditor(page: Page): Promise<void> {
  await page.reload();
  await addHeading(page);
}

test("the colour picker takes any notation, and Recent colours outlast a reload", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoAdmin(page, "/singles/homepage");
  await page
    .locator(PAGE_BUILDER_CARD)
    .getByRole("link", { name: OPEN_BUILDER_ACTION })
    .click();
  // A fresh author's list, whatever an earlier run left on this browser.
  await page.evaluate(() => {
    for (const key of Object.keys(localStorage)) {
      if (key.includes("recent-colours")) localStorage.removeItem(key);
    }
  });
  await reloadEditor(page);

  // Variables, then Recent colours (none yet), then the custom picker.
  await openPicker(page);
  const variables = page.getByRole("listbox", { name: "Colour variables" });
  const custom = page.getByRole("button", { name: "Custom colour" });
  await expect(recent(page)).toContainText(
    "Colours you type or pick show here."
  );
  expect(await follows(variables, recent(page))).toBe(true);
  expect(await follows(recent(page), custom)).toBe(true);

  // Pasted in each notation, each is read.
  await custom.click();
  const hex = page.getByLabel("Hex colour");
  for (const [typed, shown] of [
    ["rgb(255, 0, 0)", "#ff0000"],
    ["hsl(120 100% 25%)", "#008000"],
    ["#0af", "#00aaff"],
  ]) {
    await hex.fill(typed);
    await hex.press("Enter");
    await expect(hex).toHaveValue(shown);
  }

  // The field shows the same colour in each notation.
  await page.getByRole("button", { name: "RGB", exact: true }).click();
  await expect(page.getByLabel("RGB colour")).toHaveValue("rgb(0 170 255)");
  await page.getByRole("button", { name: "HSL", exact: true }).click();
  await expect(page.getByLabel("HSL colour")).toHaveValue("hsl(200 100% 50%)");
  await page.getByRole("button", { name: "Hex", exact: true }).click();
  await expect(page.getByLabel("Hex colour")).toHaveValue("#00aaff");

  // "Pick from screen" exactly where the browser has an eyedropper.
  const hasEyedropper = await page.evaluate(() => "EyeDropper" in window);
  await expect(
    page.getByRole("button", { name: "Pick from screen" })
  ).toHaveCount(hasEyedropper ? 1 : 0);

  // Closing writes the colour; it joins Recent colours.
  await page.keyboard.press("Escape");
  await expect(recent(page)).toHaveCount(0);
  const field = page
    .getByTestId("inspector")
    .getByRole("textbox", { name: "Colour" });
  await expect(field).toHaveValue("#00aaff");

  // A colour typed into the field joins too, as it was typed.
  await field.fill("hsl(120 100% 25%)");
  await field.press("Enter");
  await expect(field).toHaveValue("hsl(120 100% 25%)");

  // After a reload the list is still there, newest first.
  await reloadEditor(page);
  await openPicker(page);
  await expect
    .poll(() => recentNames(page))
    .toEqual(["hsl(120 100% 25%)", "#00aaff"]);

  // Picking one writes it as it is, marked as any raw colour is.
  await recent(page).getByRole("button", { name: "#00aaff" }).click();
  await expect(recent(page)).toHaveCount(0);
  await expect(field).toHaveValue("#00aaff");
  await expect(
    page.getByText(
      "Not adapted to dark mode. Choose a variable to follow light and dark."
    )
  ).toBeVisible();

  // A colour variable's picker in Design shows the same list.
  const panel = page.getByRole("region", { name: "Design panel" });
  if (!(await panel.isVisible())) {
    await page
      .getByRole("navigation", { name: "Editor panels" })
      .getByRole("button", { name: "Design", exact: true })
      .click();
  }
  await expect(panel).toBeVisible();
  await panel.getByRole("tab", { name: /^Colours/ }).click();
  const colours = panel.getByRole("button", { name: /^Colours, \d+$/ });
  if ((await colours.getAttribute("aria-expanded")) !== "true") {
    await colours.click();
  }
  await panel.locator(".nx-vars__row").first().click();
  const editor = page.getByRole("dialog");
  await expect(editor).toBeVisible();
  await editor.getByRole("button", { name: "Pick the light colour" }).click();
  await expect(editor.getByText("Recent colours")).toBeVisible();
  await expect(editor.getByRole("button", { name: "#00aaff" })).toBeVisible();
  await expect(
    editor.getByRole("button", { name: "hsl(120 100% 25%)" })
  ).toBeVisible();
  await page.keyboard.press("Escape");
});
