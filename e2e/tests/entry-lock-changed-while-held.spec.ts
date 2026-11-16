/**
 * An editor holding a document is told, within one heartbeat, that someone
 * else changed it, naming who, before they save.
 *
 * A holds the document in the editor; a second editor writes it through the
 * REST API, as a script would. A's next heartbeat carries the version A's copy
 * started from, and its answer says the document changed. With unsaved edits
 * on screen, A is told and offered to load the current version, which keeps
 * the edits as a recovery point; with none, the form takes the current
 * version at once and says whose change it shows. Two browser contexts signed
 * in as two users: the lock is held per user.
 *
 * "Within one heartbeat" waits at most 20 seconds after the write: one 15
 * second beat and its request.
 *
 * @module tests/entry-lock-changed-while-held
 */
import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { freeDocument, test } from "./support/test";
import { uniqueTag } from "./support/accounts";
import { gotoAdmin } from "./support/admin";
import { EVERY_DIALECT } from "./support/every-dialect";
import { LOCK } from "./support/locks";
import { claimedBy, SECOND_EDITOR, secondEditor } from "./support/two-editors";

// Creates a second user, and the Single is shared with other specs; see
// support/locks.ts for what each lock guards.
test.describe.configure({ lock: [LOCK.siteSettings, LOCK.usersRoles] });

const ENTRIES = "/admin/api/collections/posts/entries";
const SINGLE_API = "/admin/api/singles/site-settings";
/** One heartbeat and the request that carries it. */
const ONE_HEARTBEAT = 20_000;

/** A post of this test's own, returning its id. */
async function createPost(page: Page): Promise<string> {
  const tag = uniqueTag();
  const created = await page.request.post(ENTRIES, {
    data: {
      title: `Changed while held ${tag}`,
      slug: `changed-while-held-${tag}`,
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

function tagline(page: Page) {
  return page.getByRole("textbox", { name: "Tagline", exact: true });
}

/** `api`'s user writes `data` to the document at `path`, as a script would. */
async function writeThroughApi(
  api: APIRequestContext,
  path: string,
  data: Record<string, unknown>
): Promise<void> {
  const written = await api.patch(path, {
    data: { ...data, _overwrite: true },
  });
  expect(written.ok(), await written.text()).toBe(true);
}

/** The lock's strip, saying someone else changed the document. */
function changeNotice(page: Page) {
  return page
    .getByTestId("document-lock-banner")
    .filter({ hasText: `${SECOND_EDITOR} changed this document at` });
}

test.describe(
  "an editor holding a document is told when someone else changes it",
  { tag: EVERY_DIALECT },
  () => {
    // Two sessions, and a heartbeat the notice rides on.
    test.describe.configure({ timeout: 120_000 });

    test("tells the holder within one heartbeat that an API write changed the entry, naming who", async ({
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
        const theirs = `Written through the API ${uniqueTag()}`;
        await writeThroughApi(other.page.request, `${ENTRIES}/${id}`, {
          excerpt: theirs,
        });

        // Named, within a beat, while A still holds the entry.
        await expect(changeNotice(page)).toBeVisible({
          timeout: ONE_HEARTBEAT,
        });
        // A's edits are untouched and A can still type: the notice withholds
        // nothing, and no read replaced the form.
        await expect(excerpt(page)).toHaveValue(mine);
        await expect(excerpt(page)).toBeEditable();

        // Loading the current version keeps A's edits as a recovery point.
        await page
          .getByRole("button", { name: "Load current version" })
          .click();
        await expect(excerpt(page)).toHaveValue(theirs, { timeout: 30_000 });
        await expect(page.getByRole("button", { name: "Restore" })).toBeVisible(
          { timeout: 30_000 }
        );
      } finally {
        await other.context.close();
      }
    });

    test("loads an API write into a holder's form that has no unsaved edits, naming who", async ({
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

      const other = await secondEditor(browser, page, baseURL);
      try {
        const theirs = `Written through the API ${uniqueTag()}`;
        await writeThroughApi(other.page.request, `${ENTRIES}/${id}`, {
          excerpt: theirs,
        });

        await expect(changeNotice(page)).toContainText(
          "so it now shows the latest version",
          { timeout: ONE_HEARTBEAT }
        );
        await expect(excerpt(page)).toHaveValue(theirs, { timeout: 30_000 });
        await expect(excerpt(page)).toBeEditable();
      } finally {
        await other.context.close();
      }
    });

    test("tells the holder within one heartbeat that an API write changed a Single, naming who", async ({
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
        await writeThroughApi(other.page.request, SINGLE_API, {
          tagline: `Written through the API ${uniqueTag()}`,
        });

        await expect(changeNotice(page)).toBeVisible({
          timeout: ONE_HEARTBEAT,
        });
        await expect(tagline(page)).toHaveValue(mine);
        await expect(tagline(page)).toBeEditable();
      } finally {
        await other.context.close();
      }
    });
  }
);
