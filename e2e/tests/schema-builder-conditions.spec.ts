/**
 * A condition keeps reading the right field when that field is renamed: in a
 * real Builder, a saved field another field's condition reads is renamed with
 * Rename…, the change is saved, and the stored condition names the new name,
 * so the entry form still hides the gated field and shows it once the renamed
 * field holds the value the condition asks for.
 *
 * The collection is made at runtime, since the playground's own collections
 * are code-first and open read-only.
 */
import { expect, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { LOCK } from "./support/locks";
import {
  createRuntimeCollection,
  removeRuntimeCollection,
} from "./support/runtime-collection";
import { test } from "./support/test";

// Creating a collection changes the schema and the dashboard's cards, as for
// the other specs that create one.
test.describe.configure({ lock: [LOCK.dashboard, LOCK.schema] });

const API = "/admin/api";

/** Stored as a field the Builder made is stored, its flags written out. */
const plain = (
  name: string,
  label: string,
  more: Record<string, unknown> = {}
) => ({
  name,
  type: "text",
  label,
  required: false,
  unique: false,
  index: false,
  ...more,
});

const row = (page: Page, path: string) =>
  page.locator(`[role="treeitem"][data-path="${path}"]`);

/** The collection's stored fields, by name. */
async function storedFields(
  page: Page,
  slug: string
): Promise<Map<string, { admin?: { condition?: { field?: string } } }>> {
  const schema = await page.request.get(`${API}/collections/schema/${slug}`);
  const body = (await schema.json()) as {
    fields?: { name: string; admin?: { condition?: { field?: string } } }[];
  };
  return new Map((body.fields ?? []).map(field => [field.name, field]));
}

test.describe("a condition across a rename", () => {
  const slug = `conditions_${Date.now()}`;

  test.beforeEach(async ({ page }) => {
    await createRuntimeCollection(page.request, slug, [
      plain("kind", "Kind"),
      plain("note", "Note", {
        admin: {
          condition: { field: "kind", operator: "equals", value: "show" },
        },
      }),
    ]);
  });

  // In afterEach, so it runs when a test fails too. The migration files the
  // writes leave stay in the playground's ignored migrations folder: the
  // server's ledger records them as applied.
  test.afterEach(async ({ page }) => {
    await removeRuntimeCollection(page.request, slug);
  });

  test("renames the source, saves, and the entry form still hides and shows the field", async ({
    page,
  }) => {
    await gotoAdmin(page, `/builder/collections/${slug}`);
    await row(page, "kind").click();
    await page.getByRole("button", { name: "Rename…" }).first().click();
    const rename = page.getByRole("dialog", { name: /Rename Kind/ });
    await rename.getByRole("textbox", { name: "New name" }).fill("category");
    await rename.getByRole("button", { name: "Rename" }).click();
    await expect(rename).toHaveCount(0);

    await page.getByRole("button", { name: "Save", exact: true }).click();
    // The rename is a schema change, reviewed before it is applied; it keeps
    // the values, so the review's button is "Save changes", not the
    // destructive "Apply changes".
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Save changes", exact: true })
      .click();

    // Stored: the source under its new name, the condition naming it.
    await expect
      .poll(
        async () => {
          const fields = await storedFields(page, slug);
          return [
            fields.has("category"),
            fields.has("kind"),
            fields.get("note")?.admin?.condition?.field,
          ];
        },
        { timeout: 60_000 }
      )
      .toEqual([true, false, "category"]);

    // The entry form reads the condition under the source's new name.
    await gotoAdmin(page, `/collections/${slug}/create`);
    const source = page.getByLabel("Kind", { exact: true });
    await expect(source).toBeVisible();
    await expect(page.getByLabel("Note", { exact: true })).toHaveCount(0);
    await source.fill("show");
    await expect(page.getByLabel("Note", { exact: true })).toBeVisible();
    await source.fill("hide");
    await expect(page.getByLabel("Note", { exact: true })).toHaveCount(0);
  });
});
