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
import { expect, type Page, type Route } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { LOCK } from "./support/locks";
import { test } from "./support/test";

// The editor opens on the homepage Single, which other files edit.
test.describe.configure({ lock: [LOCK.homepage] });

/** The control that opens the page builder, in either of its wordings. */
const OPEN_BUILDER_ACTION = /^(?:Build this page|Open Page Builder)$/;

async function openEditor(page: Page): Promise<void> {
  await gotoAdmin(page, "/singles/homepage");
  await page.getByRole("link", { name: OPEN_BUILDER_ACTION }).click();
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

  test("names every item by its accessible name and tooltip, and offers nothing that does not work", async ({
    page,
  }) => {
    await openEditor(page);
    const rail = page.getByRole("navigation", { name: "Editor panels" });

    // Icons only: each item's name is its accessible name, and pointing at it
    // shows the name in a tooltip, with its key where it has one.
    for (const [label, key] of [
      ["Add", "A"],
      ["Layers", "L"],
      ["Design", "D"],
      ["Help", undefined],
    ] as const) {
      const item = rail.getByRole("button", { name: label, exact: true });
      await expect(item).toBeVisible();
      await item.hover();
      const tip = page.getByRole("tooltip");
      await expect(tip).toHaveText(
        key === undefined ? label : `${label}${key}`
      );
      // Away across the canvas, as a pointer leaves an item.
      await page.mouse.move(500, 300, { steps: 5 });
      await expect(tip).toBeHidden();
    }
    await expect(rail).not.toContainText(/coming soon/i);
  });

  test("lists the editor's shortcuts, and gives focus back on Escape", async ({
    page,
  }) => {
    await openEditor(page);
    const help = page
      .getByRole("navigation", { name: "Editor panels" })
      .getByRole("button", { name: "Help", exact: true });
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
    await page
      .getByRole("navigation", { name: "Editor panels" })
      .getByRole("button", { name: "Help", exact: true })
      .click();

    const [docs] = await Promise.all([
      page.waitForEvent("popup"),
      page.getByRole("link", { name: "Page Builder docs" }).click(),
    ]);
    await docs.waitForLoadState();
    expect(new URL(docs.url()).pathname).toBe("/docs/page-builder");
    await expect(page.getByRole("dialog", { name: "Help" })).toBeVisible();
  });
});
