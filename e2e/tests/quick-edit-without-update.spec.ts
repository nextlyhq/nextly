/**
 * A related entry opened for a quick edit, by someone who may read it but not
 * change it, is shown read-only with nothing to save. The editor may change
 * Posts and only read Categories, so the Category a post links to opens in
 * the quick-edit modal without "Save Changes", where it used to offer a save
 * the server refused.
 */
import { expect, type Page } from "@playwright/test";

import { test } from "./support/test";
import { STORAGE_STATE } from "../global-setup";

import { gotoAdmin } from "./support/admin";
import { signInAsLimitedUser, type LimitedUser } from "./support/limited-user";
import { createEntry } from "./support/runtime-collection";

// One signed-in user for the whole file: signing in spends the auth budget.
test.describe.configure({ mode: "serial" });

let limited: LimitedUser;
let page: Page;
let postId: string;

test.beforeAll(async ({ browser, playwright }, testInfo) => {
  const baseURL = testInfo.project.use.baseURL;
  if (baseURL === undefined) throw new Error("[e2e] No baseURL configured.");
  const admin = await playwright.request.newContext({
    baseURL,
    storageState: STORAGE_STATE,
  });
  try {
    const run = Date.now().toString(36);
    const categoryId = await createEntry(admin, "categories", {
      title: "Read-only category",
      slug: `read-only-${run}`,
    });
    postId = await createEntry(admin, "posts", {
      title: "Post linking a category",
      slug: `links-category-${run}`,
      categories: [categoryId],
    });
    limited = await signInAsLimitedUser(browser, admin, baseURL, [
      "read-posts",
      "update-posts",
      "read-categories",
    ]);
  } finally {
    await admin.dispose();
  }
  page = await limited.context.newPage();
});

test.afterAll(async () => {
  await limited?.context.close();
});

test("the linked Category opens read-only, with no Save", async () => {
  await gotoAdmin(page, `/collections/posts/${postId}`);
  await page
    .getByRole("button", { name: /^edit read-only category$/i })
    .click();
  const modal = page.getByRole("dialog");
  // The modal shows the Category, so the missing Save is the permission and
  // not a modal that never opened.
  await expect(modal.getByRole("textbox", { name: /title/i })).toHaveValue(
    "Read-only category"
  );
  await expect(modal.getByRole("textbox", { name: /title/i })).toHaveAttribute(
    "readonly"
  );
  await expect(
    modal.getByRole("button", { name: /save changes/i })
  ).toHaveCount(0);
});
