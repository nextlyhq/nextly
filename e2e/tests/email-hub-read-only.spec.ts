/**
 * A reader who may see emails and providers but change neither: the hub
 * shows them both, and offers no change the server would refuse.
 */
import { expect, type Page } from "@playwright/test";

import { STORAGE_STATE } from "../global-setup";

import { gotoAdmin } from "./support/admin";
import { signInAsLimitedUser, type LimitedUser } from "./support/limited-user";
import { test } from "./support/test";
import { LOCK } from "./support/locks";

// One signed-in user for the whole file: signing in spends the auth budget.
// Shares state with other specs; see support/locks.ts for what each lock guards.
test.describe.configure({
  mode: "serial",
  lock: [LOCK.usersRoles, LOCK.email],
});

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
    limited = await signInAsLimitedUser(browser, admin, baseURL, [
      "read-email-templates",
      "read-email-providers",
    ]);
  } finally {
    await admin.dispose();
  }
  page = await limited.context.newPage();
});

test.afterAll(async () => {
  await limited?.context.close();
});

test("the hub is in the reader's navigation", async () => {
  await gotoAdmin(page, "");
  const rail = page.getByRole("navigation").first();
  await expect(rail.locator('a[href="/admin/email"]')).toHaveCount(1);
});

test("Messages lists the emails with nothing to change them", async () => {
  await gotoAdmin(page, "/email");
  await expect(page.getByText("Welcome").first()).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole("button", { name: "New email" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Actions for / })).toHaveCount(
    0
  );
  // Names are not links into an editor whose save would be refused.
  await expect(page.getByRole("link", { name: "Welcome" })).toHaveCount(0);
});

test("Sending lists the providers with nothing to add", async () => {
  await gotoAdmin(page, "/email/sending");
  await expect(page.getByRole("tab", { name: "Sending" })).toHaveAttribute(
    "aria-selected",
    "true"
  );
  await expect(page.getByRole("link", { name: /Add Provider/ })).toHaveCount(0);
});

test("Settings no longer lists email", async () => {
  await gotoAdmin(page, "");
  const rail = page.getByRole("navigation").first();
  // Email grants alone reveal no Settings destination.
  await expect(rail.locator('a[href="/admin/settings"]')).toHaveCount(0);
});
