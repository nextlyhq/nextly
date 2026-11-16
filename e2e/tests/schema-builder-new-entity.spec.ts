/**
 * Creating a collection in the Schema Builder makes it a pending change: the
 * dialog's Create opens its editor with nothing written, and the first save
 * creates it. Leaving before that save asks first, and discarding leaves
 * nothing behind.
 *
 * Checked through the server's own answer for the collection, so "nothing
 * written" means the server has no such collection, not that the page says so.
 */
import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { test } from "./support/test";
import { gotoAdmin } from "./support/admin";
import { LOCK } from "./support/locks";
import { removeRuntimeCollection } from "./support/runtime-collection";

// Creating a collection changes the schema and the dashboard's cards, as for
// the other specs that create one.
test.describe.configure({ lock: [LOCK.dashboard, LOCK.schema] });

/** Whether the server holds a collection under `slug`. */
async function serverHas(
  api: APIRequestContext,
  slug: string
): Promise<boolean> {
  const answer = await api.get(`/admin/api/collections/${slug}`);
  return answer.ok();
}

/**
 * Creates a collection in the dialog under `slug`, and waits for its editor.
 * The address is typed rather than derived, so the test owns it.
 */
async function createInDialog(page: Page, slug: string): Promise<void> {
  await gotoAdmin(page, "/builder/collections/new");
  const dialog = page.getByRole("dialog", { name: "New collection" });
  await dialog.getByLabel("Name", { exact: true }).fill("Pending product");
  const address = dialog.getByLabel("API address");
  await address.fill(slug);
  const create = dialog.getByRole("button", { name: "Create", exact: true });
  await expect(create).toBeEnabled({ timeout: 15_000 });
  await create.click();
  await expect(page).toHaveURL(
    new RegExp(`/admin/builder/collections/${slug}$`)
  );
  await expect(page.getByText("1 unsaved change")).toBeVisible({
    timeout: 30_000,
  });
}

test("creates, finds the pending changes, saves", async ({ page }) => {
  const slug = `new_entity_${Date.now()}`;
  const api = page.context().request;
  try {
    await createInDialog(page, slug);
    // Created in the editor only: the server has no such collection yet.
    expect(await serverHas(api, slug)).toBe(false);

    await page.getByRole("button", { name: "Add field", exact: true }).click();
    const search = page.getByRole("combobox", { name: "Search field types" });
    await expect(search).toBeFocused();
    await search.fill("text");
    await page.keyboard.press("Enter");
    await page.getByRole("textbox", { name: "Label" }).fill("Subtitle");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Add field", exact: true })
      .click();
    await page.getByRole("button", { name: "Close field settings" }).click();
    await expect(page.getByText("2 unsaved changes")).toBeVisible();

    await page.getByRole("button", { name: "Save", exact: true }).click();
    const review = page.getByRole("alertdialog");
    await expect(
      review.getByRole("heading", { name: `Create the collection ${slug}?` })
    ).toBeVisible();
    await expect(review).toContainText("subtitle");
    await review.getByRole("button", { name: "Create", exact: true }).click();

    await expect(page.getByText("No unsaved changes")).toBeVisible({
      timeout: 60_000,
    });
    const saved = await api.get(`/admin/api/collections/schema/${slug}`);
    expect(saved.ok()).toBe(true);
    const { fields } = (await saved.json()) as {
      fields: Array<{ name: string }>;
    };
    expect(fields.map(field => field.name)).toContain("subtitle");
  } finally {
    await removeRuntimeCollection(api, slug);
  }
});

test("leaving an unsaved new collection asks first, and leaves nothing behind", async ({
  page,
}) => {
  const slug = `new_entity_leave_${Date.now()}`;
  const api = page.context().request;
  try {
    await createInDialog(page, slug);
    // An in-app move, as the admin's own links make.
    await page.evaluate(
      path => window.history.pushState(null, "", path),
      "/admin/builder/collections"
    );
    const guard = page.getByRole("alertdialog", { name: "Unsaved Changes" });
    await expect(guard).toBeVisible();
    await guard.getByRole("button", { name: "Discard Changes" }).click();
    await expect(page).toHaveURL(/\/admin\/builder\/collections$/);

    expect(await serverHas(api, slug)).toBe(false);
  } finally {
    await removeRuntimeCollection(api, slug);
  }
});
