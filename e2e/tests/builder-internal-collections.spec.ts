/**
 * The page builder's internal collections stay out of an author's way.
 *
 * The builder keeps its own bookkeeping in collections: which pages use each
 * shared style and component, the components retired from use, and the
 * progress of the job that backfills those counts. They exist for the server,
 * and an author should meet none of them: no link in the sidebar's navigation
 * and none on the dashboard.
 *
 * Asserted on links' targets, by the collections' slugs, because a label can
 * change and a target is what an author would land on. Each check is paired
 * with a control that the same scan finds an authored collection, so a page
 * that drew no links at all cannot pass.
 */
import { expect, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { test } from "./support/test";

/** The builder's internal collections, by the slug prefix they share. */
const INTERNAL = "nx_pb_";

/** Every link target on the page, read from the document. */
async function linkTargets(page: Page): Promise<string[]> {
  return page
    .locator("a[href]")
    .evaluateAll(links => links.map(link => link.getAttribute("href") ?? ""));
}

test.describe("the page builder's internal collections", () => {
  test("have no link in the admin's navigation", async ({ page }) => {
    await gotoAdmin(page, "/collections/pages");
    const targets = await linkTargets(page);

    // The control: the navigation links to an authored collection.
    expect(targets.some(target => target.includes("/collections/pages"))).toBe(
      true
    );
    expect(targets.filter(target => target.includes(INTERNAL))).toEqual([]);
  });

  test("have no link on the dashboard", async ({ page }) => {
    await gotoAdmin(page, "/");
    // Settled: the dashboard draws its cards after it reads the counts.
    await expect(page.locator("main")).toBeVisible();
    const targets = await linkTargets(page);

    expect(targets.some(target => target.includes("/collections/"))).toBe(true);
    expect(targets.filter(target => target.includes(INTERNAL))).toEqual([]);
    await expect(page.getByText(/usage backfill|class usage/i)).toHaveCount(0);
  });
});
