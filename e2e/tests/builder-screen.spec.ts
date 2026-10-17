/**
 * The Page Builder as a screen of its own: its address, a reload, the way back
 * to the document's form, and recovering work after a reload without saving.
 *
 * Driven through the playground's homepage Single, whose `layout` field is a
 * blocks field, and the field's card — the way an author arrives.
 *
 * @module tests/builder-screen
 */
import { expect, test, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";

const OPEN_BUILDER_ACTION = /^(?:Build this page|Open Page Builder)$/;
const HOMEPAGE_API = "/admin/api/singles/homepage";
const BUILDER_URL = /\/admin\/singles\/homepage\/builder\?field=layout$/;

function heading(id: string, text: string) {
  return { id, type: "core/heading", version: 1, props: { text, level: "h2" } };
}

async function seed(page: Page, nodes: unknown[]): Promise<void> {
  const stored = await page.request.patch(HOMEPAGE_API, {
    data: { layout: { formatVersion: 1, kind: "page", nodes } },
  });
  expect(stored.ok(), `seeding the homepage layout: ${stored.status()}`).toBe(
    true
  );
}

function block(page: Page, id: string) {
  return page.locator(`.nx-canvas [data-nx-node="${id}"]`).first();
}

async function openBuilder(page: Page): Promise<void> {
  await gotoAdmin(page, "/singles/homepage");
  await page.getByRole("link", { name: OPEN_BUILDER_ACTION }).click();
  await expect(page).toHaveURL(BUILDER_URL);
}

test.describe("the Page Builder's own screen", () => {
  test("opens at its own address, and a reload keeps it there", async ({
    page,
  }) => {
    await seed(page, [heading("kept", "A heading that survives a reload")]);
    await openBuilder(page);
    await expect(block(page, "kept")).toBeVisible({ timeout: 30_000 });

    await page.reload();

    await expect(page).toHaveURL(BUILDER_URL);
    await expect(block(page, "kept")).toBeVisible({ timeout: 30_000 });
  });

  test("goes back to the document's form on exit", async ({ page }) => {
    await seed(page, [heading("h", "Back to the form")]);
    await openBuilder(page);
    await expect(block(page, "h")).toBeVisible({ timeout: 30_000 });

    await page.getByRole("button", { name: "Exit editor" }).click();

    await expect(page).toHaveURL(/\/admin\/singles\/homepage$/);
    await expect(
      page.getByRole("link", { name: OPEN_BUILDER_ACTION })
    ).toBeVisible();
  });

  test("asks before Back leaves with unsaved work, and Keep Editing stays", async ({
    page,
  }) => {
    await seed(page, [heading("stays", "Stays"), heading("goes", "Goes")]);
    // Arrived by a click from the document's form, so Back has somewhere in
    // the admin to go, and the page has the author's own activation as a real
    // author's would.
    await openBuilder(page);
    await expect(block(page, "goes")).toBeVisible({ timeout: 30_000 });
    await block(page, "goes").click();
    await page.keyboard.press("Delete");
    await expect(block(page, "goes")).toHaveCount(0);

    await page.goBack();

    // Asked, not gone: the unsaved removal would otherwise be lost silently.
    const question = page.getByRole("alertdialog");
    await expect(question).toBeVisible();
    await question.getByRole("button", { name: "Keep Editing" }).click();

    await expect(page).toHaveURL(BUILDER_URL);
    await expect(block(page, "goes")).toHaveCount(0);
    await expect(block(page, "stays")).toBeVisible();
  });

  test("offers work left unsaved by a reload, and restores it", async ({
    page,
  }) => {
    await seed(page, [heading("stays", "Stays"), heading("goes", "Goes")]);
    await openBuilder(page);
    await expect(block(page, "goes")).toBeVisible({ timeout: 30_000 });

    // One edit, recorded as this author's recovery point: the editor writes
    // it through the versions API a moment after the document changes.
    const recorded = page.waitForRequest(
      request =>
        request.method() === "PUT" &&
        new URL(request.url()).pathname.endsWith("/autosave")
    );
    await block(page, "goes").click();
    await page.keyboard.press("Delete");
    await expect(block(page, "goes")).toHaveCount(0);
    await recorded;

    // Reloaded without saving: the stored page still holds both blocks, and
    // the screen offers the work the reload would otherwise have lost.
    await page.reload();
    await expect(block(page, "goes")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/You have unsaved changes from/)).toBeVisible();

    await page.getByRole("button", { name: "Restore", exact: true }).click();

    await expect(block(page, "goes")).toHaveCount(0);
    await expect(block(page, "stays")).toBeVisible();
  });
});
