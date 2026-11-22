/**
 * Publishing from the editor, an editor chooses the languages and, separately, the shared fields.
 *
 * On a localized author with English and Spanish drafts, the Publish split's "Choose what to
 * publish…" opens a choice of each language and of the shared fields, with the language being
 * edited chosen. Choosing Spanish alone and publishing puts Spanish live and leaves English a
 * draft. The plausible broken menus publish every language, or the language on screen whatever
 * was chosen, or offer no separate choice for the shared fields.
 *
 * @module tests/publish-menu-chooses-parts
 */
import { expect, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { test } from "./support/test";

const AUTHORS = "/admin/api/collections/authors/entries";

/** A never-published author with a draft in English and in Spanish. */
async function draftAuthor(page: Page): Promise<string> {
  const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const created = await page.request.post(`${AUTHORS}?locale=en`, {
    data: { title: `Draft author ${stamp}`, jobTitle: "Mathematician" },
  });
  expect(created.ok(), `creating an author: ${created.status()}`).toBe(true);
  const id = ((await created.json()) as { item?: { id?: string } }).item?.id;
  if (typeof id !== "string") throw new Error("the new author has no id");
  const spanish = await page.request.patch(`${AUTHORS}/${id}?locale=es`, {
    data: { jobTitle: "Matemática", _overwrite: true },
  });
  expect(spanish.ok(), `saving Spanish: ${spanish.status()}`).toBe(true);
  return id;
}

/** Each language's status, as the editor's language overview reads it. */
async function statusByLanguage(
  page: Page,
  id: string
): Promise<Record<string, string | undefined>> {
  const read = await page.request.get(
    `${AUTHORS}/${id}?locale=en&translation-status=1&status=all`
  );
  expect(read.ok(), `reading the author: ${read.status()}`).toBe(true);
  const translations = (
    (await read.json()) as {
      _translations?: Record<string, { status?: string }>;
    }
  )._translations;
  if (!translations) throw new Error("the read carries no language overview");
  return Object.fromEntries(
    Object.entries(translations).map(([locale, meta]) => [locale, meta.status])
  );
}

test.describe("choosing what to publish", () => {
  test("publishes the languages chosen, and offers the shared fields as a choice of their own", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const id = await draftAuthor(page);
    await gotoAdmin(page, `/collections/authors/${id}`);

    await page.getByRole("button", { name: "More ways to publish" }).click();
    await page
      .getByRole("menuitem", { name: /Choose what to publish/ })
      .click();
    const dialog = page.getByRole("dialog", { name: "Choose what to publish" });

    // Each language, and the shared fields, is a choice of its own; the one on screen is chosen.
    const english = dialog.getByRole("checkbox", { name: "English" });
    const spanish = dialog.getByRole("checkbox", { name: "Spanish" });
    const shared = dialog.getByRole("checkbox", { name: "Shared fields" });
    await expect(english).toBeChecked();
    await expect(spanish).not.toBeChecked();
    await expect(shared).toBeVisible();

    await english.click();
    await spanish.click();
    // What Spanish will do, as the server describes exactly this choice.
    await expect(spanish).toHaveAccessibleDescription(
      /Goes live for the first time/
    );

    await dialog.getByRole("button", { name: "Publish", exact: true }).click();
    await expect(dialog).toBeHidden();

    const statuses = await statusByLanguage(page, id);
    expect(statuses.es).toBe("published");
    expect(statuses.en).not.toBe("published");
  });
});
