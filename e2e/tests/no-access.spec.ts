/**
 * Opening a collection or a Single the user may not read says so, at the
 * address they opened, instead of moving them to the dashboard without a word.
 *
 * Only a browser can show this: the refusal used to be a client-side redirect
 * fired after the permissions arrived, so the URL a person ends up on, and what
 * is drawn there, are the whole of the behaviour.
 */
import { expect, type Page } from "@playwright/test";

import { fileAccount, test } from "./support/test";

import { gotoAdmin } from "./support/admin";
import { signInAsLimitedUser, type LimitedUser } from "./support/limited-user";
import { LOCK } from "./support/locks";

// One signed-in user for the whole file: signing in spends the auth budget.
// Shares state with other specs; see support/locks.ts for what each lock guards.
test.describe.configure({ mode: "serial", lock: [LOCK.usersRoles] });

let limited: LimitedUser;
let page: Page;

test.beforeAll(async ({ browser, playwright }, testInfo) => {
  const baseURL = testInfo.project.use.baseURL;
  if (baseURL === undefined) throw new Error("[e2e] No baseURL configured.");
  const admin = await playwright.request.newContext({
    baseURL,
    storageState: await fileAccount(baseURL, testInfo),
  });
  try {
    // Reads Posts and nothing else: Tags and every Single are out of reach.
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

const heading = (name: string) => page.getByRole("heading", { name });

test("a collection the user can read still opens", async () => {
  // The control: without it, a session that is refused everything, or never
  // signed in at all, would pass every refusal below.
  await gotoAdmin(page, "/collections/posts");
  await expect(page).toHaveURL(/\/admin\/collections\/posts$/);
  await expect(heading("You don't have access to this collection")).toHaveCount(
    0
  );
});

test("a collection the user can't read says so and stays put", async () => {
  await gotoAdmin(page, "/collections/tags");
  await expect(
    heading("You don't have access to this collection")
  ).toBeVisible();
  // Held for a moment, because the old guard redirected from an effect after
  // the first render: a check made at once could pass before the redirect.
  await page.waitForTimeout(1_000);
  await expect(page).toHaveURL(/\/admin\/collections\/tags$/);
  await expect(
    heading("You don't have access to this collection")
  ).toBeVisible();
});

test("a Single the user can't read says so and stays put", async () => {
  await gotoAdmin(page, "/singles/site-settings");
  await expect(heading("You don't have access to this Single")).toBeVisible();
  await page.waitForTimeout(1_000);
  await expect(page).toHaveURL(/\/admin\/singles\/site-settings$/);
});

test("Go back returns to the page before", async () => {
  await gotoAdmin(page, "/collections/posts");
  await gotoAdmin(page, "/collections/tags");
  await expect(
    heading("You don't have access to this collection")
  ).toBeVisible();
  await page.getByRole("button", { name: "Go back" }).click();
  await expect(page).toHaveURL(/\/admin\/collections\/posts$/);
  // Back between two full loads is a navigation of its own. The URL changes
  // before the page it returns to has loaded, and a test that moves on then
  // has its next navigation aborted by this one finishing.
  await page.waitForLoadState("load");
  await expect(page.locator("main")).toBeVisible();
});

test("Go to dashboard goes to the dashboard", async () => {
  await gotoAdmin(page, "/singles/site-settings");
  await expect(heading("You don't have access to this Single")).toBeVisible();
  await page.getByRole("button", { name: "Go to dashboard" }).click();
  await expect(page).toHaveURL(/\/admin\/?$/);
});

test("Go back from a link opened in a new tab goes to the dashboard", async () => {
  // A fresh tab has one history entry, where `back()` would do nothing.
  const tab = await limited.context.newPage();
  try {
    await gotoAdmin(tab, "/collections/tags");
    await expect(
      tab.getByRole("heading", {
        name: "You don't have access to this collection",
      })
    ).toBeVisible();
    await tab.getByRole("button", { name: "Go back" }).click();
    await expect(tab).toHaveURL(/\/admin\/?$/);
  } finally {
    await tab.close();
  }
});

test("Go back from the site's own page stays in the admin", async () => {
  // The admin runs inside the site it manages, so the page before is of the
  // same origin without being the admin. Going back there would leave it.
  const tab = await limited.context.newPage();
  try {
    await tab.goto("/");
    await gotoAdmin(tab, "/collections/tags");
    await expect(
      tab.getByRole("heading", {
        name: "You don't have access to this collection",
      })
    ).toBeVisible();
    await tab.getByRole("button", { name: "Go back" }).click();
    await expect(tab).toHaveURL(/\/admin\/?$/);
  } finally {
    await tab.close();
  }
});
