/**
 * The block panel's head and a row's actions, in a browser.
 *
 * - Content · Style · Advanced are one bar across the panel's width.
 * - A sort key's ⋯ is faded while its row is at rest, and shows while the
 *   row is pointed at, while anything in the row has keyboard focus, and
 *   while its menu is open; the row's box is the same in every one of those
 *   states, so nothing moves when the ⋯ appears.
 *
 * Its own page, named uniquely, so no page lock is needed.
 *
 * @module tests/builder-inspector-row-actions.spec
 */
import { expect, type Locator, type Page } from "@playwright/test";

import { layerRow, openLayers } from "./canvas/editor-driver";
import { gotoAdmin } from "./support/admin";
import { test } from "./support/test";

const PAGES = "/admin/api/collections/pages/entries";

/** The list, sorted by two keys, and its template's heading. */
const LIST = "00000000-0000-4000-8000-0000000a7101";
const TITLE = "00000000-0000-4000-8000-0000000a7102";

/** A draft page holding one list over bound entries, and its id. */
async function createPage(page: Page): Promise<string> {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const created = await page.request.post(PAGES, {
    data: {
      title: `Row actions ${stamp}`,
      slug: `row-actions-${stamp}`,
      status: "draft",
      content: {
        formatVersion: 1,
        kind: "page",
        nodes: [
          {
            id: LIST,
            type: "core/collection-loop",
            version: 1,
            props: {
              collection: "bound-entries",
              limit: 10,
              sort: "-price,title",
            },
            slots: {
              children: [
                {
                  id: TITLE,
                  type: "core/heading",
                  version: 1,
                  props: { text: "Entry", level: "h3" },
                  bindings: { text: { $bind: "title", source: "item" } },
                },
              ],
            },
          },
        ],
      },
    },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const body = (await created.json()) as { item?: { id?: string } };
  const id = body.item?.id;
  if (typeof id !== "string") throw new Error("the new page has no id");
  return id;
}

/** Nothing focused: whatever holds focus lets it go. */
async function blurAll(page: Page): Promise<void> {
  await page.evaluate(() => {
    const focused = document.activeElement;
    if (focused instanceof HTMLElement) focused.blur();
  });
}

/** A row's box, to the pixel, as the page lays it out. */
async function boxOf(row: Locator): Promise<string> {
  const box = await row.boundingBox();
  if (box === null) throw new Error("the row has no box");
  return [box.x, box.y, box.width, box.height].map(n => n.toFixed(1)).join(",");
}

test("the panel's tabs span its width, and a row's ⋯ appears in place", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoAdmin(page, "/");
  const id = await createPage(page);
  await gotoAdmin(page, `/collections/pages/${id}/builder?field=content`);
  await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible({
    timeout: 60_000,
  });
  await openLayers(page);
  await layerRow(page, LIST).click();
  const inspector = page.locator(".nx-inspector");

  // The tab bar fills its row, less the panel's options beside it.
  const bar = inspector.getByRole("tablist").first();
  const row = inspector.locator(".nx-inspector__tabrow");
  const barBox = await bar.boundingBox();
  const rowBox = await row.boundingBox();
  if (barBox === null || rowBox === null) throw new Error("no tab bar box");
  expect(barBox.width).toBeGreaterThan(rowBox.width * 0.8);

  const more = inspector.getByRole("button", {
    name: "More for sort by Price",
  });
  // The sort row this ⋯ belongs to, found from the button itself.
  const sortRow = more.locator(
    "xpath=ancestor::li[contains(concat(' ', @class, ' '), ' nx-list-sort ')][1]"
  );
  await expect(more).toBeAttached();
  // At rest: the pointer away, nothing in the row focused.
  await page.mouse.move(2, 2);
  await blurAll(page);
  await expect(more).toHaveCSS("opacity", "0");
  const atRest = await boxOf(sortRow);

  // Pointed at: shown, in the same box.
  await sortRow.hover();
  await expect(more).toHaveCSS("opacity", "1");
  expect(await boxOf(sortRow)).toBe(atRest);

  // Keyboard focus anywhere in the row, the pointer away: shown.
  await page.mouse.move(2, 2);
  await expect(more).toHaveCSS("opacity", "0");
  await sortRow.getByRole("combobox").first().focus();
  await expect(more).toHaveCSS("opacity", "1");
  expect(await boxOf(sortRow)).toBe(atRest);

  // Its menu open, the pointer away: still shown.
  await more.click();
  await expect(page.getByRole("menuitem", { name: /Move down/ })).toBeVisible();
  await page.mouse.move(2, 2);
  await expect(more).toHaveCSS("opacity", "1");
  await page.keyboard.press("Escape");

  // CONTROL: the other row, never pointed at or focused, stays faded.
  const other = inspector.getByRole("button", {
    name: "More for sort by Title",
  });
  await page.mouse.move(2, 2);
  await blurAll(page);
  await expect(other).toHaveCSS("opacity", "0");
});
