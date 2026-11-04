/**
 * Two people and one entry: an editor who gains the entry starts from the
 * copy that was saved while they waited.
 *
 * B opens the entry while A holds it, so B's form is read-only over the copy
 * read then. A saves. When B gains the entry, by A leaving or by B taking it
 * over, B's form must show what A saved before it lets B type: unlocked over
 * the copy from before, B's next save would put it back over A's work.
 *
 * B's read of the entry after the gain is held until the test lets it go, so
 * the form is seen read-only while the latest version is on its way, and then
 * editable with A's value. When that read fails, B's form stays, read-only,
 * and B can try again. Two browser contexts signed in as two users: the
 * lock is held per user, so one user in two tabs is one holder.
 *
 * @module tests/entry-lock-fresh-copy
 */
import { expect, type Page } from "@playwright/test";

import { test } from "./support/test";
import { uniqueTag } from "./support/accounts";
import { gotoAdmin } from "./support/admin";
import { EVERY_DIALECT } from "./support/every-dialect";
import { LOCK } from "./support/locks";
import { claimedBy, SECOND_EDITOR, secondEditor } from "./support/two-editors";

// Creates a second user; see support/locks.ts for what each lock guards. The
// entry itself is this file's own, created under a unique name.
test.describe.configure({ lock: [LOCK.usersRoles] });

const ENTRIES = "/admin/api/collections/posts/entries";
const BEFORE = "Read while A held it";
const SAVED = "Saved by A while B waited";

/** A post of this test's own, returning its id. */
async function createPost(page: Page): Promise<string> {
  const tag = uniqueTag();
  const created = await page.request.post(ENTRIES, {
    data: {
      title: `Fresh copy ${tag}`,
      slug: `fresh-copy-${tag}`,
      excerpt: BEFORE,
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
 * Hold the page's reads of the entry until the returned release is called,
 * and say when the first one is asked for. Only the document's own reads: its
 * recovery points and other sub-resources carry more path after the id.
 */
async function holdEntryReads(page: Page, id: string) {
  const read = new RegExp(`${ENTRIES}/${id}(?:\\?|$)`);
  let release: () => void = () => {};
  const released = new Promise<void>(resolve => {
    release = resolve;
  });
  await page.route(read, async route => {
    if (route.request().method() !== "GET") return route.continue();
    await released;
    await route.continue();
  });
  const asked = page.waitForRequest(
    request => request.method() === "GET" && read.test(request.url()),
    // A beat, and a margin: the editor learns it has the entry on its next
    // claim, which runs every 15 seconds.
    { timeout: 45_000 }
  );
  return { asked, release };
}

/** A saves the excerpt through its own form. */
async function saveAsA(page: Page, id: string): Promise<void> {
  await excerpt(page).fill(SAVED);
  const saved = page.waitForResponse(
    response =>
      response.url().includes(`${ENTRIES}/${id}`) &&
      response.request().method() === "PATCH",
    { timeout: 30_000 }
  );
  await page.getByRole("button", { name: /save draft/i }).click();
  expect((await saved).ok(), "A's save must be stored").toBe(true);
}

/**
 * Fail the page's reads of the entry, as an unreachable server would, until
 * the returned stop is called.
 */
async function failEntryReads(page: Page, id: string) {
  const read = new RegExp(`${ENTRIES}/${id}(?:\\?|$)`);
  let failing = true;
  await page.route(read, async route => {
    if (!failing || route.request().method() !== "GET") {
      return route.continue();
    }
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "SERVICE_UNAVAILABLE",
          message: "The server could not be reached.",
          requestId: "e2e",
        },
      }),
    });
  });
  return {
    stop: () => {
      failing = false;
    },
  };
}

test.describe(
  "an editor who gains an entry starts from the saved copy",
  { tag: EVERY_DIALECT },
  () => {
    // Two sessions, and a lock heartbeat the gain waits on.
    test.describe.configure({ timeout: 120_000 });

    for (const way of ["leaves", "takes over"] as const) {
      const title =
        way === "leaves"
          ? "B sees A's saved value before the form unlocks after A leaves"
          : "B sees A's saved value before the form unlocks after B takes over";

      test(title, async ({ page, browser, baseURL }) => {
        const id = await createPost(page);
        await gotoAdmin(page, `/collections/posts/${id}`);
        await expect(excerpt(page)).toBeEditable({ timeout: 30_000 });
        // A's claim has landed before B arrives, so B finds it held by A.
        expect(
          await claimedBy(page.request, {
            scopeKind: "collection",
            slug: "posts",
            entryId: id,
          })
        ).not.toBe(SECOND_EDITOR);

        const other = await secondEditor(browser, page, baseURL);
        try {
          await gotoAdmin(other.page, `/collections/posts/${id}`);
          await expect(
            other.page.getByText(/is editing this document/)
          ).toBeVisible({ timeout: 30_000 });
          await expect(excerpt(other.page)).toHaveValue(BEFORE);
          await expect(excerpt(other.page)).not.toBeEditable();

          await saveAsA(page, id);

          // Armed before the gain, so the read that follows it is held.
          const reads = await holdEntryReads(other.page, id);
          if (way === "leaves") {
            // Leaving inside the admin, which releases the claim as the
            // editor unmounts.
            await page
              .getByRole("navigation", { name: "Breadcrumb" })
              .locator('a[href="/admin/collections/posts"]')
              .click();
            await page.waitForURL(/\/collections\/posts$/);
          } else {
            await other.page.getByRole("button", { name: "Take over" }).click();
          }

          // The latest version is asked for, and until it is in, B still
          // cannot type over the copy from before.
          await reads.asked;
          await expect(
            other.page.getByText(/Loading the latest version/)
          ).toBeVisible();
          await expect(excerpt(other.page)).not.toBeEditable();

          reads.release();
          await expect(excerpt(other.page)).toHaveValue(SAVED, {
            timeout: 30_000,
          });
          await expect(excerpt(other.page)).toBeEditable();
        } finally {
          await other.context.close();
        }
      });
    }

    test("B stays read-only, and can try again, when the saved value cannot be loaded after B takes over", async ({
      page,
      browser,
      baseURL,
    }) => {
      const id = await createPost(page);
      await gotoAdmin(page, `/collections/posts/${id}`);
      await expect(excerpt(page)).toBeEditable({ timeout: 30_000 });
      expect(
        await claimedBy(page.request, {
          scopeKind: "collection",
          slug: "posts",
          entryId: id,
        })
      ).not.toBe(SECOND_EDITOR);

      const other = await secondEditor(browser, page, baseURL);
      try {
        await gotoAdmin(other.page, `/collections/posts/${id}`);
        await expect(
          other.page.getByText(/is editing this document/)
        ).toBeVisible({ timeout: 30_000 });
        await saveAsA(page, id);

        // B's reads of the entry fail from here until the test lets them
        // through, as they would with the server out of reach.
        const failing = await failEntryReads(other.page, id);
        await other.page.getByRole("button", { name: "Take over" }).click();

        // The editor stays, read-only over the copy from before, and says so;
        // it is not replaced by the page's "couldn't be loaded" error.
        await expect(
          other.page.getByText(/couldn't load the latest version/)
        ).toBeVisible({ timeout: 45_000 });
        await expect(excerpt(other.page)).toHaveValue(BEFORE);
        await expect(excerpt(other.page)).not.toBeEditable();

        failing.stop();
        await other.page.getByRole("button", { name: "Try again" }).click();
        await expect(excerpt(other.page)).toHaveValue(SAVED, {
          timeout: 30_000,
        });
        await expect(excerpt(other.page)).toBeEditable();
      } finally {
        await other.context.close();
      }
    });
  }
);
