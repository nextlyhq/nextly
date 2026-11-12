/**
 * The SEO section's Overview in a browser, from the plugin as it ships: the
 * playground registers it for this suite's server (`NEXTLY_PLAYGROUND_PLUGINS=
 * seo`, set by `e2e/playwright.config.ts`).
 *
 * First-time setup ends on the Overview, and the SEO item in the rail opens
 * it afterwards; the setup checklist stays hidden across a reload once hidden
 * and comes back when shown; each severity count links to Problems narrowed
 * to it, and the Problems menu item's badge is the errors and warnings the
 * Overview counts; an address not found is offered as a redirect from that
 * address, and the redirect it opens is saved from it.
 */
import { expect, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { LOCK } from "./support/locks";
import { ok } from "./support/releases-api";
import { test } from "./support/test";

// The dashboard SEO spec counts the problem list before and after it writes
// its own pages, so the settings and pages written here must not land in
// between.
test.describe.configure({ lock: [LOCK.dashboard], mode: "serial" });

const API = "/admin/api";
const SEO_API = `${API}/plugins/@nextlyhq/plugin-seo`;
const SETTINGS_API = `${API}/singles/seo-settings`;
const SECTION = "/plugins/nextlyhq-plugin-seo";

/** A suffix that keeps this run's addresses apart from a retry's. */
const run = Date.now().toString(36);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
});

/** Saves `data` into the SEO settings, as a person with every permission. */
async function settle(page: Page, data: Record<string, unknown>) {
  await ok(
    await page.request.patch(SETTINGS_API, {
      data: { ...data, _overwrite: true },
    })
  );
}

/** The number on the Overview's line named `name` in the region `region`. */
async function countOn(page: Page, region: string, name: string) {
  const line = page
    .getByRole("region", { name: region })
    .getByRole("listitem")
    .filter({ hasText: name });
  await expect(line).toBeVisible();
  return Number((await line.innerText()).replace(/\D+/g, ""));
}

test("first-time setup ends on the Overview, which the SEO item opens after", async ({
  page,
}) => {
  await settle(page, { setupStep: 0, setupDismissed: false });

  // The first visit to the section is asked the three questions first.
  await gotoAdmin(page, `${SECTION}/overview`);
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "Set up SEO" })
  ).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`${SECTION}/settings$`));
  await dialog.getByLabel("Site name").fill("Playground");
  await dialog.getByRole("button", { name: "Next" }).click();
  await expect(
    dialog.getByRole("heading", { name: "What kind of site is this?" })
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Next" }).click();
  await dialog.getByRole("button", { name: "Finish" }).click();
  await expect(
    dialog.getByRole("heading", { name: "You're set up" })
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Go to the overview" }).click();

  await expect(page).toHaveURL(new RegExp(`${SECTION}/overview$`));
  await expect(
    page.getByRole("heading", { level: 1, name: "Overview" })
  ).toBeVisible();

  // Opened again from the rail, the section lands on its Overview.
  await gotoAdmin(page, "/");
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "SEO", exact: true })
    .first()
    .click();
  await expect(page).toHaveURL(new RegExp(`${SECTION}/overview$`));
  await expect(
    page.getByRole("region", { name: "Search health" })
  ).toBeVisible();
});

test("a hidden checklist stays hidden after a reload, until shown again", async ({
  page,
}) => {
  await settle(page, { setupStep: 3 });
  await gotoAdmin(page, `${SECTION}/overview`);
  const setup = page.getByRole("region", { name: "Set up SEO" });
  await expect(setup).toBeVisible();
  await expect(setup.getByText(/^\d+ of \d+ done$/)).toBeVisible();

  await setup.getByRole("button", { name: "Hide" }).click();
  await expect(setup).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("button", { name: /^Show setup · \d+ of \d+$/ })
  ).toBeVisible();
  await expect(page.getByRole("region", { name: "Set up SEO" })).toHaveCount(0);

  await page.getByRole("button", { name: /^Show setup · \d+ of \d+$/ }).click();
  await expect(page.getByRole("region", { name: "Set up SEO" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("region", { name: "Set up SEO" })).toBeVisible();
});

test("completing an item elsewhere marks it done on the Overview", async ({
  page,
}) => {
  await settle(page, { setupStep: 3, patterns: {} });
  await gotoAdmin(page, `${SECTION}/overview`);
  const patterns = page
    .getByRole("region", { name: "Set up SEO" })
    .getByRole("listitem")
    .filter({ hasText: /^Choose title patterns for/ });
  await expect(patterns).toHaveAttribute("data-status", "open");
  await expect(patterns.getByRole("link", { name: "Choose" })).toHaveAttribute(
    "href",
    /\/settings\?tab=types$/
  );

  // A pattern of its own for every type SEO is added to here.
  const own = { title: "{Title} | Playground" };
  await settle(page, {
    patterns: { "seo-pages": own, "seo-tags": own, "single:seo-home": own },
  });
  try {
    await page.reload();
    await expect(patterns).toHaveAttribute("data-status", "done");
    await expect(patterns.getByRole("link")).toHaveCount(0);
  } finally {
    await settle(page, { patterns: {} });
  }
});

test("each count links to Problems narrowed to it, and Problems' badge is the errors and warnings", async ({
  page,
}) => {
  await settle(page, { setupStep: 3 });
  // A page whose title is longer than Google shows: a notice.
  await ok(
    await page.request.post(`${API}/collections/seo-pages/entries`, {
      data: {
        title: `SEO overview ${run} ${"t".repeat(60)}`,
        slug: `seo-overview-${run}`,
      },
    })
  );
  await expect(async () => {
    await gotoAdmin(page, `${SECTION}/overview`);
    expect(await countOn(page, "Search health", "Notices")).toBeGreaterThan(0);
  }).toPass({ timeout: 20_000 });

  const errors = await countOn(page, "Search health", "Errors");
  const warnings = await countOn(page, "Search health", "Warnings");
  // The SEO panel's Problems item, its badge read with its name.
  const badge = page.getByRole("link", { name: /^Problems\b/ }).first();
  if (errors + warnings > 0) {
    await expect(badge).toContainText(String(errors + warnings));
  }

  for (const [name, severity] of [
    ["Errors", "error"],
    ["Warnings", "warning"],
    ["Notices", "notice"],
  ] as const) {
    await expect(
      page
        .getByRole("region", { name: "Search health" })
        .getByRole("link", { name, exact: true })
    ).toHaveAttribute("href", `/admin${SECTION}/problems?severity=${severity}`);
  }
  await page
    .getByRole("region", { name: "Search health" })
    .getByRole("link", { name: "Notices", exact: true })
    .click();
  await expect(page).toHaveURL(
    new RegExp(`${SECTION}/problems\\?severity=notice$`)
  );
  // Narrowed to notices, counted as the Overview counts them.
  await expect(
    page.getByRole("radio", { name: /^Notices \d+$/ })
  ).toHaveAttribute("aria-checked", "true");
  await expect(
    page.getByRole("heading", { level: 1, name: /Problems/ })
  ).toBeVisible();
});

test("an address not found is redirected from the Overview, the redirect saved from it", async ({
  page,
  baseURL,
}) => {
  await settle(page, { setupStep: 3 });
  const missing = `/seo-overview-gone-${run}`;
  // Asked for on the site, as a visitor would: the not-found page logs it.
  // Its status is the playground's to answer, so only the log is read.
  await page.request.get(`${baseURL}${missing}`);

  const card = page.getByRole("region", { name: "Not found, last 7 days" });
  await expect(async () => {
    await gotoAdmin(page, `${SECTION}/overview`);
    await expect(card.getByText(missing, { exact: true })).toBeVisible({
      timeout: 2_000,
    });
  }).toPass({ timeout: 20_000 });

  await card.getByRole("link", { name: `Redirect ${missing}` }).click();
  await expect(page).toHaveURL(new RegExp(`${SECTION}/redirects\\?from=`));
  const from = page.getByLabel("From");
  await expect(from).toHaveValue(missing);
  const to = page.getByLabel("To");
  if ((await to.inputValue()) === "") await to.fill("/");
  await page.getByRole("button", { name: /Add redirect/ }).click();

  await expect(async () => {
    const { items } = await ok<{ items: { from: string }[] }>(
      await page.request.get(`${SEO_API}/redirects`)
    );
    // Listed as visitors open it, in the playground's own language prefix.
    expect(items.some(item => item.from.endsWith(missing))).toBe(true);
  }).toPass({ timeout: 10_000 });
});

test("bulk edit stays at its address, and the old check address moves on to Pages", async ({
  page,
}) => {
  await settle(page, { setupStep: 3 });
  await gotoAdmin(page, `${SECTION}/bulk`);
  await expect(page).toHaveURL(new RegExp(`${SECTION}/bulk$`));
  await expect(
    page.getByRole("heading", { level: 1, name: /Bulk edit/ })
  ).toBeVisible();
  await gotoAdmin(page, `${SECTION}/received`);
  await expect(page).toHaveURL(new RegExp(`${SECTION}/pages$`));
});
