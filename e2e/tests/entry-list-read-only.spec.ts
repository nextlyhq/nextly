/**
 * A role that may only read Posts is offered nothing on the Posts list it
 * could not do: no "New", no row checkboxes, no bulk delete, no row Delete,
 * and the list's keyboard shortcuts for those do nothing.
 *
 * Only a browser shows this whole: each control is drawn by a different
 * component, and the shortcuts reach the same actions without any of them.
 * `entry-list-editor.spec.ts` is the control: a role that may change Posts
 * gets each of them on the same list.
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
    // A row to select, so a missing checkbox is the permission and not an
    // empty list.
    await createEntry(admin, "posts", {
      title: "A post to read",
      slug: `read-only-${Date.now().toString(36)}`,
    });
    limited = await signInAsLimitedUser(browser, admin, baseURL, [
      "read-posts",
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

test("the Posts list opens, with its rows", async () => {
  // The control within the file: a reader who could not open the list, or
  // saw no rows, would pass every absence below.
  await gotoAdmin(page, "/collections/posts");
  await expect(table().getByRole("row").nth(1)).toBeVisible();
});

test('offers no "New"', async () => {
  await expect(page.getByRole("button", { name: /^new /i })).toHaveCount(0);
});

test("offers no row checkboxes and no bulk delete", async () => {
  await expect(table().getByRole("checkbox")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /delete selected/i })
  ).toHaveCount(0);
});

test("offers no Delete in a row's actions", async () => {
  await table().getByRole("button", { name: "Row actions" }).first().click();
  await expect(page.getByRole("menuitem", { name: "Edit" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Delete" })).toHaveCount(0);
  await page.keyboard.press("Escape");
});

test("does nothing on the select-all, delete and new shortcuts", async () => {
  await table().click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Delete");
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+n");
  await page.waitForTimeout(500);
  await expect(page).toHaveURL(/\/admin\/collections\/posts$/);
});
