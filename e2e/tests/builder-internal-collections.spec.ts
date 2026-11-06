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
import { expect, type Locator } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { test } from "./support/test";

/** The builder's internal collections, by the slug prefix they share. */
const INTERNAL = "nx_pb_";

/** Every link target inside `scope`, read from the document. */
async function linkTargets(scope: Locator): Promise<string[]> {
  return scope
    .locator("a[href]")
    .evaluateAll(links => links.map(link => link.getAttribute("href") ?? ""));
}

test.describe("the page builder's internal collections", () => {
  test("have no link in the admin's navigation", async ({ page }) => {
    await gotoAdmin(page, "/collections/pages");
    // The sidebars list the collections after they mount, so they are
    // scanned once they list an authored one: the control that they drew.
    const sidebars = page.getByRole("complementary");
    await expect(
      sidebars.getByRole("link", { name: "Pages", exact: true })
    ).toBeVisible();

    const targets = await linkTargets(sidebars);
    expect(targets.filter(target => target.includes(INTERNAL))).toEqual([]);
  });

  test("have no link or name on the dashboard", async ({ page }) => {
    await gotoAdmin(page, "/");
    // The dashboard says it is loading until its cards arrive, and is
    // scanned once a card has drawn: the control that there is a dashboard.
    const dashboard = page.locator("main");
    await expect(
      dashboard.locator('[data-testid="widget-grid-loading"]')
    ).toHaveCount(0);
    await expect(
      dashboard.locator('[data-testid="widget-card-header"]').first()
    ).toBeVisible();

    const targets = await linkTargets(dashboard);
    expect(targets.filter(target => target.includes(INTERNAL))).toEqual([]);
    await expect(
      dashboard.getByText(/usage backfill|class usage|component usage/i)
    ).toHaveCount(0);
  });
});
