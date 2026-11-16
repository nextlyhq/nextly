/**
 * The first save of a new entry keeps the author on what they made.
 *
 * Asked of the address bar and the history, because that is where the
 * property lives: the form could show the saved values under the create
 * address, which a refresh would then turn back into an empty form. So each
 * case checks the address is the entry's own, that a refresh opens the entry
 * there, and that Back leaves for the list the author came from rather than
 * returning to the empty create form.
 *
 * Posts has drafts (Save draft, Publish); Tags has none (one save button,
 * "Create" on a new entry). The same path for both, since the create page
 * has one success handler for every collection.
 */
import { expect, type Page } from "@playwright/test";

import { test } from "./support/test";
import { gotoAdmin } from "./support/admin";

interface Case {
  collection: string;
  singular: string;
  /** The button the author presses on the new entry's form. */
  button: string;
}

const CASES: Case[] = [
  { collection: "posts", singular: "Post", button: "Save draft" },
  { collection: "posts", singular: "Post", button: "Publish" },
  // Without drafts the form's one save button reads "Create" until the
  // entry exists.
  { collection: "tags", singular: "Tag", button: "Create" },
];

const title = (page: Page) =>
  page.locator("main").getByRole("textbox", { name: "Title", exact: true });

for (const { collection, singular, button } of CASES) {
  test(`${button} on a new ${singular.toLowerCase()} stays on it at its own address`, async ({
    page,
  }) => {
    const listPath = new RegExp(`/admin/collections/${collection}$`);
    const createPath = new RegExp(`/admin/collections/${collection}/create$`);
    const entryPath = new RegExp(
      `/admin/collections/${collection}/(?!create$)[^/?#]+$`
    );
    const name = `Stays ${singular} ${button} ${Date.now()}`;

    // From the list, as an author starts, so the history has the list behind
    // the create form.
    await gotoAdmin(page, `/collections/${collection}`);
    await page
      .getByRole("button", { name: `New ${singular}`, exact: true })
      .click();
    await expect(page).toHaveURL(createPath);

    // The slug is made from the title, so the title alone saves.
    await title(page).fill(name);
    await page.getByRole("button", { name: button, exact: true }).click();

    // The entry's own address, with the confirmation shown there and the
    // saved value in the form.
    await page.waitForURL(entryPath, { timeout: 30_000 });
    await expect(page.getByText("Entry created successfully")).toBeVisible();
    await expect(title(page)).toHaveValue(name, { timeout: 30_000 });
    const entryUrl = page.url();

    // A refresh opens the same entry: the address is real.
    await page.reload();
    await expect(page).toHaveURL(entryUrl);
    await expect(title(page)).toHaveValue(name, { timeout: 30_000 });

    // The create form was replaced, not stacked: Back goes to the list.
    await page.evaluate(() => window.history.back());
    await page.waitForURL(listPath, { timeout: 30_000 });
    await expect(page).not.toHaveURL(createPath);
  });
}
