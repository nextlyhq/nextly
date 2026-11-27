/**
 * "Restore unsaved changes" belongs to the language the work was typed in.
 *
 * The editor records unsaved work in the default language, the one it edits,
 * and offers it there. An author types in English and leaves before saving:
 * the Spanish translation page shows the published English and the stored
 * Spanish, and offers nothing to restore; the English editor offers the work.
 * And what was typed on the Spanish page and left unsaved is not offered by
 * the English editor. The plausible broken implementation offers the author's
 * one recovery point wherever the document is open, so one click puts one
 * language's text in another's fields.
 *
 * Not covered, because the behaviour was removed: Spanish work recorded as it
 * was typed, and offered when the editor was opened in Spanish again. Spanish
 * was then written in the editor. It is now written on its translation page,
 * which keeps no recovery point, so there is none of its own to offer.
 *
 * @module tests/restore-unsaved-per-language
 */
import { expect, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { includingHidden, test } from "./support/test";

const AUTHORS = "/admin/api/collections/authors/entries";
const OFFER = /You have unsaved changes from/;

/** An author live in English and Spanish. */
async function liveAuthor(page: Page): Promise<string> {
  const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const created = await page.request.post(`${AUTHORS}?locale=en`, {
    data: {
      title: `Recovered author ${stamp}`,
      jobTitle: "Mathematician",
      status: "published",
    },
  });
  expect(created.ok(), `creating an author: ${created.status()}`).toBe(true);
  const id = ((await created.json()) as { item?: { id?: string } }).item?.id;
  if (typeof id !== "string") throw new Error("the new author has no id");
  const spanish = await page.request.patch(`${AUTHORS}/${id}?locale=es`, {
    data: { jobTitle: "Matemática", status: "published", _overwrite: true },
  });
  expect(spanish.ok(), `publishing Spanish: ${spanish.status()}`).toBe(true);
  return id;
}

/** The field both the editor and the translation page write. */
const role = (page: Page) =>
  page
    .locator("main")
    .getByRole("textbox", { name: "Role / Title", exact: true });

test.describe("restoring unsaved changes", () => {
  test("offers English work in the English editor, and on no other language's page", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const id = await liveAuthor(page);
    const editor = `/collections/authors/${id}`;
    const spanish = `/translations/collections/authors/${id}?locale=es`;

    // Typed on the Spanish page and left: the English editor offers nothing.
    await gotoAdmin(page, spanish);
    await expect(role(page)).toHaveValue("Matemática");
    await role(page).fill("Matemática y escritora");
    await gotoAdmin(page, editor);
    await expect(role(page)).toHaveValue("Mathematician");
    await expect(includingHidden(page).getByText(OFFER)).toHaveCount(0);

    // Typed in English and recorded as unsaved work, never saved.
    const recorded = page.waitForResponse(
      response =>
        response.request().method() === "PUT" &&
        response.url().includes(`/entries/${id}/versions/autosave`) &&
        response.ok()
    );
    await role(page).fill("Mathematician and writer");
    await recorded;

    // Spanish: nothing of the English work is offered, and it is not the text
    // shown to translate from.
    await gotoAdmin(page, spanish);
    await expect(role(page)).toHaveValue("Matemática");
    await expect(
      page
        .getByRole("group", { name: "Role / Title", exact: true })
        .locator('[data-slot="translation-source"] [lang="en"]')
    ).toHaveText("Mathematician");
    await expect(includingHidden(page).getByText(OFFER)).toHaveCount(0);

    // English again: its own unsaved work is offered, and restores there.
    await gotoAdmin(page, editor);
    await expect(page.getByText(OFFER)).toBeVisible();
    await page.getByRole("button", { name: "Restore", exact: true }).click();
    await expect(role(page)).toHaveValue("Mathematician and writer");
  });
});
