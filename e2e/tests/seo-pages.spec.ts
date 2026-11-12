/**
 * The SEO section's Pages and Inspect in a browser, from the plugin as it
 * ships: the playground registers it for this suite's server
 * (`NEXTLY_PLAYGROUND_PLUGINS=seo`, set by `e2e/playwright.config.ts`).
 *
 * Pages lists a published page with its title and status, finds it by
 * search, and opens Inspect from its row; Edit mode saves a title typed
 * straight into the list, which the page then holds as its own; the old
 * Bulk edit address opens Edit mode; Inspect shows what Nextly holds for the
 * page beside each crawler's result.
 */
import { expect, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { LOCK } from "./support/locks";
import { ok } from "./support/releases-api";
import { test } from "./support/test";

// The dashboard SEO spec counts the problem list before and after it writes
// its own pages, so the pages written here must not land in between.
test.describe.configure({ lock: [LOCK.dashboard], mode: "serial" });

const API = "/admin/api";
const SETTINGS_API = `${API}/singles/seo-settings`;
const SECTION = "/plugins/nextlyhq-plugin-seo";

/** A suffix that keeps this run's addresses apart from a retry's. */
const run = Date.now().toString(36);
const TITLE = `SEO pages ${run}`;
const SLUG = `seo-pages-${run}`;
const PATH = `/seo/${SLUG}`;

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  // Past first-time setup, so the section opens its screens directly.
  await ok(
    await page.request.patch(SETTINGS_API, {
      data: { setupStep: 3, _overwrite: true },
    })
  );
});

/** The id of this run's page, created once. */
let pageId: string | undefined;

/** This run's page, published at its address. */
async function ensurePage(page: Page): Promise<string> {
  if (pageId !== undefined) return pageId;
  const created = await ok<{ item: { id: string } }>(
    await page.request.post(`${API}/collections/seo-pages/entries`, {
      data: { title: TITLE, slug: SLUG, excerpt: "A page for the Pages spec." },
    })
  );
  pageId = String(created.item.id);
  return pageId;
}

/** This run's row in the list, once Pages has read it. */
async function rowOf(page: Page) {
  await gotoAdmin(page, `${SECTION}/pages`);
  await page.getByRole("searchbox").fill(SLUG);
  const row = page.getByRole("row").filter({ hasText: PATH });
  await expect(row).toBeVisible({ timeout: 15_000 });
  return row;
}

test("lists a page with its title and status, and inspects it from its row", async ({
  page,
}) => {
  await ensurePage(page);
  await gotoAdmin(page, `${SECTION}/pages`);
  await expect(
    page.getByRole("heading", { level: 1, name: "Pages" })
  ).toBeVisible();
  const row = await rowOf(page);
  await expect(row).toContainText(TITLE);
  await expect(row).toContainText(/Pattern: |Own value|Site default/);
  await expect(
    row.getByText(/^(Good|Error|Warning|Notice|Hidden)$/)
  ).toBeVisible();

  await row.getByRole("button", { name: "Row actions" }).click();
  await page
    .getByRole("menuitem", { name: "Inspect what search engines receive" })
    .click();
  await expect(page).toHaveURL(
    new RegExp(`${SECTION}/pages/inspect\\?address=`)
  );
  await expect(
    page.getByRole("heading", { level: 1, name: "What search engines receive" })
  ).toBeVisible();
  // What Nextly holds is shown whether or not the live page could be fetched.
  await expect(page.getByText("Head", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    page.getByText("Structured data", { exact: true })
  ).toBeVisible();
});

test("Edit mode saves a title typed into the list, which the page then holds", async ({
  page,
}) => {
  const id = await ensurePage(page);
  await rowOf(page);
  await page
    .getByRole("radio", { name: "Edit titles and descriptions" })
    .click();
  const box = page.getByLabel(`Title for ${TITLE}`);
  await expect(box).toBeEditable({ timeout: 15_000 });
  const typed = `Typed in the list ${run}`;
  await box.fill(typed);
  await expect(
    page.getByRole("status").filter({ hasText: "1 page changed" })
  ).toBeVisible();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved 1 page.")).toBeVisible();

  await expect(async () => {
    // A single entry is answered as the bare document.
    const entry = await ok<{ seo?: { metaTitle?: string } }>(
      await page.request.get(`${API}/collections/seo-pages/entries/${id}`)
    );
    expect(entry.seo?.metaTitle).toBe(typed);
  }).toPass({ timeout: 10_000 });

  await page.getByRole("radio", { name: "View" }).click();
  const row = page.getByRole("row").filter({ hasText: PATH });
  await expect(async () => {
    await page.reload();
    await page.getByRole("searchbox").fill(SLUG);
    await expect(row).toContainText(typed, { timeout: 2_000 });
  }).toPass({ timeout: 15_000 });
  await expect(row).toContainText("Own value");
});

test("the old Bulk edit address opens Edit mode, and the old check address Pages", async ({
  page,
}) => {
  await gotoAdmin(page, `${SECTION}/bulk`);
  await expect(page).toHaveURL(new RegExp(`${SECTION}/pages\\?mode=edit$`));
  await expect(
    page.getByRole("radio", { name: "Edit titles and descriptions" })
  ).toHaveAttribute("aria-checked", "true");
  await gotoAdmin(page, `${SECTION}/received`);
  await expect(page).toHaveURL(new RegExp(`${SECTION}/pages$`));
});
