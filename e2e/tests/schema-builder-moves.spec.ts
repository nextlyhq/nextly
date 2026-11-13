/**
 * Moving fields in a real Builder: by drag (one field at a time, whatever its
 * width), by key, by Move to… and by Duplicate, each judged by the one move
 * rule and announced. A move into or out of a group or repeating rows is
 * refused for now, saying it is not available yet, until a save keeps a
 * field's values when it changes container; reorders within a container go
 * ahead and are saved.
 *
 * The collection is made at runtime, since the playground's own collections
 * are code-first and open read-only.
 */
import { expect, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { expectNoAxeViolations } from "./support/axe";
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

const NOT_YET =
  "Moving a field into or out of a group or repeating rows is not available yet.";

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

/** The top-level rows' paths, in the order drawn. */
async function topLevel(page: Page): Promise<string[]> {
  return page
    .locator('[role="treeitem"][aria-level="1"]')
    .evaluateAll(rows =>
      rows.map(each => each.getAttribute("data-path") ?? "")
    );
}

/** The outline's live region says exactly `text`. */
async function says(page: Page, text: string): Promise<void> {
  await expect(
    page.locator('[aria-live="polite"]').filter({ hasText: text })
  ).toHaveText(text);
}

/**
 * Drag a row by its handle onto another row, the pointer moved `levels` of
 * indent sideways (20px each) on the way: as a person drags, in small steps,
 * past the 8px it takes to start.
 */
async function drag(
  page: Page,
  from: string,
  onto: string,
  { levels = 0, drop = true } = {}
): Promise<void> {
  const handle = row(page, from).locator("xpath=preceding-sibling::span[1]");
  const start = await handle.boundingBox();
  const target = await row(page, onto).boundingBox();
  if (!start || !target) throw new Error("a row to drag is not drawn");
  const x = start.x + start.width / 2;
  const y = start.y + start.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 12, { steps: 4 });
  await page.mouse.move(
    x + levels * 20 + (levels ? 6 : 0),
    target.y + target.height / 2,
    {
      steps: 16,
    }
  );
  if (drop) await page.mouse.up();
}

/**
 * The collection's stored top-level field names, in order, less the built-in
 * fields the server keeps ahead of them.
 */
async function storedOrder(page: Page, slug: string): Promise<string[]> {
  const schema = await page.request.get(`${API}/collections/schema/${slug}`);
  const body = (await schema.json()) as { fields?: { name: string }[] };
  return (body.fields ?? [])
    .map(field => field.name)
    .filter(name => !["title", "slug"].includes(name));
}

test.describe("moving fields in the Builder outline", () => {
  const slug = `moves_${Date.now()}`;

  test.beforeEach(async ({ page }) => {
    await createRuntimeCollection(page.request, slug, [
      plain("summary_a", "Summary A"),
      plain("summary_b", "Summary B"),
      plain("half_left", "Half left", { admin: { width: "50%" } }),
      plain("half_right", "Half right", { admin: { width: "50%" } }),
      {
        ...plain("meta", "Meta"),
        type: "group",
        fields: [plain("headline", "Headline"), plain("caption", "Caption")],
      },
      {
        ...plain("sections", "Sections"),
        type: "repeater",
        fields: [plain("heading", "Heading")],
      },
    ]);
  });

  // In afterEach, so it runs when a test fails too. The migration files the
  // writes leave stay in the playground's ignored migrations folder: the
  // server's ledger records them as applied.
  test.afterEach(async ({ page }) => {
    await removeRuntimeCollection(page.request, slug);
  });

  test("drags a field to a new place at its level, and the save keeps it", async ({
    page,
  }) => {
    await gotoAdmin(page, `/builder/collections/${slug}`);
    await expect(page.getByRole("tree", { name: "Fields" })).toBeVisible();
    await drag(page, "summary_b", "summary_a");
    await says(page, "Moved Summary B, position 1 of 6.");
    expect((await topLevel(page)).slice(0, 2)).toEqual([
      "summary_b",
      "summary_a",
    ]);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect
      .poll(async () => (await storedOrder(page, slug)).slice(0, 2))
      .toEqual(["summary_b", "summary_a"]);
  });

  test("drags one of two half-width fields", async ({ page }) => {
    await gotoAdmin(page, `/builder/collections/${slug}`);
    await drag(page, "half_right", "summary_a");
    // Only the field dragged moves; the other half stays where it was.
    expect(await topLevel(page)).toEqual([
      "half_right",
      "summary_a",
      "summary_b",
      "half_left",
      "meta",
      "sections",
    ]);
  });

  test("a drag into a group says why it is refused, and nothing moves", async ({
    page,
  }) => {
    await gotoAdmin(page, `/builder/collections/${slug}`);
    // Read once the outline is drawn, so it is the order a drag starts from.
    await expect(row(page, "sections")).toBeVisible();
    const before = await topLevel(page);
    expect(before).toHaveLength(6);
    // A level to the right of the group's row: into the group.
    await drag(page, "summary_a", "meta", { levels: 1, drop: false });
    await expect(page.getByText(NOT_YET, { exact: true })).toBeVisible();
    await page.mouse.up();
    await says(page, `${NOT_YET} Nothing moved.`);
    expect(await topLevel(page)).toEqual(before);
    await expect(row(page, "meta/summary_a")).toHaveCount(0);
    // Nothing to save: the refused drop left no change behind.
    await expect(
      page.getByText("No unsaved changes", { exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Save", exact: true })
    ).toBeDisabled();
  });

  test("moves by key within a container, announced, with focus kept", async ({
    page,
  }) => {
    await gotoAdmin(page, `/builder/collections/${slug}`);
    await row(page, "meta/caption").focus();
    await page.keyboard.press("Alt+ArrowUp");
    await says(page, "Moved Caption up, position 1 of 2.");
    await expect(row(page, "meta/caption")).toBeFocused();
    // Out of the group is not available yet, and is said so.
    await page.keyboard.press("Alt+ArrowLeft");
    await says(page, `${NOT_YET} Nothing moved.`);
    await expect(row(page, "meta/caption")).toBeFocused();
    // The keys are named in the row's description.
    const describedBy = await row(page, "meta/caption").getAttribute(
      "aria-describedby"
    );
    await expect(page.locator(`[id="${describedBy}"]`)).toContainText(
      "Alt+Up and Alt+Down move the field"
    );
  });

  test("Move to… within its own place, saying why other places are not offered yet", async ({
    page,
  }) => {
    await gotoAdmin(page, `/builder/collections/${slug}`);
    await row(page, "sections").focus();
    await page.keyboard.press("Shift+F10");
    await page.getByRole("menuitem", { name: "Move to…" }).click();
    const dialog = page.getByRole("dialog");
    const meta = dialog.getByRole("radio", { name: /^Meta/ });
    await expect(meta).toBeDisabled();
    await expect(meta).toHaveAccessibleDescription(NOT_YET);
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await expectNoAxeViolations(page, { include: '[role="dialog"]' });
    }
    await dialog.getByLabel("Position").selectOption({ label: "At the start" });
    await dialog.getByRole("button", { name: "Move" }).click();
    await expect(dialog).toHaveCount(0);
    await says(page, "Moved Sections, position 1 of 6.");
    await expect(row(page, "sections")).toBeFocused();
    expect((await topLevel(page))[0]).toBe("sections");
  });

  test("duplicates right after the original", async ({ page }) => {
    await gotoAdmin(page, `/builder/collections/${slug}`);
    await row(page, "summary_a").focus();
    await page.keyboard.press("Shift+F10");
    await page.getByRole("menuitem", { name: "Duplicate" }).click();
    expect((await topLevel(page)).slice(0, 3)).toEqual([
      "summary_a",
      "summary_a_2",
      "summary_b",
    ]);
  });

  test("a field added in this draft may go into repeating rows before the save", async ({
    page,
  }) => {
    // It has no stored values yet, so no change of level can lose any: only
    // fields already saved wait for a save that keeps values.
    await gotoAdmin(page, `/builder/collections/${slug}`);
    await expect(row(page, "sections")).toBeVisible();
    await page.getByRole("button", { name: "Add field", exact: true }).click();
    const search = page.getByRole("combobox", { name: "Search field types" });
    await expect(search).toBeFocused();
    await search.fill("text");
    await page.keyboard.press("Enter");
    await page.getByRole("textbox", { name: "Label" }).fill("Draft note");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Add field", exact: true })
      .click();
    await page.getByRole("button", { name: "Close field settings" }).click();

    await row(page, "draft_note").focus();
    await page.keyboard.press("Shift+F10");
    await page.getByRole("menuitem", { name: "Move to…" }).click();
    const dialog = page.getByRole("dialog");
    const sections = dialog.getByRole("radio", { name: /^Sections/ });
    await expect(sections).toBeEnabled();
    await sections.check();
    await dialog.getByRole("button", { name: "Move" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(row(page, "sections/draft_note")).toBeVisible();
  });
});

test.describe("focusing one container in the Builder outline", () => {
  const slug = `focus_${Date.now()}`;

  test.beforeEach(async ({ page }) => {
    await createRuntimeCollection(page.request, slug, [
      plain("summary", "Summary"),
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
                fields: [plain("label", "Label"), plain("kind", "Kind")],
              },
            ],
          },
        ],
      },
    ]);
  });

  test.afterEach(async ({ page }) => {
    await removeRuntimeCollection(page.request, slug);
  });

  /** Focus a row's container from its menu, as the keyboard opens it. */
  async function focusOn(page: Page, path: string): Promise<void> {
    await row(page, path).focus();
    await page.keyboard.press("Shift+F10");
    await page.getByRole("menuitem", { name: "Focus", exact: true }).click();
  }

  for (const theme of ["light", "dark"] as const) {
    test(`focuses a container three levels deep (${theme})`, async ({
      page,
    }) => {
      await gotoAdmin(page, `/builder/collections/${slug}`, theme);
      await expect(row(page, "sections")).toBeVisible();
      await focusOn(page, "sections");
      await focusOn(page, "sections/items");
      await focusOn(page, "sections/items/cta");

      const crumbs = page.getByRole("navigation", { name: "Focus" });
      await expect(crumbs.getByRole("listitem")).toHaveText([
        "All fields",
        "Sections",
        "Items",
        "Call to action",
      ]);
      // Only the focused container's fields, as the first level drawn.
      await expect(page.locator('[role="treeitem"]')).toHaveCount(2);
      await expect(row(page, "sections/items/cta/label")).toHaveAttribute(
        "aria-level",
        "1"
      );
      await expect(row(page, "summary")).toHaveCount(0);
      await expectNoAxeViolations(page, { include: '[aria-label="Focus"]' });

      // A crumb is a place to drop a field: a saved one changing level is
      // refused, said while dragging, and nothing moves.
      const handle = row(page, "sections/items/cta/label").locator(
        "xpath=preceding-sibling::span[1]"
      );
      const start = await handle.boundingBox();
      const target = await crumbs
        .getByRole("button", { name: "Items", exact: true })
        .boundingBox();
      if (!start || !target) throw new Error("a drag end is not drawn");
      await page.mouse.move(start.x + 4, start.y + 4);
      await page.mouse.down();
      await page.mouse.move(start.x + 4, start.y + 16, { steps: 4 });
      await page.mouse.move(
        target.x + target.width / 2,
        target.y + target.height / 2,
        { steps: 12 }
      );
      await expect(page.getByText(NOT_YET, { exact: true })).toBeVisible();
      await page.mouse.up();
      await says(page, `${NOT_YET} Nothing moved.`);
      await expect(row(page, "sections/items/cta/label")).toBeVisible();

      // Exit focus: the whole outline again.
      await page.getByRole("button", { name: "Exit focus" }).click();
      await expect(crumbs).toHaveCount(0);
      await expect(row(page, "summary")).toBeVisible();
    });
  }
});
