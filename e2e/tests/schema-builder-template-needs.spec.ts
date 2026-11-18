/**
 * Creating a collection from a template whose link needs a collection that
 * does not exist: the new-entity dialog offers to make that collection too,
 * and makes it by default. Both wait unsaved until the first save, whose
 * review lists the needed one as created first; the save then creates it,
 * then the collection whose link points at it.
 *
 * The template is the playground's template fixture, named as a test fixture,
 * and its target is an address nothing else uses. Checked through the
 * server's own answers, so "created" means the server has both.
 */
import { expect, type APIRequestContext } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { LOCK } from "./support/locks";
import { removeRuntimeCollection } from "./support/runtime-collection";
import { test } from "./support/test";

// Creating collections changes the schema and the dashboard's cards, as for
// the other specs that create one.
test.describe.configure({ lock: [LOCK.dashboard, LOCK.schema] });

/** The collection the fixture's template links to. */
const TARGET = "e2e_template_target";

/** Whether the server holds a collection under `slug`. */
async function serverHas(
  api: APIRequestContext,
  slug: string
): Promise<boolean> {
  const answer = await api.get(`/admin/api/collections/${slug}`);
  return answer.ok();
}

test("creates from a template, makes the collection it needs too, and saves both", async ({
  page,
}) => {
  // Two creates, the save's review and two removals: past the default budget
  // on a loaded machine, as the other specs that save twice allow.
  test.setTimeout(120_000);
  const slug = `template_host_${Date.now()}`;
  const api = page.context().request;
  try {
    await gotoAdmin(page, "/builder/collections/new");
    const dialog = page.getByRole("dialog", { name: "New collection" });
    // By role: a required field's label carries a mark beside its name.
    await dialog
      .getByRole("textbox", { name: "Name", exact: true })
      .fill("Template host");
    await dialog
      .getByRole("textbox", { name: "API address", exact: true })
      .fill(slug);

    await dialog.getByRole("button", { name: "Browse all templates" }).click();
    const gallery = page.getByRole("dialog", { name: "All templates" });
    await gallery
      .getByRole("searchbox", { name: "Search templates" })
      .fill("E2E template");
    await gallery
      .getByRole("button", {
        name: "Use E2E template with a needed collection",
      })
      .click();

    // The link's target does not exist, so the dialog makes it too.
    const picked = dialog.getByRole("group", {
      name: "Template: E2E template with a needed collection",
    });
    await expect(
      picked.getByRole("checkbox", {
        name: `Create the collection ${TARGET} too`,
      })
    ).toBeChecked({ timeout: 15_000 });
    const create = dialog.getByRole("button", { name: "Create", exact: true });
    await expect(create).toBeEnabled({ timeout: 15_000 });
    await create.click();
    await expect(page).toHaveURL(
      new RegExp(`/admin/builder/collections/${slug}$`)
    );
    // Made in the editor only: the server has neither yet.
    expect(await serverHas(api, slug)).toBe(false);
    expect(await serverHas(api, TARGET)).toBe(false);

    await page.getByRole("button", { name: "Save", exact: true }).click();
    const review = page.getByRole("alertdialog");
    // The needed collection, named as its settings name it, first.
    await expect(
      review.getByRole("list", { name: "Created first" })
    ).toHaveText("Create the collection E2e template target");
    await review.getByRole("button", { name: "Create", exact: true }).click();
    await expect(page.getByText("No unsaved changes")).toBeVisible({
      timeout: 60_000,
    });

    expect(await serverHas(api, TARGET)).toBe(true);
    const saved = await api.get(`/admin/api/collections/schema/${slug}`);
    expect(saved.ok()).toBe(true);
    const { fields } = (await saved.json()) as {
      fields: Array<{ name: string; relationTo?: string | string[] }>;
    };
    expect(fields).toContainEqual(
      expect.objectContaining({ name: "target", relationTo: TARGET })
    );
  } finally {
    // The collection linking first, then the one it links to.
    await removeRuntimeCollection(api, slug);
    await removeRuntimeCollection(api, TARGET);
  }
});
