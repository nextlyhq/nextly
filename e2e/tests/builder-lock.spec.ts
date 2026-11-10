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
import { expect, type Page } from "@playwright/test";

import { freeDocument, test } from "./support/test";
import { gotoAdmin } from "./support/admin";
import { canvasFrame } from "./support/canvas-frame";
import { EVERY_DIALECT } from "./support/every-dialect";
import { LOCK } from "./support/locks";
import {
  claimedBy,
  secondEditor,
  type LockedDocument,
} from "./support/two-editors";

// Shares state with other specs; see support/locks.ts for what each lock guards.
test.describe.configure({ lock: [LOCK.homepage, LOCK.usersRoles] });

const OPEN_BUILDER_ACTION = /^(?:Build this page|Open Page Builder)$/;
const HOMEPAGE_API = "/admin/api/singles/homepage";
const BUILDER_ADDRESS = "/singles/homepage/builder?field=layout";
function heading(id: string, text: string) {
  return { id, type: "core/heading", version: 1, props: { text, level: "h2" } };
}

function block(page: Page, id: string) {
  return canvasFrame(page).locator(`.nx-canvas [data-nx-node="${id}"]`).first();
}

/** The homepage, as the document-lock route names it. */
async function homepage(page: Page): Promise<LockedDocument> {
  const read = await page.request.get(HOMEPAGE_API);
  expect(read.ok(), await read.text()).toBe(true);
  // A Single's read is the bare document, not a mutation's `{ item }`.
  const { id } = (await read.json()) as { id: string };
  return { scopeKind: "single", slug: "homepage", entryId: id };
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

// Run on every dialect: the lease the two editors share lives in the database.
test.describe("two editors on one page", { tag: EVERY_DIALECT }, () => {
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
        _overwrite: true,
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
    // The canvas draws before the claim lands; a second editor arriving first
    // would claim the page themself.
    await claimedBy(page.request, await homepage(page));

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
    // As above: the second editor arrives once the first one's claim has.
    await claimedBy(page.request, await homepage(page));

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
      // none of the canvas's node markers; asked of the drawn page alone,
      // because the section list beneath it names each section by its text.
      const drawn = page.locator('main [data-slot="page-miniature-surface"]');
      await expect(drawn.getByText("First", { exact: true })).toBeVisible();
      await expect(drawn.getByText("Second", { exact: true })).toHaveCount(0);

      // Taking it back reopens the editor from the form, edit and all.
      await page.getByRole("button", { name: "Take it back" }).click();
      await expect(block(page, "first")).toBeVisible({ timeout: 30_000 });
      await expect(block(page, "second")).toHaveCount(0);
    } finally {
      await other.context.close();
    }
  });

  test("the builder shows the saved page before it unlocks after a takeover", async ({
    page,
    browser,
    baseURL,
  }) => {
    // The builder's editor reads its page once, as it mounts. Unlocked over
    // the page read while the first person held it, it would go on showing,
    // and then save, the page from before what they saved.
    //
    // The test before this one ends with its second editor holding the page,
    // and closing their page does not release it.
    await freeDocument(page.request, "homepage");
    await openBuilder(page);
    await expect(block(page, "first")).toBeVisible({ timeout: 30_000 });
    await claimedBy(page.request, await homepage(page));

    const other = await secondEditor(browser, page, baseURL);
    try {
      await arriveAtBuilder(other.page);
      await expect(
        other.page.getByText(/is editing this document/)
      ).toBeVisible({ timeout: 30_000 });

      // The first person saves a page with a section the second never read.
      const stored = await page.request.patch(HOMEPAGE_API, {
        data: {
          layout: {
            formatVersion: 1,
            kind: "page",
            nodes: [heading("first", "First"), heading("saved", "Saved")],
          },
          _overwrite: true,
        },
      });
      expect(stored.ok()).toBe(true);

      // The second person's read of the page after the takeover is held, so
      // the builder is seen still read-only while it is on its way.
      const read = new RegExp(`${HOMEPAGE_API}(?:\\?|$)`);
      let release: () => void = () => {};
      const released = new Promise<void>(resolve => {
        release = resolve;
      });
      await other.page.route(read, async route => {
        if (route.request().method() !== "GET") return route.continue();
        await released;
        await route.continue();
      });
      const asked = other.page.waitForRequest(
        request => request.method() === "GET" && read.test(request.url()),
        { timeout: 45_000 }
      );

      await other.page.getByRole("button", { name: "Take over" }).click();
      await asked;
      await expect(
        other.page.getByRole("banner", { name: "Editor actions" })
      ).toHaveCount(0);

      release();
      await expect(block(other.page, "saved")).toBeVisible({
        timeout: 30_000,
      });
      await expect(block(other.page, "second")).toHaveCount(0);
    } finally {
      await other.context.close();
    }
  });
});
