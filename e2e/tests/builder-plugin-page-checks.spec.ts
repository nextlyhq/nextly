/**
 * Another plugin's page check in the builder's Page checks: the test fixture
 * plugin's provider lists a block saying "Fixture problem" under Publishing;
 * choosing it opens the block's Text, and once the page is saved with other
 * words the item is gone, without opening the list again.
 *
 * The fixture plugin is registered only on this suite's own server
 * (`NEXTLY_E2E_STYLE_FIXTURE`). Black box like the rest of `e2e/`: no
 * product code is imported.
 *
 * @module tests/builder-plugin-page-checks.spec
 */
import { expect, type Page } from "@playwright/test";

import { canvasRoot } from "./canvas/editor-driver";
import { gotoAdmin } from "./support/admin";
import { test } from "./support/test";

const API = "/admin/api";
const STAMP = `${Date.now().toString(36)}${Math.round(Math.random() * 1e4)}`;

async function seedPage(page: Page): Promise<string> {
  await gotoAdmin(page, "/");
  const created = await page.request.post(`${API}/collections/pages/entries`, {
    data: {
      title: `Plugin checks ${STAMP}`,
      slug: `plugin-checks-${STAMP}`,
      content: {
        formatVersion: 1,
        kind: "page",
        nodes: [
          {
            id: "flagged",
            type: "core/heading",
            version: 1,
            props: { text: "Fixture problem", level: "h1" },
          },
        ],
      },
    },
  });
  expect(created.ok(), `page: ${created.status()}`).toBe(true);
  return ((await created.json()) as { item: { id: string } }).item.id;
}

const chip = (page: Page) =>
  page
    .locator('[data-topbar="end"]')
    .getByRole("button", { name: /^(\d+ checks?|Checks)\b/ });

test("lists another plugin's check in its group, opens its fix, and drops it once saved", async ({
  page,
}) => {
  const id = await seedPage(page);
  await gotoAdmin(page, `/collections/pages/${id}/builder?field=content`);
  await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible({
    timeout: 30_000,
  });

  await chip(page).click();
  const list = page.getByRole("dialog", { name: "Page checks" });
  await expect(list).toContainText("Publishing");
  const item = list.getByRole("button", { name: /Fixture problem found/ });
  await expect(item).toBeVisible();

  // Choosing it opens the block's Text, where the fix is.
  await item.click();
  const text = page
    .locator(".nx-inspector")
    .getByLabel("Text", { exact: true });
  await expect(text).toBeFocused();

  // Other words, saved: the provider is asked again and finds nothing.
  await text.fill("Our work");
  // Left, so the field hands its words to the page, as the canvas then shows.
  await text.press("Tab");
  await expect(
    (await canvasRoot(page)).locator('[data-nx-node="flagged"]')
  ).toContainText("Our work");
  await page.keyboard.press("Control+s");
  await expect(chip(page)).not.toHaveText(/\d+ checks?/, { timeout: 15_000 });
});
