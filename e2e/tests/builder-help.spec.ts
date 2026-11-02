/**
 * The editor's rail and its Help, in a browser.
 *
 * The unit suites read the rail's text and the dialog's list from jsdom; what
 * they cannot see is that the labels are VISIBLE at the rail's real width,
 * that the keyboard reaching Help is the one the editor actually has, and that
 * a documentation link opens on its own without taking the editor away.
 *
 * The documentation site is stubbed: CI runs offline, and what is under test is
 * where the link goes, not what the site says.
 *
 * @module tests/builder-help.spec
 */
import { expect, test, type Page, type Route } from "@playwright/test";

import { gotoAdmin } from "./support/admin";

/** The control that opens the page builder, in either of its wordings. */
const OPEN_BUILDER_ACTION = /^(?:Build this page|Open Page Builder)$/;

async function openEditor(page: Page): Promise<void> {
  await gotoAdmin(page, "/singles/homepage");
  await page.getByRole("button", { name: OPEN_BUILDER_ACTION }).click();
  await expect(
    page.getByRole("navigation", { name: "Editor panels" })
  ).toBeVisible({ timeout: 30_000 });
}

test.describe("the editor's rail and Help", () => {
  test.beforeEach(async ({ context }) => {
    // Every handler catches: a failed route otherwise reports the request,
    // headers and all, into the run's output.
    await context.route(
      "https://nextlyhq.com/docs/**",
      async (route: Route) => {
        try {
          await route.fulfill({
            status: 200,
            contentType: "text/html",
            body: "<!doctype html><title>Docs</title><h1>Docs</h1>",
          });
        } catch {
          await route.abort().catch(() => {});
        }
      }
    );
  });

  test("names every item in visible text, and offers nothing that does not work", async ({
    page,
  }) => {
    await openEditor(page);
    const rail = page.getByRole("navigation", { name: "Editor panels" });

    for (const label of ["Add", "Layers", "Design", "Help"]) {
      await expect(rail.getByText(label, { exact: true })).toBeVisible();
    }
    await expect(rail).not.toContainText(/coming soon/i);
  });

  test("lists the editor's shortcuts, and gives focus back on Escape", async ({
    page,
  }) => {
    await openEditor(page);
    const help = page.getByRole("button", { name: "Help", exact: true });
    await help.click();

    const dialog = page.getByRole("dialog", { name: "Help" });
    await expect(dialog).toBeVisible();
    const shortcuts = dialog.getByRole("region", {
      name: "Keyboard shortcuts",
    });
    await expect(shortcuts).toContainText("Undo the last change");
    await expect(shortcuts).toContainText(/Ctrl\+Z|⌘Z/);

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(help).toBeFocused();
  });

  test("opens the documentation on its own, leaving the editor where it was", async ({
    page,
  }) => {
    await openEditor(page);
    await page.getByRole("button", { name: "Help", exact: true }).click();

    const [docs] = await Promise.all([
      page.waitForEvent("popup"),
      page.getByRole("link", { name: "Page Builder docs" }).click(),
    ]);
    await docs.waitForLoadState();
    expect(new URL(docs.url()).pathname).toBe("/docs/page-builder");
    await expect(page.getByRole("dialog", { name: "Help" })).toBeVisible();
  });
});
