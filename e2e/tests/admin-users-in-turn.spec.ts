/**
 * Two people signing in to the admin in turn each see their own admin.
 *
 * The admin is rendered at request time, with no server state cached between
 * people. Under Cache Components a route's render can be kept and served again,
 * so an admin that read the session above its request boundary, or cached what
 * it drew from it, would show the second person the first one's greeting and
 * navigation. Asked in turn (the super-admin, a reader of posts, then the
 * super-admin again), so a render kept from either person would show up on the
 * other's next load.
 */
import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { signInAsLimitedUser, type LimitedUser } from "./support/limited-user";
import { fileAccount, test } from "./support/test";

let admin: APIRequestContext;
let reader: LimitedUser;

test.beforeAll(async ({ browser, playwright }, testInfo) => {
  const baseURL = testInfo.project.use.baseURL;
  if (baseURL === undefined) throw new Error("[e2e] No baseURL configured.");
  admin = await playwright.request.newContext({
    baseURL,
    storageState: await fileAccount(baseURL, testInfo),
  });
  reader = await signInAsLimitedUser(browser, admin, baseURL, ["read-posts"]);
});

test.afterAll(async () => {
  await reader?.context.close();
  await admin?.dispose();
});

/** The dashboard's greeting, which names the person signed in. */
const greeting = (page: Page) =>
  page.locator("main").getByText(/^Good (morning|afternoon|evening), /);

/** A section only someone who may change settings is offered. */
const settingsLink = (page: Page) =>
  page.getByRole("navigation").getByRole("link", { name: "Settings" });

async function dashboard(page: Page): Promise<string> {
  await gotoAdmin(page, "/");
  await expect(greeting(page)).toBeVisible({ timeout: 30_000 });
  return (await greeting(page).textContent()) ?? "";
}

test("each person signing in sees their own admin, whoever signed in before", async ({
  page,
}) => {
  const adminGreeting = await dashboard(page);
  // The control: the super-admin is offered the settings, so its absence for
  // the reader below is about who is signed in.
  await expect(settingsLink(page)).toBeVisible();

  const readerPage = await reader.context.newPage();
  const readerGreeting = await dashboard(readerPage);
  expect(readerGreeting).not.toBe(adminGreeting);
  await expect(settingsLink(readerPage)).toHaveCount(0);

  // The super-admin again, after the reader's render.
  await page.reload();
  await expect(greeting(page)).toHaveText(adminGreeting, { timeout: 30_000 });
  await expect(settingsLink(page)).toBeVisible();

  // And the reader once more, after the super-admin's.
  await readerPage.reload();
  await expect(greeting(readerPage)).toHaveText(readerGreeting, {
    timeout: 30_000,
  });
  await expect(settingsLink(readerPage)).toHaveCount(0);
  await readerPage.close();
});
