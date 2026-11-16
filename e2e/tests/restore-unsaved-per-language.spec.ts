/**
 * "Restore unsaved changes" offers only what was typed in the language being
 * edited.
 *
 * An author types in Spanish and leaves before saving, so the editor records
 * their unsaved Spanish work. Opened in English, the editor offers nothing to
 * restore; opened in Spanish again, it offers the Spanish work. The plausible
 * broken implementation offers the author's one recovery point wherever the
 * editor stands, so one click puts Spanish text in the English fields.
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

test.describe("restoring unsaved changes", () => {
  test("offers only the work typed in the language being edited", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const id = await liveAuthor(page);

    // Typed in Spanish and recorded as unsaved work, never saved.
    await gotoAdmin(page, `/collections/authors/${id}?locale=es`);
    const recorded = page.waitForResponse(
      response =>
        response.request().method() === "PUT" &&
        response.url().includes(`/entries/${id}/versions/autosave`) &&
        response.ok()
    );
    const role = page.getByLabel("Role / Title");
    await role.fill("Matemática y escritora");
    await recorded;

    // English: nothing of the Spanish work is offered.
    await gotoAdmin(page, `/collections/authors/${id}`);
    await expect(page.getByLabel("Role / Title")).toHaveValue("Mathematician");
    await expect(includingHidden(page).getByText(OFFER)).toHaveCount(0);

    // Spanish again: its own unsaved work is offered, and restores there.
    await gotoAdmin(page, `/collections/authors/${id}?locale=es`);
    await expect(page.getByText(OFFER)).toBeVisible();
    await page.getByRole("button", { name: "Restore", exact: true }).click();
    await expect(page.getByLabel("Role / Title")).toHaveValue(
      "Matemática y escritora"
    );
  });
});
