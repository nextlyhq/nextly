/**
 * Layers as a working tree, in the real editor, saved and published through
 * the real API:
 *
 * - pointing at a row outlines its block on the canvas, and choosing a row
 *   selects its block and scrolls the canvas to it;
 * - a row's eye hides its block on the device being edited only, on the
 *   canvas and on the published page, and a hidden block chosen in Layers is
 *   drawn while selected, its ring tagged as hidden;
 * - a row renames by F2, by double-click and from its menu, and the name
 *   never reaches the published page;
 * - a row's padlock locks its block, a locked row refuses a rename and says
 *   why, and the tree filters and moves by the tree keys.
 *
 * Dragging rows is `canvas/layers-drag.spec.ts`.
 *
 * Each test makes its own page, named uniquely. The site's default
 * breakpoints are read (Tablet up to 1024px, Mobile up to 640px), so the
 * site-style lock is held.
 */
import { expect, type Page } from "@playwright/test";

import {
  block,
  boxOf,
  layerRow,
  openLayers,
  selection,
} from "./canvas/editor-driver";
import { gotoAdmin } from "./support/admin";
import { canvasLayer } from "./support/canvas-frame";
import { LOCK } from "./support/locks";
import { test } from "./support/test";

test.describe.configure({ lock: [LOCK.siteStyle], timeout: 180_000 });

const ENTRIES = "/admin/api/collections/pages/entries";

const HERO = "00000000-0000-4000-8000-0000000c4001";
const TITLE = "00000000-0000-4000-8000-0000000c4002";
const SPACER = "00000000-0000-4000-8000-0000000c4003";
const LAST = "00000000-0000-4000-8000-0000000c4004";

function heading(id: string, text: string, name?: string): unknown {
  return {
    id,
    type: "core/heading",
    version: 1,
    ...(name === undefined ? {} : { name }),
    props: { text, level: "h2" },
  };
}

/** A section named Hero holding a heading, a tall spacer, then a heading. */
function nodes(): unknown[] {
  return [
    {
      id: HERO,
      type: "core/section",
      version: 1,
      name: "Hero",
      props: { as: "section", contained: true },
      slots: { children: [heading(TITLE, "Hero heading text")] },
    },
    {
      id: SPACER,
      type: "core/section",
      version: 1,
      name: "Spacer",
      props: { as: "section", contained: true },
      styles: { base: { base: { padding: { blockStart: "1600px" } } } },
      slots: { children: [heading(`${SPACER}-h`, "Spacer heading")] },
    },
    heading(LAST, "Last heading text", "Last"),
  ];
}

/** A published page of its own, holding the nodes above: its id and slug. */
async function createPage(page: Page): Promise<{ id: string; slug: string }> {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const slug = `layers-tree-${stamp}`;
  const created = await page.request.post(ENTRIES, {
    data: {
      title: `Layers tree ${stamp}`,
      slug,
      status: "published",
      content: { formatVersion: 1, kind: "page", nodes: nodes() },
    },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const id = ((await created.json()) as { item: { id: string } }).item.id;
  return { id, slug };
}

async function openBuilder(page: Page, id: string): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoAdmin(page, `/collections/pages/${id}/builder?field=content`);
  await expect(await block(page, TITLE)).toBeVisible({ timeout: 60_000 });
  await openLayers(page);
}

function devices(page: Page) {
  return page.getByRole("radiogroup", { name: "Device" });
}

async function chooseDevice(page: Page, name: RegExp): Promise<void> {
  await devices(page).getByRole("radio", { name }).click();
  await expect(
    devices(page).getByRole("radio", { checked: true })
  ).toHaveAccessibleName(name);
}

function entryWrite(page: Page, id: string) {
  return page.waitForResponse(
    response =>
      new URL(response.url()).pathname.endsWith(`/entries/${id}`) &&
      ["PATCH", "PUT"].includes(response.request().method()) &&
      response.ok()
  );
}

/** Save the edits as a draft and publish them, from the top bar. */
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

/** A row's eye or padlock, shown once the pointer is over the row. */
async function rowAction(
  page: Page,
  id: string,
  action: "toggle-hidden" | "toggle-lock"
) {
  const row = layerRow(page, id);
  await row.hover();
  return row.locator(`[data-action="${action}"]`).first();
}

/** Open the Hero section's row, so the heading inside it has a row. */
async function openHero(page: Page): Promise<void> {
  const hero = layerRow(page, HERO).first();
  if ((await hero.getAttribute("aria-expanded")) === "true") return;
  await hero.locator(`[data-nx-layer="${HERO}"]`).click();
  await hero.press("ArrowRight");
  await expect(hero).toHaveAttribute("aria-expanded", "true");
}

function notice(page: Page) {
  return page.locator(".nx-layers-panel__notice");
}

test("pointing at a row outlines its block, and choosing one scrolls to it", async ({
  page,
}) => {
  const { id } = await createPage(page);
  await openBuilder(page, id);

  await openHero(page);
  const hovered = canvasLayer(page).locator(
    '.nx-canvas-mark[data-mark="hovered"]'
  );
  await layerRow(page, TITLE).locator(`[data-nx-layer="${TITLE}"]`).hover();
  await expect(hovered).toHaveCount(1);
  // Over the heading's own box, where the canvas drew it.
  const mark = await hovered.boundingBox();
  const drawn = await boxOf(page, TITLE);
  expect(mark).not.toBeNull();
  expect(Math.abs((mark?.x ?? 0) - drawn.x)).toBeLessThan(4);
  expect(Math.abs((mark?.y ?? 0) - drawn.y)).toBeLessThan(4);
  // Gone once the pointer leaves the rows.
  await page.getByRole("textbox", { name: "Search layers" }).hover();
  await expect(hovered).toHaveCount(0);

  // The last heading sits below a tall spacer, off the canvas's screen.
  await expect(await block(page, LAST)).not.toBeInViewport();
  await layerRow(page, LAST).locator(`[data-nx-layer="${LAST}"]`).click();
  await expect.poll(() => selection(page)).toEqual([LAST]);
  await expect(await block(page, LAST)).toBeInViewport();
});

test("the eye hides a block on the device being edited only, and selecting it shows it", async ({
  page,
  browser,
}) => {
  const { id, slug } = await createPage(page);
  await openBuilder(page, id);
  await chooseDevice(page, /^Tablet/);
  try {
    const eye = await rowAction(page, LAST, "toggle-hidden");
    await expect(eye).toHaveAttribute("title", "Hide on Tablet");
    await eye.click();
    await expect(notice(page)).toHaveText("Hidden on Tablet.");
    await expect(layerRow(page, LAST)).toContainText("Hidden");
    // Hidden on the canvas, which shows the tablet.
    await expect(await block(page, LAST)).toBeHidden();

    // Chosen in Layers, it is drawn while selected, its ring tagged.
    await layerRow(page, LAST).locator(`[data-nx-layer="${LAST}"]`).click();
    await expect(await block(page, LAST)).toBeVisible();
    await expect(
      canvasLayer(page).locator(
        '.nx-canvas-mark[data-mark="selected"][data-hidden]'
      )
    ).toHaveAttribute("data-label", "Hidden on Tablet");
    // "Visible on" says the same, device by device.
    await expect(page.getByRole("group", { name: "Visible on" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Tablet", exact: true })
    ).toHaveAttribute("aria-pressed", "false");
    await expect(
      page.getByRole("button", { name: "Mobile", exact: true })
    ).toHaveAttribute("aria-pressed", "true");

    await saveAndPublish(page, id);

    // The published page, per device: shown on desktop and mobile, hidden on
    // the tablet alone.
    const visitor = await browser.newPage();
    try {
      for (const [width, shown] of [
        [1280, true],
        [900, false],
        [400, true],
      ] as const) {
        await visitor.setViewportSize({ width, height: 900 });
        const response = await visitor.goto(`/${slug}`);
        expect(response?.status()).toBe(200);
        await expect(visitor.getByText("Hero heading text")).toBeVisible({
          timeout: 60_000,
        });
        const text = visitor.getByText("Last heading text");
        if (shown) await expect(text, `at ${width}px`).toBeVisible();
        else await expect(text, `at ${width}px`).toBeHidden();
      }
    } finally {
      await visitor.close();
    }
  } finally {
    // The device is kept with the author's preferences; put it back.
    await chooseDevice(page, /^Desktop/);
  }
});

test("a row renames by F2, by double-click and from its menu, and the name stays out of the page", async ({
  page,
}) => {
  const { id, slug } = await createPage(page);
  await openBuilder(page, id);

  // F2 on the focused row, Enter keeps the name.
  await openHero(page);
  await layerRow(page, TITLE).locator(`[data-nx-layer="${TITLE}"]`).click();
  await layerRow(page, TITLE).press("F2");
  const field = page.getByRole("textbox", { name: "Rename Heading" });
  await expect(field).toBeFocused();
  await field.fill("Intro title");
  await field.press("Enter");
  await expect(
    layerRow(page, TITLE).locator(`[data-nx-layer="${TITLE}"]`).first()
  ).toHaveText("Intro title");
  await expect(layerRow(page, TITLE)).toBeFocused();

  // Double-click, Escape keeps the old name.
  await layerRow(page, LAST).locator(`[data-nx-layer="${LAST}"]`).dblclick();
  const again = page.getByRole("textbox", { name: "Rename Last" });
  await again.fill("Never kept");
  await again.press("Escape");
  await expect(
    layerRow(page, LAST).locator(`[data-nx-layer="${LAST}"]`)
  ).toHaveText("Last");

  // The row's menu.
  await layerRow(page, HERO)
    .locator(`[data-nx-layer="${HERO}"]`)
    .click({ button: "right" });
  const menu = page.getByRole("menu", { name: "Layer actions" });
  await expect(
    menu.getByRole("menuitem", { name: /^Hide on Desktop/ })
  ).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: /^Lock/ })).toBeVisible();
  await menu.getByRole("menuitem", { name: /^Rename/ }).click();
  const fromMenu = page.getByRole("textbox", { name: "Rename Hero" });
  await fromMenu.fill("Top band");
  await fromMenu.press("Enter");
  await expect(
    layerRow(page, HERO).locator(`[data-nx-layer="${HERO}"]`).first()
  ).toHaveText("Top band");

  await saveAndPublish(page, id);
  const response = await page.request.get(`/${slug}`);
  const html = await response.text();
  expect(html).toContain("Hero heading text");
  expect(html).not.toContain("Intro title");
  expect(html).not.toContain("Top band");
});

test("a row's padlock locks its block, a locked row refuses a rename, and the tree filters and moves by its keys", async ({
  page,
}) => {
  const { id } = await createPage(page);
  await openBuilder(page, id);

  const lock = await rowAction(page, LAST, "toggle-lock");
  await expect(lock).toHaveAttribute("title", "Lock");
  await lock.click();
  await expect(notice(page)).toHaveText("Locked.");
  await expect(layerRow(page, LAST)).toContainText("Locked");
  await expect(await block(page, LAST)).toHaveAttribute("data-nx-locked", /.*/);

  await layerRow(page, LAST).locator(`[data-nx-layer="${LAST}"]`).click();
  await layerRow(page, LAST).press("F2");
  await expect(page.getByRole("textbox", { name: /^Rename/ })).toHaveCount(0);
  await expect(notice(page)).toContainText("locked");

  // The tree keys: Home, then Down to the next row.
  await layerRow(page, LAST).press("Home");
  await expect(layerRow(page, HERO).first()).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(layerRow(page, TITLE)).toBeFocused();

  // The filter keeps a match and the rows around it.
  const search = page.getByRole("textbox", { name: "Search layers" });
  await search.fill("Last");
  await expect(
    page.getByRole("tree", { name: "Layers" }).getByRole("treeitem")
  ).toHaveCount(1);
  await search.fill("");
  await expect(layerRow(page, HERO).first()).toBeVisible();
});
