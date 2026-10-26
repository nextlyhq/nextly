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

const table = () => page.getByRole("table", { name: "Entries table" });

test('offers "New", row checkboxes and bulk delete', async () => {
  await gotoAdmin(page, "/collections/posts");
  await expect(page.getByRole("button", { name: /^new /i })).toBeVisible();
  await table().getByRole("checkbox", { name: "Select row" }).first().check();
  await expect(
    page.getByRole("button", { name: /delete selected/i })
  ).toBeVisible();
});

test("offers Delete in a row's actions", async () => {
  await table().getByRole("button", { name: "Row actions" }).first().click();
  await expect(page.getByRole("menuitem", { name: "Delete" })).toBeVisible();
  await page.keyboard.press("Escape");
});
