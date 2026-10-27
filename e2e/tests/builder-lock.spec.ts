/**
 * Two people and one page: the Page Builder keeps the document's soft lock.
 *
 * The second person sees the page read-only, named as held by the first, and
 * can ask for access; a takeover moves the document to them, and the first
 * person's unsaved edits are still theirs — in their form, unsaved, ready for
 * when they take the page back.
 *
 * Two browser contexts, signed in as two different users: the lock is held per
 * user, so one user in two tabs is one holder and proves nothing.
 *
 * @module tests/builder-lock
 */
import {
  expect,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";

import { test } from "./support/test";
import {
  createSignedInUser,
  superAdminRoleId,
  uniqueTag,
} from "./support/accounts";
import { gotoAdmin } from "./support/admin";
import { LOCK } from "./support/locks";

// Shares state with other specs; see support/locks.ts for what each lock guards.
test.describe.configure({ lock: [LOCK.homepage, LOCK.usersRoles] });

const OPEN_BUILDER_ACTION = /^(?:Build this page|Open Page Builder)$/;
const HOMEPAGE_API = "/admin/api/singles/homepage";
const BUILDER_ADDRESS = "/singles/homepage/builder?field=layout";
function heading(id: string, text: string) {
  return { id, type: "core/heading", version: 1, props: { text, level: "h2" } };
}

function block(page: Page, id: string) {
  return page.locator(`.nx-canvas [data-nx-node="${id}"]`).first();
}

/**
 * A second super-admin, signed in in a context of its own (see
 * `support/accounts`), so the two pages are two lock holders. One person in two
 * tabs is one holder and would prove nothing.
 */
async function secondEditor(
  browser: Browser,
  first: Page,
  baseURL: string | undefined
): Promise<{ context: BrowserContext; page: Page }> {
  if (!baseURL) throw new Error("The suite configures no baseURL.");
  const { storageState } = await createSignedInUser(first.request, baseURL, {
    email: `second-editor-${uniqueTag()}@nextly.local`,
    name: "Second Editor",
    roleIds: [await superAdminRoleId(first.request)],
  });
  // A context from `browser` inherits none of the test's options, so it is
  // given the address and the second editor's session.
  const context = await browser.newContext({ baseURL, storageState });
  return { context, page: await context.newPage() };
}

async function openBuilder(page: Page): Promise<void> {
  await gotoAdmin(page, "/singles/homepage");
  await page.getByRole("link", { name: OPEN_BUILDER_ACTION }).click();
}

/**
 * The builder's own address, reached directly, as a shared link or a bookmark
 * reaches it. The way a second person arrives while the page is held: the edit
 * form they would otherwise come through is read-only for them, and its card
 * rightly offers no way into an editor they may not use.
 */
async function arriveAtBuilder(page: Page): Promise<void> {
  await gotoAdmin(page, BUILDER_ADDRESS);
}

test.describe("two editors on one page", () => {
  // Two sessions, and a lock heartbeat each side waits on: the holder learns
  // of a request, and the displaced author of a takeover, only at its next
  // beat, which the steps below allow 45 seconds for.
  test.describe.configure({ timeout: 120_000 });

  test.beforeEach(async ({ page }) => {
    const stored = await page.request.patch(HOMEPAGE_API, {
      data: {
        layout: {
          formatVersion: 1,
          kind: "page",
          nodes: [heading("first", "First"), heading("second", "Second")],
        },
      },
    });
    expect(stored.ok()).toBe(true);
  });

  test("the second sees it read-only, named as held, and can ask for it", async ({
    page,
    browser,
    baseURL,
  }) => {
    await openBuilder(page);
    await expect(block(page, "first")).toBeVisible({ timeout: 30_000 });

    const other = await secondEditor(browser, page, baseURL);
    try {
      await arriveAtBuilder(other.page);
      await expect(
        other.page.getByText(/is editing this document/)
      ).toBeVisible({ timeout: 30_000 });
      // Read-only: the page is drawn, the editor's toolbar is not.
      await expect(
        other.page.getByRole("banner", { name: "Editor actions" })
      ).toHaveCount(0);

      await other.page
        .getByRole("button", { name: "Request edit access" })
        .click();
      // The holder learns at its next heartbeat that someone is waiting.
      await expect(
        page.getByText("Someone is waiting to edit this document.")
      ).toBeVisible({ timeout: 45_000 });
    } finally {
      await other.context.close();
    }
  });

  test("a takeover keeps the displaced author's unsaved edits", async ({
    page,
    browser,
    baseURL,
  }) => {
    await openBuilder(page);
    await expect(block(page, "second")).toBeVisible({ timeout: 30_000 });
    await block(page, "second").click();
    await page.keyboard.press("Delete");
    await expect(block(page, "second")).toHaveCount(0);

    const other = await secondEditor(browser, page, baseURL);
    try {
      await arriveAtBuilder(other.page);
      await other.page.getByRole("button", { name: "Take over" }).click();
      // The new holder edits the page as stored: the first author's edit was
      // never saved, so it is not theirs to see.
      await expect(block(other.page, "second")).toBeVisible({
        timeout: 30_000,
      });

      // The first author is told, and their edit is still in their page.
      await expect(
        page.getByText(
          /took over this document\. Your unsaved changes are still here/
        )
      ).toBeVisible({ timeout: 45_000 });
      // Drawn read-only now, outside the editor's canvas, and WITH the edit:
      // the page the banner promises, not the one from before it. Read by
      // text, since the read-only page is the published renderer and carries
      // none of the canvas's node markers.
      const main = page.locator("main");
      await expect(main.getByText("First", { exact: true })).toBeVisible();
      await expect(main.getByText("Second", { exact: true })).toHaveCount(0);

      // Taking it back reopens the editor from the form, edit and all.
      await page.getByRole("button", { name: "Take it back" }).click();
      await expect(block(page, "first")).toBeVisible({ timeout: 30_000 });
      await expect(block(page, "second")).toHaveCount(0);
    } finally {
      await other.context.close();
    }
  });
});
