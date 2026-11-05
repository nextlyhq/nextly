/**
 * An editor who takes an entry back, or regains it after losing it, and finds
 * it changed while they were away, sees the current copy, keeps their unsaved
 * edits recoverable, and is told who changed it and when.
 *
 * A has unsaved edits when the entry is taken from them: by a second editor
 * taking it over, or by A's claim ending under them. The second editor then
 * saves. A's take-back claim carries the version A's edits began from, so the
 * answer says what changed; A's form keeps the edits as a recovery point and
 * shows the current version before it unlocks, and the recovery offer gives
 * the edits back. Two browser contexts signed in as two users: the lock is
 * held per user.
 *
 * @module tests/entry-lock-take-back
 */
import { expect, type Page } from "@playwright/test";

import { test } from "./support/test";
import { uniqueTag } from "./support/accounts";
import { gotoAdmin } from "./support/admin";
import { EVERY_DIALECT } from "./support/every-dialect";
import { LOCK } from "./support/locks";
import {
  claimedBy,
  claimToken,
  SECOND_EDITOR,
  secondEditor,
} from "./support/two-editors";

// Creates a second user; see support/locks.ts for what each lock guards. The
// entry itself is this file's own, created under a unique name.
test.describe.configure({ lock: [LOCK.usersRoles] });

const ENTRIES = "/admin/api/collections/posts/entries";

/** A post of this test's own, returning its id. */
async function createPost(page: Page): Promise<string> {
  const tag = uniqueTag();
  const created = await page.request.post(ENTRIES, {
    data: {
      title: `Take back ${tag}`,
      slug: `take-back-${tag}`,
      excerpt: "As A opened it",
    },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const { item } = (await created.json()) as { item: { id: string } };
  return String(item.id);
}

function excerpt(page: Page) {
  return page.getByRole("textbox", { name: "Excerpt", exact: true });
}

/**
 * A takes the entry back, and is shown the second editor's saved value, told
 * who changed it while A was away, and offered A's edits back.
 */
async function takeBackAndSeeTheirs(
  page: Page,
  theirs: string,
  mine: string
): Promise<void> {
  await page.getByRole("button", { name: "Take it back" }).click();
  await expect(
    page
      .getByTestId("document-lock-banner")
      .filter({ hasText: `${SECOND_EDITOR} changed this document at` })
  ).toContainText("while you were away", { timeout: 30_000 });
  await expect(excerpt(page)).toHaveValue(theirs, { timeout: 30_000 });
  await expect(excerpt(page)).toBeEditable();

  // The edits A had on screen come back from the recovery point.
  await page.getByRole("button", { name: "Restore" }).click({
    timeout: 30_000,
  });
  await expect(excerpt(page)).toHaveValue(mine, { timeout: 30_000 });
}

test.describe(
  "an editor who takes back a changed entry starts from the current copy",
  { tag: EVERY_DIALECT },
  () => {
    // Two sessions, and lock heartbeats the hand-overs wait on.
    test.describe.configure({ timeout: 150_000 });

    test("taking back a changed entry shows the current copy, keeps the edits recoverable and names who changed it and when", async ({
      page,
      browser,
      baseURL,
    }) => {
      const id = await createPost(page);
      await gotoAdmin(page, `/collections/posts/${id}`);
      await expect(excerpt(page)).toBeEditable({ timeout: 30_000 });
      await claimedBy(page.request, {
        scopeKind: "collection",
        slug: "posts",
        entryId: id,
      });
      const mine = `A's unsaved words ${uniqueTag()}`;
      await excerpt(page).fill(mine);

      const other = await secondEditor(browser, page, baseURL);
      try {
        await gotoAdmin(other.page, `/collections/posts/${id}`);
        await other.page.getByRole("button", { name: "Take over" }).click({
          timeout: 30_000,
        });
        // A learns on its next beat.
        await expect(page.getByText(/took over this document/)).toBeVisible({
          timeout: 45_000,
        });

        const theirs = `Saved by the second editor ${uniqueTag()}`;
        await expect(excerpt(other.page)).toBeEditable({ timeout: 30_000 });
        await excerpt(other.page).fill(theirs);
        const saved = other.page.waitForResponse(
          response =>
            response.url().includes(`${ENTRIES}/${id}`) &&
            response.request().method() === "PATCH",
          { timeout: 30_000 }
        );
        await other.page.getByRole("button", { name: /save draft/i }).click();
        expect((await saved).ok(), "the second editor's save").toBe(true);

        await takeBackAndSeeTheirs(page, theirs, mine);
      } finally {
        await other.context.close();
      }
    });

    test("regaining a lapsed claim on a changed entry does the same", async ({
      page,
      browser,
      baseURL,
    }) => {
      const id = await createPost(page);
      const ref = {
        scopeKind: "collection" as const,
        slug: "posts",
        entryId: id,
      };
      // The page's clock, so its heartbeat can be held while the claim ends.
      await page.clock.install();
      await gotoAdmin(page, `/collections/posts/${id}`);
      await expect(excerpt(page)).toBeEditable({ timeout: 30_000 });
      await claimedBy(page.request, ref);
      const mine = `A's unsaved words ${uniqueTag()}`;
      await excerpt(page).fill(mine);

      // A's claim ends under the editor, as a lapse ends it: replaced, then
      // released, so A's next beat finds nobody holding the entry. The beat
      // is held meanwhile: one landing between the two would find A's own
      // newer claim and read as A's other tab, not as an ended claim.
      await page.clock.pauseAt(Date.now() + 1_000);
      // A beat already on its way lands before the claim is replaced.
      await page.waitForTimeout(2_000);
      const token = await claimToken(page.request, ref);
      const released = await page.request.delete("/admin/api/document-lock", {
        data: { ...ref, claimToken: token },
      });
      expect(released.ok(), await released.text()).toBe(true);
      await page.clock.resume();
      await expect(page.getByText(/claim on this document ended/)).toBeVisible({
        timeout: 45_000,
      });

      const other = await secondEditor(browser, page, baseURL);
      try {
        const theirs = `Written while A was away ${uniqueTag()}`;
        const written = await other.page.request.patch(`${ENTRIES}/${id}`, {
          data: { excerpt: theirs },
        });
        expect(written.ok(), await written.text()).toBe(true);

        await takeBackAndSeeTheirs(page, theirs, mine);
      } finally {
        await other.context.close();
      }
    });
  }
);
