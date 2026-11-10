/**
 * Edits restored from a recovery point, or kept on screen from before the
 * editor was displaced, are saved as edits of the version they began from.
 *
 * Restoring a point takes back the version its edits began from, and taking a
 * document back after a takeover keeps the edits as such a point. A save of either, after someone else saved in between, is refused as
 * a conflict rather than replacing that work.
 *
 * @module tests/recovery-point-conflict
 */
import { expect, request, type Page } from "@playwright/test";

import {
  createSignedInUser,
  superAdminRoleId,
  uniqueTag,
} from "./support/accounts";
import { gotoAdmin } from "./support/admin";
import { EVERY_DIALECT } from "./support/every-dialect";
import { LOCK } from "./support/locks";
import { createEntry } from "./support/runtime-collection";
import { test } from "./support/test";
import { claimedBy, secondEditor, SECOND_EDITOR } from "./support/two-editors";

test.describe.configure({ lock: [LOCK.usersRoles] });

const POSTS = "/admin/api/collections/posts/entries";
const AUTOSAVE = /\/collections\/posts\/entries\/[^/]+\/versions\/autosave$/;
const CONFLICT = /changed since you started editing/i;

const excerpt = (page: Page) =>
  page.locator("main").getByRole("textbox", { name: "Excerpt", exact: true });

async function post(page: Page): Promise<string> {
  const tag = uniqueTag();
  return createEntry(page.request, "posts", {
    title: `Recovered ${tag}`,
    slug: `recovered-${tag}`,
    excerpt: "Stored",
  });
}

const save = (page: Page) =>
  page
    .getByRole("button", { name: /^Save( draft)?$/ })
    .first()
    .click();

test.describe(
  "saving edits that began from an older version",
  { tag: EVERY_DIALECT },
  () => {
    test.describe.configure({ timeout: 180_000 });

    test("saving restored older edits gets the conflict", async ({
      page,
      baseURL,
    }) => {
      const id = await post(page);
      await gotoAdmin(page, `/collections/posts/${id}`);
      await expect(excerpt(page)).toBeEditable({ timeout: 30_000 });

      // A recovery point of unsaved edits.
      const recorded = page.waitForResponse(
        r => AUTOSAVE.test(r.url()) && r.request().method() === "PUT",
        { timeout: 30_000 }
      );
      const mine = `Mine ${uniqueTag()}`;
      await excerpt(page).fill(mine);
      expect((await recorded).ok()).toBe(true);

      // Someone else saves the post meanwhile, through the API.
      const tag = uniqueTag();
      const { storageState } = await createSignedInUser(
        page.request,
        baseURL ?? "",
        {
          email: `recovery-other-${tag}@nextly.local`,
          name: `Other ${tag}`,
          roleIds: [await superAdminRoleId(page.request)],
        }
      );
      const other = await request.newContext({ baseURL, storageState });
      try {
        const written = await other.patch(`${POSTS}/${id}`, {
          data: { excerpt: "Theirs", _overwrite: true },
        });
        expect(written.ok(), await written.text()).toBe(true);

        // Opened again: the current version, and the older edits offered.
        await gotoAdmin(page, `/collections/posts/${id}`);
        await expect(excerpt(page)).toHaveValue("Theirs", { timeout: 30_000 });
        const offer = page.getByRole("status").filter({
          hasText: /These edits began from an older version/,
        });
        await expect(offer).toContainText(`Other ${tag}`, { timeout: 30_000 });
        await offer.getByRole("button", { name: "Restore" }).click();
        const confirm = page.getByRole("alertdialog");
        if (await confirm.isVisible().catch(() => false)) {
          await confirm.getByRole("button", { name: /restore/i }).click();
        }
        await expect(excerpt(page)).toHaveValue(mine, { timeout: 30_000 });

        // Saved as edits of the version they began from: refused.
        await save(page);
        const conflict = page.getByRole("alertdialog", { name: CONFLICT });
        await expect(conflict).toBeVisible({ timeout: 30_000 });
        await expect(conflict).toContainText(`Other ${tag}`);
        // Kept on screen once the editor goes on editing.
        await conflict.getByRole("button", { name: "Keep editing" }).click();
        await expect(excerpt(page)).toHaveValue(mine);
      } finally {
        await other.dispose();
      }
    });

    test("saving edits kept from before a takeover gets the conflict", async ({
      page,
      browser,
      baseURL,
    }) => {
      const id = await post(page);
      const address = `/collections/posts/${id}`;
      await gotoAdmin(page, address);
      await expect(excerpt(page)).toBeEditable({ timeout: 30_000 });
      await claimedBy(page.request, {
        scopeKind: "collection",
        slug: "posts",
        entryId: id,
      });
      const mine = `Kept ${uniqueTag()}`;
      await excerpt(page).fill(mine);

      // A second editor takes it over and saves a change of their own.
      const second = await secondEditor(browser, page, baseURL);
      try {
        await gotoAdmin(second.page, address);
        await second.page.getByRole("button", { name: "Take over" }).click();
        await expect(excerpt(second.page)).toBeEditable({ timeout: 45_000 });
        await excerpt(second.page).fill("Saved by the second editor");
        const stored = second.page.waitForResponse(
          r =>
            r.url().includes(`${POSTS}/${id}`) &&
            r.request().method() === "PATCH",
          { timeout: 30_000 }
        );
        await save(second.page);
        expect((await stored).ok()).toBe(true);

        // The first takes it back: the current version on screen, the edits
        // kept as a recovery point.
        await page
          .getByRole("button", { name: "Take it back" })
          .click({ timeout: 60_000 });
        await expect(
          page
            .getByTestId("document-lock-banner")
            .filter({ hasText: `${SECOND_EDITOR} changed this document at` })
        ).toContainText("while you were away", { timeout: 45_000 });
        await expect(excerpt(page)).toHaveValue("Saved by the second editor", {
          timeout: 45_000,
        });
        await expect(excerpt(page)).toBeEditable({ timeout: 45_000 });
        await page
          .getByRole("button", { name: "Restore" })
          .click({ timeout: 30_000 });
        await expect(excerpt(page)).toHaveValue(mine, { timeout: 30_000 });

        // Saved as edits of the version they began from: refused, naming the
        // second editor.
        await save(page);
        const conflict = page.getByRole("alertdialog", { name: CONFLICT });
        await expect(conflict).toBeVisible({ timeout: 30_000 });
        await expect(conflict).toContainText(SECOND_EDITOR);
        await conflict.getByRole("button", { name: "Keep editing" }).click();
        await expect(excerpt(page)).toHaveValue(mine);
      } finally {
        await second.context.close();
      }
    });
  }
);
