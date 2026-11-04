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
import { gotoAdmin } from "./support/admin";
import { LOCK } from "./support/locks";
import { storeSiteBreakpoints } from "./support/site-breakpoints";
import { test } from "./support/test";

// The homepage Single is reseeded and edited here, as the other builder files do.
// The site's breakpoints are stored and cleared here, so the site-style lock
// keeps the specs reading the device buttons off them.
test.describe.configure({ lock: [LOCK.homepage, LOCK.siteStyle] });

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
const ENTRIES = "/admin/api/collections/pages/entries";

/** The device buttons, by their group's name. */
function devices(page: Page) {
  return page.getByRole("radiogroup", { name: "Device" });
}

/** The zoom menu's trigger, whose name says whether it is fitting. */
function zoomTrigger(page: Page) {
  return page.getByRole("button", { name: /^Canvas zoom:/ });
}

/** The write of one entry, and not the other requests under its path. */
function entryWrite(page: Page, id: string) {
  return page.waitForResponse(
    response =>
      new URL(response.url()).pathname.endsWith(`/entries/${id}`) &&
      ["PATCH", "PUT"].includes(response.request().method()) &&
      response.ok()
  );
}

/**
 * Save the builder's edits and publish them, from the top bar, as an author
 * does: on a published page, Save keeps the edit as a draft and "Publish
 * changes" puts it live.
 */
async function saveAndPublish(page: Page, id: string): Promise<void> {
  const saved = entryWrite(page, id);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await saved;
  const published = entryWrite(page, id);
  await page
    .getByRole("button", { name: "Publish changes", exact: true })
    .click();
  await published;
}

test.describe("the device being edited", () => {
  test.describe.configure({ timeout: 180_000 });

  test("styles Desktop with a panel open, and the published page shows it at desktop width", async ({
    page,
  }) => {
    // Its own published page, served at /<slug>, so the check reads what a
    // visitor gets rather than the editor's canvas.
    const slug = `device-${Date.now()}`;
    const created = await page.request.post(ENTRIES, {
      data: {
        title: "Device check",
        slug,
        content: { formatVersion: 1, kind: "page", nodes: NODES },
        status: "published",
      },
    });
    expect(created.ok(), `seeding the page: ${created.status()}`).toBe(true);
    const id = ((await created.json()) as { item: { id: string } }).item.id;

    await page.setViewportSize({ width: 1280, height: 800 });
    await gotoAdmin(page, `/collections/pages/${id}/builder?field=content`);
    await expect(await block(page, TEXT_ID)).toBeVisible({ timeout: 30_000 });

    // A fresh editor, so no device has been chosen: the author is on
    // Desktop. Nothing here touches the device buttons, so the only thing that
    // decides where the colour lands is how the editor picks the breakpoint.
    await openLayers(page);

    await clickBlock(page, TEXT_ID);
    await page.getByRole("tab", { name: "Style" }).click();
    // Colour sits in Typography, which starts closed for a text block.
    const section = page.getByRole("button", {
      name: "Typography",
      exact: true,
    });
    if ((await section.getAttribute("aria-expanded")) !== "true") {
      await section.click();
    }
    const color = page
      .getByRole("region", { name: /^Typography/ })
      .getByRole("textbox", { name: "Colour", exact: true });
    await color.fill("#1155cc");
    await color.press("Enter");
    await expect(await block(page, TEXT_ID)).toHaveCSS("color", BLUE);

    await saveAndPublish(page, id);

    // The published page, at a desktop width.
    const visitor = await page.context().newPage();
    await visitor.setViewportSize({ width: 1440, height: 900 });
    try {
      const response = await visitor.goto(`/${slug}`);
      expect(response?.status()).toBe(200);
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
    // Under 100%: a 1280px Desktop is shrunk into the room the panels leave.
    await expect
      .poll(async () =>
        Number((await trigger.textContent())?.match(/(\d+)%/)?.[1])
      )
      .toBeLessThan(100);

    await trigger.click();
    await page.getByRole("menuitemradio", { name: "100%" }).click();
    await expect(trigger).toHaveText("100%");
    await expect(trigger).toHaveAccessibleName("Canvas zoom: 100%");

    await trigger.click();
    await page.getByRole("menuitemradio", { name: "Fit" }).click();
    await expect(trigger).toHaveText(/^Fit · \d+%$/);
    await expect(trigger).toHaveAccessibleName(/^Canvas zoom: fitting, \d+%$/);
  });

  test("goes to actual size on mod+0 and back to fitting on Shift+1", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openEditorWith(page, NODES, TEXT_ID);
    await openLayers(page);
    const trigger = zoomTrigger(page);
    await expect(trigger).toHaveText(/^Fit · \d+%$/);

    // Pressed from inside the editor, on a block, as an author would: the
    // keys answer for the editor that holds focus.
    await clickBlock(page, TEXT_ID);
    // The key the PAGE reads as mod: the suite's browser profile reports a
    // Windows user agent, where mod is Control, whatever machine runs it.
    const apple = await page.evaluate(() =>
      /Mac|iPhone|iPad/.test(navigator.userAgent)
    );
    await page.keyboard.press(apple ? "Meta+0" : "Control+0");
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

test.describe("the device buttons", () => {
  test.describe.configure({ timeout: 120_000 });

  test("a site with two breakpoints shows two buttons and no menu", async ({
    page,
  }) => {
    // Stored breakpoints replace the site's set whole, so this site has
    // Desktop and one more. Cleared afterwards: the e2e site stores none, and
    // its devices come from the app's code.
    await storeSiteBreakpoints(page.request, {
      viewport: [{ id: "tablet", label: "Tablet", maxWidth: 1024 }],
      container: [],
    });
    try {
      await page.setViewportSize({ width: 1440, height: 900 });
      await openEditorWith(page, NODES, TEXT_ID);
      await expect(devices(page).getByRole("radio")).toHaveCount(2);
      await expect(
        devices(page).getByRole("radio", { name: /^Tablet/ })
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: /^More devices/ })
      ).toHaveCount(0);
    } finally {
      await storeSiteBreakpoints(page.request, null);
    }
  });
  test("a site with four breakpoints puts the narrowest in a menu, and styles it from there", async ({
    page,
  }) => {
    await storeSiteBreakpoints(page.request, {
      viewport: [
        { id: "phone", label: "Phone", maxWidth: 480 },
        { id: "mobile", label: "Mobile", maxWidth: 767 },
        { id: "tablet", label: "Tablet", maxWidth: 1024 },
      ],
      container: [],
    });
    try {
      await page.setViewportSize({ width: 1440, height: 900 });
      await openEditorWith(page, NODES, TEXT_ID);
      await expect(devices(page).getByRole("radio")).toHaveCount(3);

      const more = page.getByRole("button", { name: /^More devices/ });
      await more.click();
      await page.getByRole("menuitemradio", { name: /^Phone/ }).click();

      // The menu's button names the device being styled; no button is checked,
      // and the canvas lays the page out at the phone's width.
      await expect(more).toHaveAccessibleName(
        "More devices, styling Phone, up to 480 pixels"
      );
      await expect(more).toHaveText("Phone · 480px");
      await expect(
        devices(page).getByRole("radio", { checked: true })
      ).toHaveCount(0);
    } finally {
      await storeSiteBreakpoints(page.request, null);
    }
  });
});
