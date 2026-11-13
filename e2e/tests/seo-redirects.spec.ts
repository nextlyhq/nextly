/**
 * The SEO section's Redirects screen in a browser, from the plugin as it
 * ships: the playground registers it for this suite's server
 * (`NEXTLY_PLAYGROUND_PLUGINS=seo`, set by `e2e/playwright.config.ts`), and
 * its Proxy answers the site's requests.
 *
 * A redirect added in its dialog is listed as made by You and answered with
 * a 301, and its hits are counted; an address made Gone answers 410 with no
 * To address; an address not found is listed with where its visitor came
 * from, and Ignore sets it aside until Show ignored lists it again.
 */
import { expect, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { LOCK } from "./support/locks";
import { ok } from "./support/releases-api";
import { test } from "./support/test";

// The dashboard SEO spec counts the problem list, which a redirect saved
// here can change, so the two do not run at once.
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

/** The Redirects table's row holding `text`. */
function rowWith(page: Page, text: string) {
  return page.getByRole("table").getByRole("row").filter({ hasText: text });
}

/** Adds a redirect through the screen's dialog. */
async function add(
  page: Page,
  from: string,
  to: string | undefined,
  type?: string
) {
  await page.getByRole("button", { name: "Add redirect" }).click();
  const dialog = page.getByRole("dialog", { name: "Add redirect" });
  await dialog.getByLabel("From").fill(from);
  if (type !== undefined) {
    await dialog.getByRole("combobox", { name: "Type" }).click();
    await page.getByRole("option", { name: type }).click();
  }
  if (to !== undefined) await dialog.getByLabel("To").fill(to);
  await dialog.getByRole("button", { name: "Add redirect" }).click();
  await expect(dialog).toHaveCount(0);
}

test("a redirect added in its dialog answers 301, is yours, and counts its hits", async ({
  page,
  baseURL,
}) => {
  const from = `/seo-redirects-old-${run}`;
  await gotoAdmin(page, `${SECTION}/redirects`);
  await expect(
    page.getByRole("heading", { level: 1, name: "Redirects" })
  ).toBeVisible();
  await add(page, from, "/");

  const row = rowWith(page, from);
  await expect(row).toBeVisible();
  await expect(row.getByText("301", { exact: true })).toBeVisible();
  await expect(row.getByText("You", { exact: true })).toBeVisible();

  // A visitor asking for the old address is sent on, and counted.
  const answer = await page.request.get(`${baseURL}${from}`, {
    maxRedirects: 0,
  });
  expect(answer.status()).toBe(301);
  await expect(async () => {
    await page.reload();
    await expect(row.getByRole("cell").nth(4)).toHaveText("1", {
      timeout: 2_000,
    });
  }).toPass({ timeout: 20_000 });
});

test("an address made Gone answers 410, and asks for no To", async ({
  page,
  baseURL,
}) => {
  const from = `/seo-redirects-retired-${run}`;
  await gotoAdmin(page, `${SECTION}/redirects`);
  await add(page, from, undefined, "Gone (410)");
  await expect(rowWith(page, from).getByText("410 Gone")).toBeVisible();

  const answer = await page.request.get(`${baseURL}${from}`, {
    maxRedirects: 0,
  });
  expect(answer.status()).toBe(410);
});

test("an address not found shows where its visitor came from, and Ignore sets it aside", async ({
  page,
  baseURL,
}) => {
  const missing = `/seo-redirects-missing-${run}`;
  await page.request.get(`${baseURL}${missing}`, {
    headers: { referer: "https://news.example.org/story?id=7" },
  });

  const row = rowWith(page, missing);
  await expect(async () => {
    await gotoAdmin(page, `${SECTION}/redirects?tab=notfound`);
    await expect(row).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  await expect(row.getByText("news.example.org")).toBeVisible();
  await expect(
    page.getByRole("link", { name: /^Not found \d+$/ })
  ).toHaveAttribute("aria-current", "page");

  await row.getByRole("button", { name: `Ignore ${missing}` }).click();
  await expect(row).toHaveCount(0);
  await page.getByRole("checkbox", { name: "Show ignored" }).click();
  await expect(
    row.getByRole("button", { name: `Show again ${missing}` })
  ).toBeVisible();
});
