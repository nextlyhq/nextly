/**
 * The control for `entry-list-read-only.spec.ts`: a role that may create,
 * change and delete Posts is offered "New", row checkboxes, bulk delete and a
 * row Delete on the same list. Without it, a list that offered nothing to
 * anyone would pass every absence there.
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

test.beforeAll(async ({ browser, playwright }, testInfo) => {
  const baseURL = testInfo.project.use.baseURL;
  if (baseURL === undefined) throw new Error("[e2e] No baseURL configured.");
  const admin = await playwright.request.newContext({
    baseURL,
    storageState: STORAGE_STATE,
  });
  try {
    await createEntry(admin, "posts", {
      title: "A post to change",
      slug: `editor-${Date.now().toString(36)}`,
    });
    limited = await signInAsLimitedUser(browser, admin, baseURL, [
      "read-posts",
      "create-posts",
      "update-posts",
      "delete-posts",
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
    .getByRole("button", { name: /A post to change/ })
    .filter({ visible: true });

test('offers "New", row checkboxes and bulk delete', async () => {
  await gotoAdmin(page, "/collections/posts");
  await expect(page.getByRole("button", { name: /^new /i })).toBeVisible();
  await row().getByRole("checkbox", { name: "Select row" }).check();
  await expect(
    page.getByRole("button", { name: /delete selected/i })
  ).toBeVisible();
});

test("offers Delete in a row's actions", async () => {
  await gotoAdmin(page, "/collections/posts");
  await row().getByRole("button", { name: "Row actions" }).click();
  await expect(page.getByRole("menuitem", { name: "Delete" })).toBeVisible();
  await page.keyboard.press("Escape");
});
