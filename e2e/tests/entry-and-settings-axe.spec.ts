/**
 * The entry and settings screens against axe's WCAG 2.2 AA scan, in light
 * and in dark: the New page dialog; Page settings, each of its tabs (General,
 * Fields, SEO, Code, the Code tab with the page's own CSS box); Site settings
 * → Code with the site's CSS box open; a post's entry header (its document bar and address
 * chip) and Details; a Single's side panel (what it is, Last changed, "Shown
 * on (from the builder)", For developers); and the dashboard's Continue card
 * with its Pinned and Recent groups. And the polite announcements of copying
 * an address and of a pin, which a screen reader says without interrupting.
 *
 * @module tests/entry-and-settings-axe.spec
 */
import { expect, type Locator, type Page } from "@playwright/test";

import { gotoAdmin, type Theme } from "./support/admin";
import { expectNoAxeViolations } from "./support/axe";
import { LOCK } from "./support/locks";
import { createEntry } from "./support/runtime-collection";
import { test } from "./support/test";

// The Single panel opens the Homepage, whose form claims it; the Continue
// card reads the file's own dashboard, and the dashboard's SEO card counts
// the SEO pages this file writes. Site settings → Code reads the site's code,
// which another spec stores and clears.
test.describe.configure({
  lock: [LOCK.homepage, LOCK.dashboard, LOCK.siteCode],
});

const RUN = Date.now().toString(36);
const PINS = "/admin/api/dashboard/pins";
const THEMES: readonly Theme[] = ["light", "dark"];

/** A draft page of this run, holding one heading. */
function seedPage(page: Page, name: string): Promise<string> {
  const stamp = `${RUN}-${Math.random().toString(36).slice(2, 8)}`;
  return createEntry(page.request, "pages", {
    title: `${name} ${stamp}`,
    slug: `${name.toLowerCase().replaceAll(" ", "-")}-${stamp}`,
    status: "draft",
    content: {
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "00000000-0000-4000-8000-00000000f201",
          type: "core/heading",
          version: 1,
          props: { text: "Checked by axe", level: "h2" },
        },
      ],
    },
  });
}

/** A post of this run; its id. */
function seedPost(page: Page, name: string): Promise<string> {
  const stamp = `${RUN}-${Math.random().toString(36).slice(2, 8)}`;
  return createEntry(page.request, "posts", {
    title: `${name} ${stamp}`,
    slug: `${name.toLowerCase().replaceAll(" ", "-")}-${stamp}`,
    status: "draft",
  });
}

/**
 * A message saying `text` inside a polite live region, as a screen reader
 * hears it: the toast itself, since the region around it draws no box.
 */
function saidPolitely(page: Page, text: string): Locator {
  return page
    .locator('[aria-live="polite"] [data-sonner-toast]')
    .filter({ hasText: text });
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
});

for (const theme of THEMES) {
  test(`the New page dialog (${theme})`, async ({ page }) => {
    await gotoAdmin(page, "/collections/pages", theme);
    await page.getByRole("button", { name: /^New / }).click();
    const dialog = page.getByRole("dialog", { name: "New page" });
    await expect(
      dialog.getByRole("combobox", { name: "Header & footer" })
    ).toBeEnabled();
    await dialog.getByRole("textbox", { name: "Title" }).fill(`Axe ${RUN}`);
    await expectNoAxeViolations(page, { include: '[role="dialog"]' });
  });

  test(`Page settings, each tab (${theme})`, async ({ page }) => {
    // A page has General, Fields and Code. The playground's SEO plugin leaves
    // Pages out and edits its own SEO pages, so the SEO tab is met on one.
    const pageId = await seedPage(page, "Axe settings");
    const seoId = await createEntry(page.request, "seo-pages", {
      title: `Axe search ${theme} ${RUN}`,
      // One per theme, so the two runs of this test never share an address.
      slug: `axe-search-${theme}-${RUN}`,
      excerpt: "Checked by axe.",
    });
    const visits: Array<[string, readonly (string | RegExp)[]]> = [
      [
        `/collections/pages/${pageId}/builder?field=content`,
        ["General", "Fields", "Code"],
      ],
      [`/collections/seo-pages/${seoId}/builder?field=body`, [/^SEO\b/]],
    ];
    for (const [path, tabs] of visits) {
      await gotoAdmin(page, path, theme);
      await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible({
        timeout: 60_000,
      });
      await page
        .getByRole("navigation", { name: "Editor panels" })
        .getByRole("button", { name: "Settings" })
        .click();
      const dialog = page.getByRole("dialog", { name: /^Page settings · / });
      await expect(dialog).toBeVisible();
      for (const name of tabs) {
        const tab =
          typeof name === "string"
            ? dialog.getByRole("tab", { name, exact: true })
            : dialog.getByRole("tab", { name });
        await tab.click();
        await expect(tab).toHaveAttribute("aria-selected", "true");
        await expect(dialog.getByRole("tabpanel")).toBeVisible();
        // The Code tab holds the page's own CSS box, above its code.
        if (name === "Code") {
          await expect(
            dialog.getByText(
              "CSS for this page only. Site-wide CSS lives in Site settings."
            )
          ).toBeVisible();
        }
        // The whole page: the builder draws Page settings where a scan
        // scoped by selector measures none of it.
        await expectNoAxeViolations(page);
      }
    }
  });

  test(`Site settings → Code, with the site's CSS box open (${theme})`, async ({
    page,
  }) => {
    const id = await seedPage(page, "Axe site css");
    await gotoAdmin(
      page,
      `/collections/pages/${id}/builder?field=content`,
      theme
    );
    await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible({
      timeout: 60_000,
    });
    await page
      .getByRole("navigation", { name: "Editor panels" })
      .getByRole("button", { name: "Settings" })
      .click();
    await page
      .getByRole("dialog", { name: /^Page settings · / })
      .getByRole("button", { name: "Site settings" })
      .click();
    const site = page.getByRole("dialog", { name: "Site settings" });
    const code = site.getByRole("region", { name: "Code" });
    // "Add code" on a site with none, "Edit code" once it has some. Opening
    // the editor saves nothing.
    await code.getByRole("button", { name: /^(Add|Edit) code$/ }).click();
    await expect(
      code.getByText(/^CSS for every page of the site\. Write plain CSS; no/)
    ).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test(`a post's entry header and Details (${theme})`, async ({ page }) => {
    const id = await seedPost(page, "Axe header");
    await gotoAdmin(page, `/collections/posts/${id}`, theme);
    await expect(page.getByTestId("document-address")).toContainText(
      "axe-header",
      { timeout: 30_000 }
    );
    await expectNoAxeViolations(page, {
      include: '[data-testid="document-bar"]',
    });
    await expectNoAxeViolations(page, {
      include: '[data-testid="document-address"]',
    });
    await expectNoAxeViolations(page, {
      include: '[data-testid="document-panel-sections"]',
    });
  });

  test(`a Single's side panel (${theme})`, async ({ page }) => {
    await gotoAdmin(page, "/singles/homepage", theme);
    await expect(page.getByRole("textbox", { name: "Title" })).toBeVisible({
      timeout: 60_000,
    });
    const toggle = page.getByRole("button", { name: "Show document panel" });
    if (await toggle.isVisible()) await toggle.click();
    const panel = page.getByTestId("document-panel-sections");
    await expect(
      panel.getByRole("region", { name: "Shown on (from the builder)" })
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      panel.getByRole("region", { name: "For developers" })
    ).toBeVisible();
    await expectNoAxeViolations(page, {
      include: '[data-testid="document-panel-sections"]',
    });
  });

  test(`the Continue card, Pinned and Recent (${theme})`, async ({ page }) => {
    const pinnedId = await seedPost(page, "Axe pinned");
    await seedPost(page, "Axe recent");
    const pin = {
      targetType: "collection",
      targetSlug: "posts",
      entryId: pinnedId,
    };
    const made = await page.request.post(PINS, { data: pin });
    expect(made.ok(), await made.text()).toBe(true);
    try {
      await gotoAdmin(page, "", theme);
      const card = page.getByTestId("widget-cell-core/continue");
      await expect(card.getByRole("group", { name: "Pinned" })).toBeVisible();
      await expect(card.getByRole("group", { name: "Recent" })).toBeVisible();
      await expectNoAxeViolations(page, {
        include: '[data-testid="widget-cell-core/continue"]',
      });
    } finally {
      // So the file's account keeps no pin another test would meet.
      const removed = await page.request.delete(PINS, { data: pin });
      expect(
        removed.ok() || removed.status() === 404,
        await removed.text()
      ).toBe(true);
    }
  });
}

test("copying an address and pinning are said politely", async ({
  page,
  context,
}) => {
  const id = await seedPost(page, "Axe said");
  await gotoAdmin(page, `/collections/posts/${id}`);
  const chip = page.getByTestId("document-address");
  await expect(chip).toContainText("axe-said", { timeout: 30_000 });

  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await chip.getByRole("button", { name: /^Copy address/ }).click();
  await expect(saidPolitely(page, "Address copied")).toBeVisible();

  const pin = { targetType: "collection", targetSlug: "posts", entryId: id };
  try {
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Pin to dashboard" }).click();
    await expect(saidPolitely(page, "Pinned to your dashboard.")).toBeVisible();
  } finally {
    const removed = await page.request.delete(PINS, { data: pin });
    expect(removed.ok() || removed.status() === 404, await removed.text()).toBe(
      true
    );
  }
});
