/**
 * Browser Back from an entry with unsaved edits asks before they are lost.
 *
 * Only a real browser can answer this. The guard holds a Back by hearing the
 * `popstate` before the admin's router draws the page Back was going to, and
 * which listener hears it first is the browser's decision. jsdom dispatches
 * capture listeners first, so the guard's unit tests passed while Chromium,
 * which calls `window` listeners in the order they were added, let Back leave
 * and drop the edits without a word.
 */
import { expect, test, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";

const LIST_PATH = /\/admin\/collections\/posts$/;
const EDIT_PATH = /\/admin\/collections\/posts\/(?!create$)[^/]+$/;

/**
 * The entry's Excerpt field. On the edit page the title is an inline control
 * in the document header rather than a field of the form, so the excerpt is
 * the plain field an edit goes into.
 */
const excerpt = (page: Page) =>
  page.locator("main").getByRole("textbox", { name: "Excerpt", exact: true });

/**
 * The same field while the prompt is open. The prompt is modal, so the page
 * behind it is out of the accessibility tree while it shows, though still
 * drawn, and is found among hidden elements.
 */
const excerptBehindPrompt = (page: Page) =>
  page.locator("main").getByRole("textbox", {
    name: "Excerpt",
    exact: true,
    includeHidden: true,
  });

/**
 * A saved post, opened from the list, so the entry before it in the session
 * history is the admin's own list page: Back has somewhere inside the admin to
 * go, through the router, which is the move the guard has to hold.
 */
async function openSavedPost(page: Page): Promise<string> {
  const stamp = Date.now();
  const title = `Back guard ${stamp}`;
  const saved = `excerpt as saved ${stamp}`;

  // `/create`, from `routes.ts`, not `/new`: the router remaps it.
  await gotoAdmin(page, "/collections/posts/create");
  await page.getByRole("textbox", { name: "Title", exact: true }).fill(title);
  await excerpt(page).fill(saved);
  await page.getByRole("button", { name: /save draft/i }).click();

  // Saving a new entry returns to the list rather than staying in the editor.
  await page.waitForURL(LIST_PATH, { timeout: 30_000 });
  await page.getByRole("link", { name: title }).click();
  await page.waitForURL(EDIT_PATH, { timeout: 30_000 });
  await expect(excerpt(page)).toHaveValue(saved, { timeout: 30_000 });
  return saved;
}

/** Back, started from the page as the browser's button does. */
async function goBack(page: Page): Promise<void> {
  // Not Playwright's `goBack`, which waits for the navigation the guard is
  // there to hold.
  await page.evaluate(() => window.history.back());
}

test("going Back from an entry with unsaved edits asks, Keep Editing stays, and Discard leaves", async ({
  page,
}) => {
  const saved = await openSavedPost(page);
  const editUrl = page.url();
  const edited = `${saved}, edited and not saved`;
  await excerpt(page).fill(edited);

  await goBack(page);

  const prompt = page.getByRole("alertdialog");
  await expect(prompt).toBeVisible();
  // Still the entry behind the question, with the edit in it: not the list
  // Back was going to.
  await expect(page).toHaveURL(editUrl);
  await expect(excerptBehindPrompt(page)).toHaveValue(edited);

  await prompt.getByRole("button", { name: "Keep Editing" }).click();
  await expect(prompt).toBeHidden();
  await expect(page).toHaveURL(editUrl);
  await expect(excerpt(page)).toHaveValue(edited);

  // Asked again, and this time the edit is let go.
  await goBack(page);
  await expect(prompt).toBeVisible();
  await prompt.getByRole("button", { name: "Discard Changes" }).click();

  // The Back completes, to the list it was going to.
  await page.waitForURL(LIST_PATH, { timeout: 30_000 });
  await expect(prompt).toBeHidden();

  // And nothing was saved on the way out: the entry still holds what was
  // saved, not the discarded edit.
  await page.goto(editUrl);
  await expect(excerpt(page)).toHaveValue(saved, { timeout: 30_000 });
});
