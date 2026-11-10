/**
 * An editor who takes a Single back after it changed while they were away
 * sees the current copy, keeps their unsaved edits recoverable, and is told
 * who changed it and when.
 *
 * A has unsaved edits when a second editor takes the Single over and writes
 * it. A's take-back claim carries the version A's edits began from, so the
 * answer says what changed; A's form keeps the edits as a recovery point and
 * shows the current version before it unlocks. Two browser contexts signed in
 * as two users: the lock is held per user.
 *
 * @module tests/single-lock-take-back
 */
import { expect, type Page } from "@playwright/test";

import { freeDocument, test } from "./support/test";
import { uniqueTag } from "./support/accounts";
import { gotoAdmin } from "./support/admin";
import { EVERY_DIALECT } from "./support/every-dialect";
import { LOCK } from "./support/locks";
import { claimedBy, SECOND_EDITOR, secondEditor } from "./support/two-editors";

// Shares state with other specs; see support/locks.ts for what each lock guards.
test.describe.configure({ lock: [LOCK.siteSettings, LOCK.usersRoles] });

const SINGLE_API = "/admin/api/singles/site-settings";

function tagline(page: Page) {
  return page.getByRole("textbox", { name: "Tagline", exact: true });
}

test.describe(
  "an editor who takes back a changed Single starts from the current copy",
  { tag: EVERY_DIALECT },
  () => {
    test.describe.configure({ timeout: 150_000 });

    test("taking back a changed Single shows the current copy, keeps the edits recoverable and names who changed it and when", async ({
      page,
      browser,
      baseURL,
    }) => {
      // The Single is shared with other specs, which may leave it held.
      await freeDocument(page.request, "siteSettings");
      await gotoAdmin(page, "/singles/site-settings");
      await expect(tagline(page)).toBeEditable({ timeout: 30_000 });
      const read = await page.request.get(SINGLE_API);
      expect(read.ok(), await read.text()).toBe(true);
      const single = (await read.json()) as { id: string };
      await claimedBy(page.request, {
        scopeKind: "single",
        slug: "site-settings",
        entryId: single.id,
      });
      const mine = `A's unsaved tagline ${uniqueTag()}`;
      await tagline(page).fill(mine);

      const other = await secondEditor(browser, page, baseURL);
      try {
        await gotoAdmin(other.page, "/singles/site-settings");
        await other.page.getByRole("button", { name: "Take over" }).click({
          timeout: 30_000,
        });
        await expect(page.getByText(/took over this document/)).toBeVisible({
          timeout: 45_000,
        });
        const theirs = `Written by the second editor ${uniqueTag()}`;
        const written = await other.page.request.patch(SINGLE_API, {
          data: { tagline: theirs, _overwrite: true },
        });
        expect(written.ok(), await written.text()).toBe(true);

        await page.getByRole("button", { name: "Take it back" }).click();
        await expect(
          page
            .getByTestId("document-lock-banner")
            .filter({ hasText: `${SECOND_EDITOR} changed this document at` })
        ).toContainText("while you were away", { timeout: 30_000 });
        await expect(tagline(page)).toHaveValue(theirs, { timeout: 30_000 });
        await expect(tagline(page)).toBeEditable();
        await page.getByRole("button", { name: "Restore" }).click({
          timeout: 30_000,
        });
        await expect(tagline(page)).toHaveValue(mine, { timeout: 30_000 });
      } finally {
        await other.context.close();
      }
    });
  }
);
