/**
 * Leaving the Schema Builder with pending changes asks first, by every route:
 * an in-app link, the browser's Back, a reload and closing the tab.
 *
 * Only a real browser can answer for Back, a reload and a closed tab. Which
 * `popstate` listener hears Back first is the browser's decision, and the
 * prompt for a reload or a closed tab is the browser's own `beforeunload`
 * one, which jsdom does not have.
 *
 * A collection made at runtime, because the playground's own collections are
 * code-first and open read-only.
 */
import { expect, type Page } from "@playwright/test";

import { test } from "./support/test";
import { gotoAdmin } from "./support/admin";
import { LOCK } from "./support/locks";
import {
  createRuntimeCollection,
  removeRuntimeCollection,
} from "./support/runtime-collection";

// Creating a collection changes the schema and the dashboard's cards, as for
// the other specs that create one.
test.describe.configure({ lock: [LOCK.dashboard, LOCK.schema] });

/**
 * A runtime collection opened in the Builder with one pending change: a
 * field's label edited and not saved. Runs `body`, then removes the
 * collection.
 */
async function withPendingChange(
  page: Page,
  body: (builderUrl: string) => Promise<void>
): Promise<void> {
  const slug = `leave_guard_${Date.now()}`;
  try {
    await createRuntimeCollection(page.request, slug, [
      {
        name: "summary",
        type: "text",
        label: "Summary",
        required: false,
        unique: false,
        index: false,
      },
    ]);
    await gotoAdmin(page, `/builder/collections/${slug}`);
    await page.getByTestId("field-row-summary").click();
    await page
      .getByRole("textbox", { name: "Label", exact: true })
      .fill("Excerpt");
    await expect(page.getByText("1 unsaved change")).toBeVisible();
    await body(page.url());
  } finally {
    // The collection only. Its migration files stay: the server's ledger
    // records them as applied, and deleting them while it runs makes it
    // refuse every later schema change.
    if (!page.isClosed()) await removeRuntimeCollection(page.request, slug);
  }
}

test("an in-app link asks first, and Keep Editing stays", async ({ page }) => {
  await withPendingChange(page, async builderUrl => {
    await page.getByRole("link", { name: "Back to collections" }).click();
    const prompt = page.getByRole("alertdialog");
    await expect(prompt).toBeVisible();
    await expect(page).toHaveURL(builderUrl);
    await prompt.getByRole("button", { name: "Keep Editing" }).click();
    await expect(prompt).toBeHidden();
    await expect(page).toHaveURL(builderUrl);
    await expect(page.getByText("1 unsaved change")).toBeVisible();
  });
});

test("back asks first, and Discard leaves", async ({ page }) => {
  await withPendingChange(page, async builderUrl => {
    // Not Playwright's `goBack`, which waits for the navigation the guard is
    // there to hold.
    await page.evaluate(() => window.history.back());
    const prompt = page.getByRole("alertdialog");
    await expect(prompt).toBeVisible();
    await expect(page).toHaveURL(builderUrl);
    await prompt.getByRole("button", { name: "Discard Changes" }).click();
    await expect(page).not.toHaveURL(builderUrl);
  });
});

test("reload gets the browser's own prompt, and dismissing it stays", async ({
  page,
}) => {
  await withPendingChange(page, async () => {
    const dialog = page.waitForEvent("dialog");
    // Started from the page, which the browser runs `beforeunload` for; not
    // awaited, because the reload waits on the answer to the prompt.
    void page.evaluate(() => window.location.reload()).catch(() => undefined);
    const prompt = await dialog;
    expect(prompt.type()).toBe("beforeunload");
    await prompt.dismiss();
    await expect(page.getByText("1 unsaved change")).toBeVisible();
  });
});

test("closing the tab gets the browser's own prompt, and dismissing it keeps the tab", async ({
  page,
}) => {
  await withPendingChange(page, async () => {
    const dialog = page.waitForEvent("dialog");
    // Closed as a person closes it, so the page's own exit handlers run.
    void page.close({ runBeforeUnload: true }).catch(() => undefined);
    const prompt = await dialog;
    expect(prompt.type()).toBe("beforeunload");
    await prompt.dismiss();
    expect(page.isClosed()).toBe(false);
    await expect(page.getByText("1 unsaved change")).toBeVisible();
  });
});
