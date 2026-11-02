/**
 * The device being edited, and the zoom, in a browser.
 *
 * The first case is the defect this guards. The editor read the breakpoint it
 * edits off the width the canvas measured, so at the 1280px minimum with a
 * panel open (a canvas region of about 600px) an author on Desktop was styling
 * the Mobile breakpoint: the canvas looked right and the published page, at a
 * desktop width, showed none of it. The check is on the PUBLISHED page because
 * that is where the defect was invisible from inside the editor.
 *
 * @module tests/builder-editing-device.spec
 */
import { expect, type Page } from "@playwright/test";

import {
  block,
  clickBlock,
  openEditorWith,
  openLayers,
} from "./canvas/editor-driver";
import { LOCK } from "./support/locks";
import { test } from "./support/test";

// The homepage Single is reseeded and edited here, as the other builder files do.
test.describe.configure({ lock: [LOCK.homepage] });

const TEXT_ID = "device-text";
const NODES = [
  {
    id: TEXT_ID,
    type: "core/text",
    version: 1,
    props: { text: "Styled while a panel was open" },
  },
];

const BLUE = "rgb(17, 85, 204)";

/** The device buttons, by their group's name. */
function devices(page: Page) {
  return page.getByRole("radiogroup", { name: "Device" });
}

/** The zoom menu's trigger, whose name says whether it is fitting. */
function zoomTrigger(page: Page) {
  return page.getByRole("button", { name: /^Canvas zoom:/ });
}

/** Save the Single from the builder's top bar, and wait for the write. */
async function save(page: Page): Promise<void> {
  const saved = page.waitForResponse(
    response =>
      response.url().includes("/singles/homepage") &&
      ["PATCH", "PUT", "POST"].includes(response.request().method()) &&
      response.ok()
  );
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await saved;
}

test.describe("the device being edited", () => {
  test.describe.configure({ timeout: 180_000 });

  test("styles Desktop with a panel open, and the published page shows it at desktop width", async ({
    page,
    browser,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openEditorWith(page, NODES, TEXT_ID);

    // A fresh editor, so no device has been chosen: the author is on
    // Desktop. Nothing here touches the device buttons, so the only thing that
    // decides where the colour lands is how the editor picks the breakpoint.
    await openLayers(page);

    await clickBlock(page, TEXT_ID);
    await page.getByRole("tab", { name: "Style" }).click();
    const color = page
      .getByRole("region", { name: "Color" })
      .getByRole("textbox", { name: "Color", exact: true });
    await color.fill("#1155cc");
    await color.press("Enter");
    await expect(await block(page, TEXT_ID)).toHaveCSS("color", BLUE);

    await save(page);

    // The published page, read by a visitor at a desktop width.
    const visitor = await browser.newPage({
      viewport: { width: 1440, height: 900 },
    });
    try {
      await visitor.goto("/");
      const text = visitor.getByText("Styled while a panel was open");
      await expect(text).toBeVisible({ timeout: 60_000 });
      await expect(text).toHaveCSS("color", BLUE);
    } finally {
      await visitor.close();
    }
  });

  test("keeps the chosen device when panels open and close", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openEditorWith(page, NODES, TEXT_ID);

    // Desktop is the device on a fresh editor, with Layers open or not.
    await openLayers(page);
    await expect(
      devices(page).getByRole("radio", { checked: true })
    ).toHaveText("Desktop · 1280px");

    await devices(page)
      .getByRole("radio", { name: /^Tablet/ })
      .click();
    const chosen = devices(page).getByRole("radio", { checked: true });
    await expect(chosen).toHaveAccessibleName(/^Tablet/);
    await expect(chosen).toHaveText("Tablet · 1024px");

    await openLayers(page);
    await expect(chosen).toHaveAccessibleName(/^Tablet/);
    await page
      .getByRole("navigation", { name: "Editor panels" })
      .getByRole("button", { name: "Layers", exact: true })
      .click();
    await expect(chosen).toHaveAccessibleName(/^Tablet/);

    // Kept with the author's preferences, so a reload comes back to it.
    await page.reload();
    await expect(
      devices(page).getByRole("radio", { checked: true })
    ).toHaveAccessibleName(/^Tablet/, { timeout: 30_000 });
  });
});

test.describe("the zoom", () => {
  test.describe.configure({ timeout: 120_000 });

  test("fits the device into the canvas, or sets a scale from the menu", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openEditorWith(page, NODES, TEXT_ID);
    await openLayers(page);

    // Desktop is laid out at 1280 and fitted into a narrower region.
    const trigger = zoomTrigger(page);
    await expect(trigger).toHaveText(/^Fit · \d+%$/);
    const fitted = Number((await trigger.textContent())?.match(/(\d+)%/)?.[1]);
    expect(fitted).toBeLessThan(100);

    await trigger.click();
    await page.getByRole("menuitemradio", { name: "100%" }).click();
    await expect(trigger).toHaveText("100%");
    await expect(trigger).toHaveAccessibleName("Canvas zoom: 100%");

    await trigger.click();
    await page.getByRole("menuitemradio", { name: "Fit" }).click();
    await expect(trigger).toHaveText(`Fit · ${fitted}%`);
  });

  test("goes to actual size on mod+0 and back to fitting on Shift+1", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openEditorWith(page, NODES, TEXT_ID);
    await openLayers(page);
    const trigger = zoomTrigger(page);
    await expect(trigger).toHaveText(/^Fit · \d+%$/);

    // Pressed with nothing focused that types, as an author would on the canvas.
    await page.locator("body").click({ position: { x: 1, y: 1 } });
    await page.keyboard.press("ControlOrMeta+0");
    await expect(trigger).toHaveText("100%");

    await page.keyboard.press("Shift+1");
    await expect(trigger).toHaveText(/^Fit · \d+%$/);
  });

  test("goes back to fitting when the device changes", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openEditorWith(page, NODES, TEXT_ID);
    const trigger = zoomTrigger(page);

    await trigger.click();
    await page.getByRole("menuitemradio", { name: "150%" }).click();
    await expect(trigger).toHaveText("150%");

    await devices(page)
      .getByRole("radio", { name: /^Mobile/ })
      .click();
    await expect(trigger).toHaveText(/^Fit · \d+%$/);
  });
});
