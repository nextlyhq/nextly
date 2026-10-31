/**
 * The control for `entry-list-read-only.spec.ts`: a role that may create,
 * change and delete Posts is offered "New", row checkboxes, bulk delete and a
 * row Delete on the same list. Without it, a list that offered nothing to
 * anyone would pass every absence there. It is also the control for
 * `entry-opens-read-only.spec.ts`: the same role opens a post editable, with
 * no reader's banner, and a page with its preview.
 */
import { expect, type Page } from "@playwright/test";

import { includingHidden, test } from "./support/test";
import { STORAGE_STATE } from "../global-setup";

import { gotoAdmin } from "./support/admin";
import { signInAsLimitedUser, type LimitedUser } from "./support/limited-user";
import { createEntry } from "./support/runtime-collection";

// One signed-in user for the whole file: signing in spends the auth budget.
test.describe.configure({ mode: "serial" });

// Unique to this attempt: a retry runs `beforeAll` again, and a second post
// with the same title would match the row this file looks for twice.
const RUN = Date.now().toString(36);
const TITLE = `A post to change ${RUN}`;

let limited: LimitedUser;
let page: Page;
let postId: string;
let blockPageId: string;

test.beforeAll(async ({ browser, playwright }, testInfo) => {
  const baseURL = testInfo.project.use.baseURL;
  if (baseURL === undefined) throw new Error("[e2e] No baseURL configured.");
  const admin = await playwright.request.newContext({
    baseURL,
    storageState: STORAGE_STATE,
  });
  try {
    postId = await createEntry(admin, "posts", {
      title: TITLE,
      slug: `editor-${RUN}`,
    });
    blockPageId = await createEntry(admin, "block-pages", {
      title: `A page to change ${RUN}`,
      slug: `editor-block-${RUN}`,
    });
    limited = await signInAsLimitedUser(browser, admin, baseURL, [
      "read-posts",
      "create-posts",
      "update-posts",
      "delete-posts",
      "read-block-pages",
      "update-block-pages",
    ]);
  } finally {
    await admin.dispose();
  }
  page = await limited.context.newPage();
});

test.afterAll(async () => {
  await limited?.context.close();
});

/**
 * The post this file changes, as the list's row for it. A row that opens its entry
 * is a button; the phone-width card drawing the same entry stays hidden.
 */
const row = () =>
  page
    .getByRole("button", { name: new RegExp(TITLE) })
    .filter({ visible: true });

test('offers "New", row checkboxes and bulk delete', async () => {
  await gotoAdmin(page, "/collections/posts");
  await expect(page.getByRole("button", { name: /^new /i })).toBeVisible();
  await row().getByRole("checkbox", { name: "Select row" }).check();
  await expect(
    page.getByRole("button", { name: /delete selected/i })
  ).toBeVisible();
});

test("opens a post editable, with no reader's banner", async () => {
  await gotoAdmin(page, `/collections/posts/${postId}`);
  const excerpt = page
    .locator("main")
    .getByRole("textbox", { name: "Excerpt", exact: true });
  await expect(excerpt).toBeEditable();
  await expect(page.locator('[data-primary="true"]')).toBeVisible();
  await expect(
    includingHidden(page).getByTestId("document-lock-banner")
  ).toHaveCount(0);
});

// Below the width the document panel is drawn from, a tablet's as a phone's,
// the strip under the header offers the id the panel holds.
for (const [width, height, screenName] of [
  [390, 844, "a phone"],
  [820, 1180, "a tablet"],
] as const) {
  test(`copies a post's id at ${screenName}'s width`, async () => {
    await limited.context.grantPermissions([
      "clipboard-read",
      "clipboard-write",
    ]);
    await page.setViewportSize({ width, height });
    try {
      await gotoAdmin(page, `/collections/posts/${postId}`);
      // The page is shared by these cases, so the clipboard is set to
      // something else first: each width's own click must put the id there.
      await page.evaluate(() =>
        navigator.clipboard.writeText("nothing copied yet")
      );
      await page.getByRole("button", { name: "Copy ID to clipboard" }).click();
      await expect
        .poll(() => page.evaluate(() => navigator.clipboard.readText()))
        .toBe(postId);
    } finally {
      await page.setViewportSize({ width: 1280, height: 720 });
    }
  });
}

test("offers the preview of a page it may change", async () => {
  await gotoAdmin(page, `/collections/block-pages/${blockPageId}`);
  await expect(
    page.getByRole("button", { name: /preview options$/i })
  ).toBeVisible();
});

test("offers Delete in a row's actions", async () => {
  await gotoAdmin(page, "/collections/posts");
  await row().getByRole("button", { name: "Row actions" }).click();
  await expect(page.getByRole("menuitem", { name: "Delete" })).toBeVisible();
  await page.keyboard.press("Escape");
});

test("acts on the select-all, delete and new shortcuts", async () => {
  // The positive half of the read-only file's shortcut case: here the same
  // keys reach the same actions, so their absence there is the permission
  // and not a shortcut that is not bound.
  await gotoAdmin(page, "/collections/posts");
  await expect(row()).toBeVisible();
  await page.getByRole("heading", { name: "Posts", exact: true }).click();
  // The list binds Control itself, not the platform's Command key.
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Delete");
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await page.keyboard.press("Control+n");
  await expect(page).toHaveURL(/\/admin\/collections\/posts\/create$/);
});
