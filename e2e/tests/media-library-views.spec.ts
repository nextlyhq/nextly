/**
 * The media library's views, delete with Undo, and Replace, in a real
 * browser against a real server.
 *
 * What a unit test cannot see: the server finishing a delete after its
 * window while the person is on another page; Undo bringing the item back
 * through the real routes; a view listing an item the server judges; and an
 * accessibility audit of the sidebar and the library together.
 */
import { expect, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { expectNoAxeViolations } from "./support/axe";
import { dropFiles, pngBuffer } from "./support/media-files";
import { test } from "./support/test";

/** Upload one image into the library and close the tray; its id. */
async function uploadOne(page: Page, name: string): Promise<string> {
  await gotoAdmin(page, "/media", "light");
  await dropFiles(page, [{ name, buffer: pngBuffer(90) }]);
  await expect(
    page.getByRole("status").filter({ hasText: /uploaded/ })
  ).toContainText("1 uploaded", { timeout: 30_000 });
  await page.getByRole("button", { name: "Close uploads" }).click();
  await page.getByRole("button", { name: "Grid view" }).click();
  const listed = await page.request.get(
    `/admin/api/media?search=${encodeURIComponent(name)}`
  );
  const body = (await listed.json()) as { items: Array<{ id: string }> };
  expect(body.items).toHaveLength(1);
  return body.items[0].id;
}

const tile = (page: Page, name: string) =>
  page.getByRole("button", { name: new RegExp(`^${name}`) }).first();

/** Open an item and delete it through the dialog. */
async function deleteThroughDialog(page: Page, name: string) {
  await tile(page, name).click();
  const panel = page.getByRole("complementary", { name: "Media details" });
  await panel.getByRole("button", { name: "Delete" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("It isn't used anywhere.");
  await expect(dialog).toContainText("undo this for a few seconds");
  await dialog.getByRole("button", { name: "Delete" }).click();
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
});

test("Undo brings a deleted item back through the real routes", async ({
  page,
}) => {
  const id = await uploadOne(page, "undo-me.png");
  await deleteThroughDialog(page, "undo-me.png");

  // Out of the list at once.
  await expect(tile(page, "undo-me.png")).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();

  await expect(tile(page, "undo-me.png")).toBeVisible();
  // Kept past the window: Undo took the mark, so nothing finishes the delete.
  await page.waitForTimeout(12_000);
  expect((await page.request.get(`/admin/api/media/${id}`)).status()).toBe(200);
});

test("a delete finishes after its window while the person is on another page", async ({
  page,
}) => {
  const id = await uploadOne(page, "gone-later.png");
  await deleteThroughDialog(page, "gone-later.png");
  await expect(tile(page, "gone-later.png")).toHaveCount(0);

  // Away from the library inside the window: nothing on the page is left to
  // finish the delete, so the server must.
  await gotoAdmin(page, "", "light");
  expect((await page.request.get(`/admin/api/media/${id}`)).status()).toBe(200);

  await expect
    .poll(
      async () => (await page.request.get(`/admin/api/media/${id}`)).status(),
      { timeout: 30_000, intervals: [1_000] }
    )
    .toBe(404);
});

test("the Missing alt text view lists an image without alt text, and the sidebar and details pass an audit", async ({
  page,
}) => {
  await uploadOne(page, "no-alt.png");
  const sidebar = page.getByRole("navigation", { name: "Media library" });

  await sidebar.getByRole("button", { name: /^Missing alt text/ }).click();
  await expect(
    sidebar.getByRole("button", { name: /^Missing alt text/ })
  ).toHaveAttribute("aria-current", "page");
  await expect(page.getByText(/files? missing alt text/)).toBeVisible();
  await expect(tile(page, "no-alt.png")).toBeVisible();
  await expectNoAxeViolations(page, {
    include: 'nav[aria-label="Media library"]',
  });

  // The details, with where the item is used and its actions.
  await tile(page, "no-alt.png").click();
  const panel = page.getByRole("complementary", { name: "Media details" });
  await expect(panel.getByRole("region", { name: /^Used in/ })).toContainText(
    "Not used anywhere yet."
  );
  await expect(
    panel.getByRole("button", { name: "Replace file" })
  ).toBeVisible();
  await expectNoAxeViolations(page, {
    include: "[data-media-details-panel]",
  });
});
