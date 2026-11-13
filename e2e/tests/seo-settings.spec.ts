/**
 * The SEO section's Settings in a browser, from the plugin as it ships: the
 * playground registers it for this suite's server (`NEXTLY_PLAYGROUND_PLUGINS=
 * seo`, set by `e2e/playwright.config.ts`).
 *
 * Each tab has an address of its own, a change typed on one tab survives a
 * move to another and is saved from either, Cancel lets go of what was typed,
 * and a saved value is there after a reload.
 */
import { expect, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { LOCK } from "./support/locks";
import { ok } from "./support/releases-api";
import { test } from "./support/test";

// The Overview and dashboard SEO specs read the same settings.
test.describe.configure({ lock: [LOCK.dashboard], mode: "serial" });

const SETTINGS_API = "/admin/api/singles/seo-settings";
const SETTINGS = "/plugins/nextlyhq-plugin-seo/settings";

/** A suffix that keeps this run's values apart from a retry's. */
const run = Date.now().toString(36);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  // Setup answered, so the screen opens without its first-time questions.
  await ok(
    await page.request.patch(SETTINGS_API, {
      data: { setupStep: 3, setupDismissed: true, _overwrite: true },
    })
  );
});

const tab = (page: Page, name: string | RegExp) =>
  page.getByRole("navigation", { name: "Settings" }).getByRole("link", {
    name,
  });

test("each tab has its own address, and a change made on one is saved from another", async ({
  page,
}) => {
  await gotoAdmin(page, SETTINGS);
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(tab(page, "General")).toHaveAttribute("aria-current", "page");

  const name = `Playground ${run}`;
  await page.getByLabel("Site name").fill(name);
  await expect(page.getByText("You have unsaved changes")).toBeVisible();

  await tab(page, /Content types/).click();
  await expect(page).toHaveURL(/\?tab=types$/);
  await expect(tab(page, /Content types/)).toHaveAttribute(
    "aria-current",
    "page"
  );
  // Still unsaved, and saved from this tab with the rest.
  await expect(page.getByText("You have unsaved changes")).toBeVisible();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("You have unsaved changes")).toBeHidden();

  await page.reload();
  await tab(page, "General").click();
  await expect(page.getByLabel("Site name")).toHaveValue(name);
});

test("Cancel lets go of what was typed", async ({ page }) => {
  await gotoAdmin(page, `${SETTINGS}?tab=general`);
  const field = page.getByLabel("Site name");
  const before = await field.inputValue();
  await field.fill(`Not kept ${run}`);
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(field).toHaveValue(before);
  await expect(
    page.getByRole("button", { name: "Save changes" })
  ).toBeDisabled();
});

test("a link lands on the tab it names", async ({ page }) => {
  await gotoAdmin(page, `${SETTINGS}?tab=crawlers`);
  await expect(tab(page, "Search engines and AI")).toHaveAttribute(
    "aria-current",
    "page"
  );
  await expect(page.getByRole("switch", { name: "llms.txt" })).toBeVisible();
});
