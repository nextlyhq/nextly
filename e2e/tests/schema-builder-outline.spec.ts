/**
 * The Schema Builder's outline in a real Builder: every field of a collection
 * at every depth, folding remembered across a reload, a hidden field kept and
 * shown again, a field group's fields read-only with the way to its editor, a
 * field defined in code read-only, and no accessibility violation in the outline.
 *
 * The collection and its two field groups (one using the other) are made at
 * runtime in the shape of the Builder's nested fixture, because the
 * playground's own collections are code-first and open read-only. A field
 * owned by code cannot be made that way; that case is the SEO plugin's
 * code-first collection, which this suite's server runs with.
 */
import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { expectNoAxeViolations } from "./support/axe";
import { LOCK } from "./support/locks";
import {
  createRuntimeCollection,
  expectOk,
  removeRuntimeCollection,
} from "./support/runtime-collection";
import { test } from "./support/test";

// Creating collections and field groups changes the schema and the
// dashboard's cards, as for the other specs that create one.
test.describe.configure({ lock: [LOCK.dashboard, LOCK.schema] });

const API = "/admin/api";

/** A field group made at runtime, as the Builder makes one. */
async function createFieldGroup(
  api: APIRequestContext,
  slug: string,
  label: string,
  fields: readonly Record<string, unknown>[]
): Promise<void> {
  await expectOk(
    await api.post(`${API}/field-groups`, { data: { slug, label, fields } }),
    `creating the field group ${slug}`
  );
}

async function removeFieldGroup(
  api: APIRequestContext,
  slug: string
): Promise<void> {
  const removed = await api.delete(`${API}/field-groups/${slug}`);
  if (removed.status() === 404) return;
  await expectOk(removed, `removing the field group ${slug}`);
}

/**
 * Stored as a field the Builder made is stored, with its flags written out,
 * containers included. A field stored without `required`/`unique` reads as
 * changed on any Builder save, because the save's preview compares them
 * exactly (`hasFieldChanged` in nextly's domains/schema/services/field-diff.ts),
 * and the save then asks to confirm a schema change that is not the test's.
 */
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

/** Open a row's menu by its key, as a keyboard does. */
async function openMenu(page: Page, path: string) {
  await row(page, path).focus();
  await page.keyboard.press("Shift+F10");
  return page.getByRole("menu");
}

test.describe("the Builder outline", () => {
  const stamp = Date.now();
  const slug = `outline_${stamp}`;
  const social = `social_${stamp}`;
  const seo = `seo_${stamp}`;

  test.beforeEach(async ({ page }) => {
    await createFieldGroup(page.request, social, "Social", [
      plain("handle", "Handle"),
    ]);
    await createFieldGroup(page.request, seo, "SEO", [
      plain("meta_title", "Meta title"),
      { ...plain("social", "Social"), type: "component", component: social },
    ]);
    await createRuntimeCollection(page.request, slug, [
      plain("summary_a", "Summary"),
      plain("summary_b", "Summary"),
      plain("internal_note", "Internal note", { admin: { hidden: true } }),
      {
        ...plain("meta", "Meta"),
        type: "group",
        // A group's own `title`: the entity's built-in field is named so, and
        // this one is an ordinary field of its group.
        fields: [plain("title", "Meta title")],
      },
      {
        ...plain("sections", "Sections"),
        type: "repeater",
        fields: [
          plain("heading", "Heading"),
          {
            ...plain("items", "Items"),
            type: "repeater",
            fields: [
              {
                ...plain("cta", "Call to action"),
                type: "group",
                fields: [plain("label", "Button label")],
              },
            ],
          },
        ],
      },
      { ...plain("seo", "SEO"), type: "component", component: seo },
    ]);
  });

  // In afterEach, so it runs when a test fails too. The migration files these
  // writes leave are not removed here: the server's ledger records them as
  // applied, and deleting them while it runs makes it refuse every later
  // schema change, in this spec and in the specs after it. They sit in the
  // playground's ignored migrations folder, and a run starts on a fresh
  // database.
  test.afterEach(async ({ page }) => {
    await removeRuntimeCollection(page.request, slug);
    await removeFieldGroup(page.request, seo);
    await removeFieldGroup(page.request, social);
  });

  test("the nested fixture's outline", async ({ page }) => {
    await gotoAdmin(page, `/builder/collections/${slug}`);
    await expect(page.getByRole("tree", { name: "Fields" })).toBeVisible();
    for (const [path, label] of [
      ["summary_a", "Summary"],
      ["summary_b", "Summary"],
      ["internal_note", "Internal note"],
      ["meta/title", "Meta title"],
      ["sections/items/cta/label", "Button label"],
      ["seo/meta_title", "Meta title"],
      ["seo/social/handle", "Handle"],
    ] as const) {
      await expect(row(page, path)).toContainText(label);
    }
    await expect(row(page, "sections/items/cta/label")).toHaveAttribute(
      "aria-level",
      "4"
    );
    await expect(row(page, "internal_note")).toContainText("Hidden");
    await expect(row(page, "seo/meta_title")).toContainText(
      "Defined in the field group SEO"
    );
    // Neither the light scheme nor the dark one breaks a rule in the outline.
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await expectNoAxeViolations(page, { include: '[role="tree"]' });
    }
  });

  test("fold state survives a reload", async ({ page }) => {
    await gotoAdmin(page, `/builder/collections/${slug}`);
    await row(page, "sections").focus();
    await page.keyboard.press("ArrowLeft");
    await expect(row(page, "sections/heading")).toHaveCount(0);

    await page.reload();
    await expect(row(page, "sections")).toHaveAttribute(
      "aria-expanded",
      "false"
    );
    await expect(row(page, "sections/heading")).toHaveCount(0);
    await expect(row(page, "meta/title")).toBeVisible();
  });

  test("hide, save, show again", async ({ page }) => {
    await gotoAdmin(page, `/builder/collections/${slug}`);
    const hiddenAfterSave = async (expected: boolean) => {
      await expect
        .poll(async () => {
          const schema = await page.request.get(
            `${API}/collections/schema/${slug}`
          );
          const body = (await schema.json()) as {
            fields?: { name: string; admin?: { hidden?: boolean } }[];
          };
          return (
            body.fields?.find(f => f.name === "summary_a")?.admin?.hidden ===
            true
          );
        })
        .toBe(expected);
    };

    await (await openMenu(page, "summary_a"))
      .getByRole("menuitem", { name: "Hide" })
      .click();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    // Hiding is a setting, not a schema change: nothing asks to confirm it.
    await hiddenAfterSave(true);
    await expect(page.getByRole("alertdialog")).toHaveCount(0);

    await page.reload();
    await expect(row(page, "summary_a")).toContainText("Hidden");
    await (await openMenu(page, "summary_a"))
      .getByRole("menuitem", { name: "Show" })
      .click();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await hiddenAfterSave(false);
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
  });

  test("follows the link to the field group's editor", async ({ page }) => {
    await gotoAdmin(page, `/builder/collections/${slug}`);
    await row(page, "seo/meta_title").click();
    await page
      .getByRole("button", { name: "Open the field group SEO" })
      .click();
    await expect(page).toHaveURL(new RegExp(`/builder/field-groups/${seo}$`));
  });
});

test("a field defined in code is read-only", async ({ page }) => {
  // A code-first collection: each of its fields is defined in code, the group
  // the SEO plugin adds to it included, so none of them can change here. A
  // field a plugin adds to a Builder-made collection is marked as the
  // plugin's; the outline's component test covers that row.
  await gotoAdmin(page, "/builder/collections/seo-pages");
  const owned = row(page, "seo");
  await expect(owned).toContainText("Defined in code");
  await owned.focus();
  await page.keyboard.press("Shift+F10");
  const menu = page.getByRole("menu");
  await expect(
    menu.getByRole("menuitem", { name: "View settings" })
  ).toBeVisible();
  for (const action of [
    "Duplicate",
    "Delete",
    "Hide",
    "Move up",
    "Add a field after",
  ]) {
    await expect(menu.getByRole("menuitem", { name: action })).toHaveCount(0);
  }
});
