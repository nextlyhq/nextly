/**
 * The field picker in a real Builder: fields land where the picker was opened,
 * in the order they are added.
 *
 * A collection made at runtime, because the playground's own collections are
 * code-first and open read-only. Nothing is saved: the order checked is the
 * Builder's list of pending changes, which is what the person sees before the
 * review.
 */
import { expect, type Page } from "@playwright/test";

import { test } from "./support/test";
import { gotoAdmin } from "./support/admin";
import { LOCK } from "./support/locks";
import {
  createRuntimeCollection,
  removeMigrationsOf,
} from "./support/runtime-collection";

// Creating a collection changes the schema and the dashboard's cards, as for the
// other specs that create one.
test.describe.configure({ lock: [LOCK.dashboard, LOCK.schema] });

/** The user fields' names, top to bottom, as the field list draws them. */
async function fieldOrder(page: Page): Promise<string[]> {
  const ids = await page
    .locator('[data-testid^="field-row-"]')
    .evaluateAll(rows => rows.map(row => row.getAttribute("data-testid")));
  return ids.map(id => (id ?? "").replace("field-row-", ""));
}

/** Pick a type by search, give it a label, and press one of the two adds. */
async function addField(
  page: Page,
  label: string,
  button: "Add field" | "Add and add another"
): Promise<void> {
  const search = page.getByRole("combobox", { name: "Search field types" });
  await expect(search).toBeFocused();
  await search.fill("text");
  await page.keyboard.press("Enter");
  await page.getByRole("textbox", { name: "Label" }).fill(label);
  await page.getByRole("button", { name: button, exact: true }).click();
}

test("adds three fields between two existing ones, in order", async ({
  page,
}) => {
  const slug = `picker_order_${Date.now()}`;
  try {
    await createRuntimeCollection(page.request, slug, [
      { name: "first_field", type: "text", label: "First field" },
      { name: "last_field", type: "text", label: "Last field" },
    ]);
    await gotoAdmin(page, `/builder/collections/${slug}`);
    await expect(page.getByTestId("field-row-last_field")).toBeVisible({
      timeout: 30_000,
    });

    // "+" between the two rows adds before the lower one; "Add and add
    // another" keeps each next field after the one before it.
    await page
      .getByRole("button", { name: "Add a field before Last field" })
      .click();
    await addField(page, "One", "Add and add another");
    await addField(page, "Two", "Add and add another");
    await addField(page, "Three", "Add field");
    // The last add opens the new field in the settings panel; close it.
    await page.getByRole("button", { name: "Close field settings" }).click();

    expect(await fieldOrder(page)).toEqual([
      "first_field",
      "one",
      "two",
      "three",
      "last_field",
    ]);

    // "/" on a field adds right after it.
    await page.getByTestId("field-row-one").focus();
    await page.keyboard.press("/");
    await addField(page, "After one", "Add field");
    await page.keyboard.press("Escape");

    expect(await fieldOrder(page)).toEqual([
      "first_field",
      "one",
      "after_one",
      "two",
      "three",
      "last_field",
    ]);
  } finally {
    await removeMigrationsOf(slug);
  }
});
