/**
 * The SEO section's Problems screen in a browser, from the plugin as it
 * ships: the playground registers it for this suite's server
 * (`NEXTLY_PLAYGROUND_PLUGINS=seo`, set by `e2e/playwright.config.ts`).
 *
 * A page whose title is longer than Google shows is listed on the notices'
 * row, which opens on that page with its fix; the fix opens the page's
 * editor on its SEO tab; and the severity filter shows one severity's rows,
 * each with the count the Overview shows.
 */
import { expect, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { LOCK } from "./support/locks";
import { ok } from "./support/releases-api";
import { test } from "./support/test";

// The dashboard SEO spec counts the problem list before and after it writes
// its own pages, so the page written here must not land in between.
test.describe.configure({ lock: [LOCK.dashboard], mode: "serial" });

const API = "/admin/api";
const SECTION = "/plugins/nextlyhq-plugin-seo";
const SETTINGS_API = `${API}/singles/seo-settings`;

/** A suffix that keeps this run's addresses apart from a retry's. */
const run = Date.now().toString(36);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  // Past first-time setup, so the section opens on its screens.
  await ok(
    await page.request.patch(SETTINGS_API, {
      data: { setupStep: 3, _overwrite: true },
    })
  );
});

/** The table's row for the kind of problem titled `title`. */
function rowOf(page: Page, title: string) {
  return page.getByRole("table").getByRole("row").filter({ hasText: title });
}

test("a long title is listed with its page, and its fix opens the page's SEO tab", async ({
  page,
}) => {
  const title = `SEO problems ${run} ${"t".repeat(60)}`;
  const { item } = await ok<{ item: { id: string } }>(
    await page.request.post(`${API}/collections/seo-pages/entries`, {
      data: { title, slug: `seo-problems-${run}` },
    })
  );

  const row = rowOf(page, "Title longer than Google shows");
  await expect(async () => {
    await gotoAdmin(page, `${SECTION}/problems`);
    await expect(row).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  await expect(row.getByText("Notice", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 1, name: "Problems" })
  ).toBeVisible();

  // Opened, the row names each page, this one among them in each of the
  // playground's languages, each with its fix; the default language's fix
  // opens the editor with no language named.
  await row.getByRole("button", { expanded: false }).first().click();
  const pages = page
    .getByRole("table")
    .getByRole("region", { name: /Title longer than Google shows/ });
  await expect(
    pages.getByRole("listitem").filter({ hasText: title }).first()
  ).toBeVisible();
  const fix = pages.locator(
    `a[href="/admin/collections/seo-pages/${item.id}?tab=nextlyhq-plugin-seo.tab"]`
  );
  await expect(fix).toHaveText("Shorten the title");
  await fix.click();
  await expect(page).toHaveURL(
    new RegExp(`/admin/collections/seo-pages/${item.id}\\?tab=`)
  );
});

test("the severity filter shows one severity's rows, with every count kept", async ({
  page,
}) => {
  await gotoAdmin(page, `${SECTION}/problems`);
  const filter = page.getByRole("radiogroup", { name: "Show problems" });
  await expect(
    filter.getByRole("radio", { name: /^All \d+$/ })
  ).toHaveAttribute("aria-checked", "true");

  await filter.getByRole("radio", { name: /^Notices \d+$/ }).click();
  const rows = page
    .getByRole("table")
    .getByRole("row")
    .filter({
      has: page.getByRole("cell"),
    });
  // Every row shown is a notice, and the other severities keep their counts.
  for (const severity of ["Error", "Warning"]) {
    await expect(rows.getByText(severity, { exact: true })).toHaveCount(0);
  }
  await expect(
    filter.getByRole("radio", { name: /^Errors \d+$/ })
  ).toBeVisible();

  // Opened from the Overview's count, the same severity is chosen.
  await gotoAdmin(page, `${SECTION}/problems?severity=warning`);
  await expect(
    filter.getByRole("radio", { name: /^Warnings \d+$/ })
  ).toHaveAttribute("aria-checked", "true");
});
