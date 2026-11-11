/**
 * The Builder's lists of collections, Singles and field groups, on the
 * playground with the Page Builder installed.
 *
 * A plugin's entries are listed under the plugin, folded and read-only, and
 * never among the site's own; at 1440 by 900 no list scrolls sideways, its
 * columns and row actions in view.
 */
import { expect, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { test } from "./support/test";

/** The three lists, by their admin path and the site table's name. */
const LISTS = [
  { path: "/builder/collections", table: "Collections table" },
  { path: "/builder/singles", table: "Singles table" },
  { path: "/builder/field-groups", table: "Field Groups table" },
] as const;

/**
 * How far the page, and every scrolling box holding a table, could scroll
 * sideways: zero for each when everything fits.
 */
async function sidewaysOverflow(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    const overflow = (element: Element): number =>
      Math.max(0, element.scrollWidth - element.clientWidth);
    const boxes = new Set<Element>([document.scrollingElement!]);
    for (const table of document.querySelectorAll("table")) {
      for (let node = table.parentElement; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (/(auto|scroll)/.test(style.overflowX)) boxes.add(node);
      }
    }
    return [...boxes].map(overflow);
  });
}

test.describe("the Builder's lists", () => {
  test("with the Page Builder installed", async ({ page }) => {
    await gotoAdmin(page, "/builder/collections");
    const site = page.getByRole("table", { name: "Collections table" });
    // The control: the site's table has drawn its rows.
    await expect(site.locator("tbody tr").first()).toBeVisible();

    // The Page Builder's pages are not among the site's collections.
    await expect(site.getByText("pages", { exact: true })).toHaveCount(0);

    // They are under the plugin, by name, folded.
    const toggle = page.getByRole("button", { name: /^Page Builder\b/ });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");

    const section = page.getByRole("table", {
      name: "Page Builder collections",
    });
    await expect(
      section.getByText("pages", { exact: true }).first()
    ).toBeVisible();
    // Its source is the plugin's name, never "Unknown"; nothing to select.
    await expect(page.getByText("Unknown", { exact: true })).toHaveCount(0);
    await expect(section.getByRole("checkbox")).toHaveCount(0);

    // Read-only: its actions open it and its entries, and never delete it.
    const row = section
      .locator("tr")
      .filter({ has: page.getByText("pages", { exact: true }) })
      .first();
    await row.getByRole("button", { name: "Row actions" }).click();
    const menu = page.getByRole("menu");
    await expect(menu.getByRole("menuitem")).toHaveText([
      "View",
      "View entries",
    ]);
  });

  for (const list of LISTS) {
    test(`no sideways scroll at 1440 by 900: ${list.path}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await gotoAdmin(page, list.path);
      const table = page.getByRole("table", { name: list.table });
      await expect(table).toBeVisible();
      // Measured once the rows (or the empty state) have drawn.
      await expect(table.locator("tbody tr").first()).toBeVisible();

      const overflow = await sidewaysOverflow(page);
      // The control: the page itself was measured.
      expect(overflow.length).toBeGreaterThan(0);
      expect(overflow).toEqual(overflow.map(() => 0));

      // The last column, the row actions, is inside the window.
      const actions = table
        .getByRole("button", { name: "Row actions" })
        .first();
      if ((await actions.count()) > 0) {
        const box = await actions.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.x + box!.width).toBeLessThanOrEqual(1440);
      }
    });
  }
});
