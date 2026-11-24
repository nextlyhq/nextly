/**
 * Changing a saved field's type in a real Builder: Change type… opens the picker on the field, each
 * type marked by what the change does to the saved values, or unavailable with the save's own
 * reason; the change picked reaches the save's review, and the save converts the values.
 *
 * The collection is made at runtime, since the playground's own collections are code-first and
 * open read-only.
 */
import { expect, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { expectNoAxeViolations } from "./support/axe";
import { LOCK } from "./support/locks";
import {
  createEntry,
  createRuntimeCollection,
  removeRuntimeCollection,
} from "./support/runtime-collection";
import { test } from "./support/test";

// Creating a collection changes the schema and the dashboard's cards, as for the other specs that
// create one.
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

/** A type's row in the picker, by the id the picker marks it with. */
const typeRow = (page: Page, type: string) =>
  page.getByRole("dialog").locator(`[role="option"][data-type="${type}"]`);

/** Open Change type… from a field's row menu. */
async function changeTypeOf(page: Page, path: string): Promise<void> {
  await row(page, path).focus();
  await page.keyboard.press("Shift+F10");
  await page.getByRole("menuitem", { name: "Change type…" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
}

test.describe("changing a field's type in the Builder", () => {
  const slug = `type_change_${Date.now()}`;

  test.beforeEach(async ({ page }) => {
    await createRuntimeCollection(page.request, slug, [
      // Kept once for every language, so its type changes on its own.
      plain("rating", "Rating", { localized: false }),
      // Translatable by default, kept per language: a number would stop it being translated.
      plain("summary", "Summary"),
    ]);
  });

  // In afterEach, so it runs when a test fails too.
  test.afterEach(async ({ page }) => {
    await removeRuntimeCollection(page.request, slug);
  });

  test("changes a saved field's type and reaches the review, and the save converts its values", async ({
    page,
  }) => {
    const id = await createEntry(page.request, slug, {
      title: "Rated",
      rating: "12",
    });
    await gotoAdmin(page, `/builder/collections/${slug}`);
    await expect(row(page, "rating")).toBeVisible();
    await changeTypeOf(page, "rating");
    // Marked by what the change can do to the saved values, as the server judges the pair.
    await expect(typeRow(page, "number")).toContainText("May lose some values");
    await expect(typeRow(page, "textarea")).toContainText("Keeps every value");
    await typeRow(page, "number").click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(row(page, "rating")).toContainText("Number");

    await page.getByRole("button", { name: "Save", exact: true }).click();
    const review = page.getByRole("alertdialog");
    await expect(review).toBeVisible();
    await expect(review).toContainText(/rating/i);
    // The save's last write, the collection's settings, lands after the fields show as saved.
    const settingsSaved = page.waitForResponse(
      response =>
        response.request().method() === "PATCH" &&
        new URL(response.url()).pathname === `${API}/collections/${slug}`
    );
    await review.getByRole("button").last().click();
    expect((await settingsSaved).ok()).toBe(true);
    await expect(
      page.getByText("No unsaved changes", { exact: true })
    ).toBeVisible();
    const read = await page.request.get(
      `${API}/collections/${slug}/entries/${id}`
    );
    const body = (await read.json()) as {
      item?: Record<string, unknown>;
    } & Record<string, unknown>;
    expect((body.item ?? body).rating).toBe(12);
  });

  test("a type the save would refuse is unavailable, in the save's own words", async ({
    page,
  }) => {
    await gotoAdmin(page, `/builder/collections/${slug}`);
    await expect(row(page, "summary")).toBeVisible();
    await changeTypeOf(page, "summary");
    const number = typeRow(page, "number");
    await expect(number).toHaveAttribute("aria-disabled", "true");
    await expect(number).toContainText(
      "Unavailable: Its type, length or precision changes in the same change that stops it being translated. Turn off Localized and save. Change how it is stored and save."
    );
    // Not picked by Enter: the picker stays open, and nothing changed.
    await page
      .getByRole("combobox", { name: "Search field types" })
      .fill("number");
    await page.keyboard.press("Enter");
    await expect(number).toBeVisible();
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await expectNoAxeViolations(page, { include: '[role="dialog"]' });
    }
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("button", { name: "Save", exact: true })
    ).toBeDisabled();
  });
});
