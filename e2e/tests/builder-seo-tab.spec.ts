/**
 * The builder's SEO tab is the SEO plugin's own, shown exactly where the
 * page's edit page shows its SEO tab. The playground runs the SEO plugin as
 * the founder's configuration does: it names its own types and leaves the
 * Page Builder's Pages out. So a Page has no SEO tab in either place, and
 * Page settings and the right panel say SEO is turned off for Pages, with
 * the way to the SEO settings. An SEO page, which the plugin edits and which
 * the builder can open, has the tab in both: what is typed in the builder's
 * is on the entry page's, unsaved, and one Save stores it.
 *
 * @module tests/builder-seo-tab.spec
 */
import { expect, type Page } from "@playwright/test";

import { clearSelection } from "./canvas/editor-driver";
import { gotoAdmin } from "./support/admin";
import { LOCK } from "./support/locks";
import { createEntry } from "./support/runtime-collection";
import { test } from "./support/test";

// The dashboard SEO spec counts the SEO pages before and after it writes its
// own, so a page written here must not land in between.
test.describe.configure({ lock: [LOCK.dashboard], timeout: 180_000 });

const RUN = Date.now().toString(36);

const canvas = (page: Page) => page.getByRole("region", { name: "Canvas" });
const settingsDialog = (page: Page) =>
  page.getByRole("dialog", { name: /^Page settings · / });
const seoTab = (scope: Page | ReturnType<typeof settingsDialog>) =>
  scope.getByRole("tab", { name: /^SEO\b/ });
const pagePanel = (page: Page) =>
  page
    .getByRole("complementary", { name: "Inspector" })
    .getByRole("region", { name: "Page settings" });

async function openBuilder(page: Page, path: string): Promise<void> {
  await gotoAdmin(page, path);
  await expect(canvas(page)).toBeVisible({ timeout: 60_000 });
}

async function openPageSettings(page: Page): Promise<void> {
  await page
    .getByRole("navigation", { name: "Editor panels" })
    .getByRole("button", { name: "Settings" })
    .click();
  await expect(settingsDialog(page)).toBeVisible();
}

test("a page whose type the SEO plugin leaves out has no SEO tab in either place, and says SEO is turned off", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const id = await createEntry(page.request, "pages", {
    title: `No SEO here ${RUN}`,
    slug: `no-seo-here-${RUN}`,
    content: { formatVersion: 1, kind: "page", nodes: [] },
  });

  // The entry page draws no SEO tab for Pages.
  await gotoAdmin(page, `/collections/pages/${id}`);
  await expect(page.getByTestId("document-bar")).toBeVisible();
  await expect(seoTab(page)).toHaveCount(0);

  // Nor does the builder: General says so, once, with the way to the
  // settings for someone who may change them, and no preview of its own.
  await openBuilder(page, `/collections/pages/${id}/builder?field=content`);
  await openPageSettings(page);
  const dialog = settingsDialog(page);
  await expect(dialog.getByRole("tab", { name: "General" })).toBeVisible();
  await expect(seoTab(dialog)).toHaveCount(0);
  await expect(dialog.getByText("SEO is turned off for Pages.")).toBeVisible();
  await expect(
    dialog.getByRole("link", { name: "SEO settings" })
  ).toHaveAttribute(
    "href",
    "/admin/plugins/nextlyhq-plugin-seo/settings?tab=types"
  );
  await expect(
    dialog.getByRole("figure", { name: "Share preview" })
  ).toHaveCount(0);
  await expect(dialog.getByText(/The SEO plugin (adds|lets)/)).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  // The right panel's page settings say the same.
  await clearSelection(page);
  await expect(
    pagePanel(page).getByText("SEO is turned off for Pages.")
  ).toBeVisible();
});

test("where the SEO plugin edits the page's type, the builder's SEO tab is the entry page's: typed there, found unsaved on the form, saved once", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const id = await createEntry(page.request, "seo-pages", {
    title: `Built and found ${RUN}`,
    slug: `built-and-found-${RUN}`,
    excerpt: "An excerpt the description falls back to.",
  });
  const typed = `Typed in the builder ${RUN}`;

  await openBuilder(page, `/collections/seo-pages/${id}/builder?field=body`);
  await openPageSettings(page);
  const dialog = settingsDialog(page);
  // One SEO panel: the tab, and no second preview or "missing" line on
  // General.
  await expect(dialog.getByRole("tab", { name: "General" })).toHaveAttribute(
    "aria-selected",
    "true"
  );
  await expect(
    dialog.getByRole("figure", { name: "Share preview" })
  ).toHaveCount(0);
  await expect(
    dialog.getByText(/SEO is turned off|The SEO plugin (adds|lets)/)
  ).toHaveCount(0);
  await seoTab(dialog).click();
  await dialog.getByLabel("Title on Google").fill(typed);
  await expect(dialog.getByTestId("seo-search-title")).toHaveText(typed);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  // The right panel's search result is the tab's own answer.
  await clearSelection(page);
  await expect(pagePanel(page).getByTestId("seo-search-title")).toHaveText(
    typed
  );

  // On the form, the entry page's SEO tab holds what was typed, unsaved.
  await openPageSettings(page);
  await settingsDialog(page)
    .getByRole("button", { name: "Open as form" })
    .click();
  await expect(page).toHaveURL(
    new RegExp(`/admin/collections/seo-pages/${id}(\\?.*)?$`)
  );
  await expect(
    page.getByTestId("document-bar").getByText("Unsaved changes")
  ).toBeVisible();
  await seoTab(page).click();
  await expect(page.getByLabel("Title on Google")).toHaveValue(typed);

  // One Save stores it.
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect
    .poll(async () => {
      const read = await page.request.get(
        `/admin/api/collections/seo-pages/entries/${id}?depth=0`
      );
      const item = (await read.json()) as {
        seo?: { metaTitle?: unknown } | null;
      };
      return item.seo?.metaTitle;
    })
    .toBe(typed);
});
