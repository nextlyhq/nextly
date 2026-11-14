/**
 * Restoring a version puts its values back into the editor, and stores
 * nothing until the person saves.
 *
 * A published note is saved twice through the API, every field changed. The
 * person opens its first version, chooses "Restore…", keeps two of the fields
 * chosen, and restores them: the editor holds them as unsaved edits, and Undo
 * puts the current values back. Restored again and saved, the save records
 * where the two values came from, and the note is still published.
 */
import { expect, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { test } from "./support/test";

const ENTRIES = "/admin/api/collections/history-notes/entries";

/** A published note, then every field changed: versions 1 and 2. */
async function noteSavedTwice(page: Page): Promise<string> {
  const stamp = Date.now();
  const created = await page.request.post(ENTRIES, {
    data: {
      title: `Restore note ${stamp}`,
      summary: "first summary",
      details: { subtitle: "first subtitle", byline: "Ana" },
      status: "published",
    },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const { item } = (await created.json()) as { item: { id: string } };
  const updated = await page.request.patch(`${ENTRIES}/${item.id}`, {
    data: {
      title: `Restore note ${stamp} again`,
      summary: "second summary",
      details: { subtitle: "second subtitle", byline: "Bo" },
      status: "published",
      _overwrite: true,
    },
  });
  expect(updated.ok(), await updated.text()).toBe(true);
  return item.id;
}

/** Open History on the note and show its first version. */
async function showFirstVersion(page: Page, id: string): Promise<void> {
  await gotoAdmin(page, `/collections/history-notes/${id}?history=1`);
  const first = page.getByRole("button", { name: /Version 1\b/ });
  await expect(first).toBeVisible({ timeout: 30_000 });
  await first.click();
  await expect(page.getByRole("region", { name: "Comparison" })).toBeVisible({
    timeout: 30_000,
  });
}

/** Choose "Restore…", keep the title and summary, and restore them. */
async function restoreTitleAndSummary(page: Page): Promise<void> {
  // In the admin's top bar, where an open document draws its controls.
  await page
    .getByRole("banner")
    .getByRole("button", { name: "Restore this version" })
    .click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog.getByText(/Restore from version 1/)).toBeVisible();
  await dialog.getByRole("checkbox", { name: "Details" }).click();
  await dialog.getByRole("button", { name: "Restore 2 fields" }).click();
}

const summaryBox = (page: Page) =>
  page.getByRole("textbox", { name: "Summary", exact: true });

test.describe("restoring a version into the editor", () => {
  test("puts two fields back as unsaved edits, undoes, and records their source on save", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const id = await noteSavedTwice(page);
    await showFirstVersion(page, id);

    await restoreTitleAndSummary(page);
    const toast = page.getByText(/^2 fields restored from /);
    await expect(toast).toBeVisible();
    await expect(summaryBox(page)).toHaveValue("first summary");

    // Undo puts the current values back.
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(summaryBox(page)).toHaveValue("second summary");

    // Restored again, then saved: the person's own write. A note holds no
    // draft: it embeds the localized SEO field group, and a document with a
    // localized field group keeps no pending changes, so its leading action
    // is "Save changes" and the write goes to the live note.
    await showFirstVersion(page, id);
    await restoreTitleAndSummary(page);
    await expect(summaryBox(page)).toHaveValue("first summary");
    const saved = page.waitForResponse(
      response =>
        response.url().includes(`/entries/${id}`) &&
        response.request().method() === "PATCH"
    );
    await page
      .getByRole("banner")
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    expect((await saved).ok()).toBe(true);

    // The save records where the two values came from.
    const history = await page.request.get(`${ENTRIES}/${id}/versions`);
    expect(history.ok(), await history.text()).toBe(true);
    const { items } = (await history.json()) as {
      items: { versionNo: number; fieldSources?: Record<string, number> }[];
    };
    expect(items[0]?.fieldSources).toEqual({ title: 1, summary: 1 });

    // And the note stays published, now holding the restored values: the
    // save neither unpublished it nor kept the values it replaced.
    const live = await page.request.get(`${ENTRIES}/${id}`);
    expect(live.ok(), await live.text()).toBe(true);
    // A read answers with the document itself.
    const item = (await live.json()) as { status: string; summary: string };
    expect(item).toMatchObject({
      status: "published",
      summary: "first summary",
    });
  });
});
