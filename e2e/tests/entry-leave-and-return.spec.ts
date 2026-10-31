/**
 * Leaving an edited entry, opening another and coming back: only the page on
 * screen decides what navigation does.
 *
 * Under Cache Components Next.js keeps a visited admin page mounted but hidden,
 * with its state. The entry left behind still holds its unsaved-changes guard,
 * which patches `history` while its form is dirty. Hidden, it must not ask about
 * leaving the entry on screen, nor keep the work it was told to discard; shown
 * again, it must show the entry as saved.
 */
import { expect, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { test } from "./support/test";

const API = "/admin/api";
const LIST_PATH = /\/admin\/collections\/posts$/;

/** The entry's Excerpt field: a plain field of the form, on the edit page. */
const excerpt = (page: Page) =>
  page.locator("main").getByRole("textbox", { name: "Excerpt", exact: true });

/** Back, started as the browser's button does, not by waiting for a load. */
async function back(page: Page): Promise<void> {
  await page.evaluate(() => window.history.back());
}

/** A saved post, written through the API, named by `stamp`. */
async function savedPost(
  page: Page,
  name: string,
  stamp: number
): Promise<{ title: string; saved: string }> {
  const title = `Leave and return ${name} ${stamp}`;
  const saved = `${name} as saved ${stamp}`;
  const response = await page.request.post(`${API}/collections/posts/entries`, {
    data: {
      title,
      slug: `leave-and-return-${name.toLowerCase()}-${stamp}`,
      excerpt: saved,
    },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return { title, saved };
}

/** Open a post from the list, so Back from it returns to the list. */
async function openFromList(page: Page, title: string): Promise<void> {
  await page.getByRole("link", { name: title }).click();
  await expect(page).not.toHaveURL(LIST_PATH, { timeout: 30_000 });
}

test("an entry left with its edits discarded neither asks again nor keeps them", async ({
  page,
}) => {
  const stamp = Date.now();
  const first = await savedPost(page, "First", stamp);
  const second = await savedPost(page, "Second", stamp);
  const prompt = page.getByRole("alertdialog");

  await gotoAdmin(page, "/collections/posts");
  await openFromList(page, first.title);
  await expect(excerpt(page)).toHaveValue(first.saved, { timeout: 30_000 });
  const firstUrl = page.url();

  // Edited, then left by Back: the entry on screen asks, and the edit goes.
  await excerpt(page).fill(`${first.saved}, edited and discarded`);
  await back(page);
  await expect(prompt).toBeVisible();
  await prompt.getByRole("button", { name: "Discard Changes" }).click();
  await page.waitForURL(LIST_PATH, { timeout: 30_000 });

  // Another entry, opened and left untouched: nothing asks about the first
  // one's edit, which may still be mounted, hidden, with its guard.
  await openFromList(page, second.title);
  await expect(excerpt(page)).toHaveValue(second.saved, { timeout: 30_000 });
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Dashboard" })
    .click();
  await expect(page).toHaveURL(/\/admin$/, { timeout: 30_000 });
  await expect(prompt).toHaveCount(0);

  // The second entry's own guard still asks, while it is on screen.
  await back(page);
  await expect(excerpt(page)).toHaveValue(second.saved, { timeout: 30_000 });
  await excerpt(page).fill(`${second.saved}, edited`);
  await back(page);
  await expect(prompt).toBeVisible();
  await prompt.getByRole("button", { name: "Discard Changes" }).click();
  await page.waitForURL(LIST_PATH, { timeout: 30_000 });

  // The first entry again, opened from the list: as saved, the discarded edit
  // gone, and nothing asks on the way in.
  await openFromList(page, first.title);
  await expect(page).toHaveURL(firstUrl, { timeout: 30_000 });
  await expect(excerpt(page)).toHaveValue(first.saved, { timeout: 30_000 });
  await expect(prompt).toHaveCount(0);
});
