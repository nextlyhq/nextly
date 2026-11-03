/**
 * The Pages panel, in a browser: each way it moves between pages and changes
 * them. Another page opens from its row and stays open on reload; the title's
 * switcher opens a recent page and "All pages…" opens the panel; New page
 * opens a new draft; Duplicate opens the copy; Rename and Delete change the
 * list; and leaving a page with unsaved work asks first.
 *
 * @module tests/builder-pages.spec
 */
import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { block, clickBlock } from "./canvas/editor-driver";
import { gotoAdmin } from "./support/admin";
import { test } from "./support/test";

const ENTRIES = "/admin/api/collections/pages/entries";

const FIRST = "00000000-0000-4000-8000-00000000d001";
const SECOND = "00000000-0000-4000-8000-00000000d002";

/** Two headings, so one can be deleted and the page still has content. */
function content(): unknown {
  return {
    formatVersion: 1,
    kind: "page",
    nodes: [
      {
        id: FIRST,
        type: "core/heading",
        version: 1,
        props: { text: "First heading", level: "h2" },
      },
      {
        id: SECOND,
        type: "core/heading",
        version: 1,
        props: { text: "Second heading", level: "h2" },
      },
    ],
  };
}

async function createPage(
  request: APIRequestContext,
  title: string,
  status: "draft" | "published" = "draft"
): Promise<string> {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const created = await request.post(ENTRIES, {
    data: { title, slug: `pages-${stamp}`, status, content: content() },
  });
  expect(created.ok(), `creating a page: ${created.status()}`).toBe(true);
  return ((await created.json()) as { item: { id: string } }).item.id;
}

const builderUrl = (id: string) =>
  new RegExp(`/collections/pages/${id}/builder\\?field=content$`);

async function openBuilder(page: Page, id: string): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoAdmin(page, `/collections/pages/${id}/builder?field=content`);
  await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible({
    timeout: 60_000,
  });
}

function panel(page: Page) {
  return page.locator('div[aria-label="Pages"]');
}

/** Opens the Pages panel from the rail and narrows it to `search`. */
async function openPanel(page: Page, search: string): Promise<void> {
  // Only when it is not open already: the shell remembers the open panel
  // across pages, and a second press would close it.
  const item = page
    .getByRole("navigation", { name: "Editor panels" })
    .getByRole("button", { name: "Pages" });
  if ((await item.getAttribute("aria-pressed")) !== "true") await item.click();
  await expect(
    panel(page).getByRole("heading", { name: "Pages", level: 2 })
  ).toBeVisible();
  await panel(page).getByRole("textbox", { name: "Search pages" }).fill(search);
}

function row(page: Page, title: string) {
  return panel(page).getByRole("button", { name: title, exact: true });
}

async function choose(page: Page, title: string, action: string) {
  await panel(page)
    .getByRole("button", { name: `More for ${title}`, exact: true })
    .click();
  await page.getByRole("menuitem", { name: action }).click();
}

function switcher(page: Page, title: string) {
  return page.getByRole("button", { name: `${title}: switch page` });
}

test.describe("the Pages panel", () => {
  test.describe.configure({ timeout: 180_000 });

  test("opens another page, which stays open on reload", async ({ page }) => {
    const stamp = `Open ${Date.now()}`;
    const other = await createPage(page.request, `${stamp} other`);
    const id = await createPage(page.request, `${stamp} here`);
    await openBuilder(page, id);

    await openPanel(page, stamp);
    await expect(row(page, `${stamp} here`)).toHaveAttribute(
      "aria-current",
      "page"
    );
    await row(page, `${stamp} other`).click();
    await expect(page).toHaveURL(builderUrl(other));
    await expect(switcher(page, `${stamp} other`)).toBeVisible({
      timeout: 60_000,
    });

    await page.reload();
    await expect(page).toHaveURL(builderUrl(other));
    await expect(switcher(page, `${stamp} other`)).toBeVisible({
      timeout: 60_000,
    });
  });

  test("the title's switcher opens a recent page, and All pages… opens the panel", async ({
    page,
  }) => {
    const stamp = `Switch ${Date.now()}`;
    const first = await createPage(page.request, `${stamp} first`);
    const second = await createPage(page.request, `${stamp} second`);
    await openBuilder(page, first);
    await expect(switcher(page, `${stamp} first`)).toBeVisible();
    await openPanel(page, stamp);
    await row(page, `${stamp} second`).click();
    await expect(page).toHaveURL(builderUrl(second));

    await switcher(page, `${stamp} second`).click();
    await page.getByRole("menuitem", { name: `${stamp} first` }).click();
    await expect(page).toHaveURL(builderUrl(first));

    await switcher(page, `${stamp} first`).click();
    await page.getByRole("menuitem", { name: "All pages…" }).click();
    await expect(
      panel(page).getByRole("heading", { name: "Pages", level: 2 })
    ).toBeVisible();
    await expect(
      panel(page).getByRole("textbox", { name: "Search pages" })
    ).toBeVisible();
  });

  test("New page adds a draft and opens it", async ({ page }) => {
    const stamp = `New ${Date.now()}`;
    const id = await createPage(page.request, `${stamp} here`);
    await openBuilder(page, id);
    await openPanel(page, stamp);
    await expect(row(page, `${stamp} here`)).toBeVisible();

    await panel(page).getByRole("button", { name: "New page" }).click();
    await panel(page)
      .getByRole("textbox", { name: "Page title" })
      .fill(`${stamp} fresh`);
    await page.keyboard.press("Enter");

    await expect(page).not.toHaveURL(builderUrl(id));
    await expect(page).toHaveURL(/\/builder\?field=content$/);
    await expect(switcher(page, `${stamp} fresh`)).toBeVisible({
      timeout: 60_000,
    });
    await openPanel(page, `${stamp} fresh`);
    const fresh = panel(page)
      .getByRole("listitem")
      .filter({
        // Relative to the row, so the button is looked for inside it.
        has: page.getByRole("button", { name: `${stamp} fresh`, exact: true }),
      });
    await expect(fresh).toContainText("Draft");
    await expect(row(page, `${stamp} fresh`)).toHaveAttribute(
      "aria-current",
      "page"
    );
  });

  test("Duplicate copies a published page and opens the copy", async ({
    page,
  }) => {
    const stamp = `Duplicate ${Date.now()}`;
    const source = await createPage(
      page.request,
      `${stamp} source`,
      "published"
    );
    const id = await createPage(page.request, `${stamp} here`);
    await openBuilder(page, id);
    await openPanel(page, stamp);

    await choose(page, `${stamp} source`, "Duplicate");
    await expect(switcher(page, `Copy of ${stamp} source`)).toBeVisible({
      timeout: 60_000,
    });
    await expect(page).not.toHaveURL(builderUrl(id));
    await expect(page).not.toHaveURL(builderUrl(source));
    await expect(page).toHaveURL(/\/collections\/pages\/[^/]+\/builder/);
  });

  test("Rename changes another page's title in place", async ({ page }) => {
    const stamp = `Rename ${Date.now()}`;
    await createPage(page.request, `${stamp} before`);
    const id = await createPage(page.request, `${stamp} here`);
    await openBuilder(page, id);
    await openPanel(page, stamp);

    await choose(page, `${stamp} before`, "Rename");
    const field = panel(page).getByRole("textbox", { name: "Page title" });
    await expect(field).toBeVisible();
    await field.fill(`${stamp} after`);
    await field.press("Enter");

    await expect(row(page, `${stamp} after`)).toBeVisible();
    await expect(row(page, `${stamp} before`)).toHaveCount(0);
    await expect(page).toHaveURL(builderUrl(id));
  });

  test("Delete removes another page once confirmed", async ({ page }) => {
    const stamp = `Delete ${Date.now()}`;
    await createPage(page.request, `${stamp} doomed`);
    const id = await createPage(page.request, `${stamp} here`);
    await openBuilder(page, id);
    await openPanel(page, stamp);

    await choose(page, `${stamp} doomed`, "Delete…");
    const confirm = page.getByRole("alertdialog", {
      name: `Delete “${stamp} doomed”?`,
    });
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "Delete page" }).click();

    await expect(row(page, `${stamp} doomed`)).toHaveCount(0);
    await expect(row(page, `${stamp} here`)).toBeVisible();
    await expect(page).toHaveURL(builderUrl(id));
  });

  test("leaving a page with unsaved work asks first", async ({ page }) => {
    const stamp = `Unsaved ${Date.now()}`;
    const other = await createPage(page.request, `${stamp} other`);
    const id = await createPage(page.request, `${stamp} here`);
    await openBuilder(page, id);

    // An edit not yet saved: one heading deleted on the canvas, which is
    // drawn in its own frame.
    const second = await block(page, SECOND);
    await clickBlock(page, SECOND);
    await page.keyboard.press("Delete");
    await expect(second).toHaveCount(0);

    await openPanel(page, stamp);
    await row(page, `${stamp} other`).click();
    const question = page.getByRole("alertdialog", { name: "Unsaved Changes" });
    await expect(question).toBeVisible();
    await question.getByRole("button", { name: "Keep Editing" }).click();
    await expect(question).toBeHidden();
    await expect(page).toHaveURL(builderUrl(id));
    await expect(second).toHaveCount(0);

    await row(page, `${stamp} other`).click();
    await expect(question).toBeVisible();
    await question.getByRole("button", { name: "Discard Changes" }).click();
    await expect(page).toHaveURL(builderUrl(other));
    await expect(switcher(page, `${stamp} other`)).toBeVisible({
      timeout: 60_000,
    });
  });
});
