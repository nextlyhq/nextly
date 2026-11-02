/**
 * Two people signing in to the admin in turn each see their own admin.
 *
 * The admin is rendered at request time, with no server state cached between
 * people. Under Cache Components a route's render can be kept and served again,
 * so an admin rendered above its request boundary would be one shared answer.
 * The admin page draws nothing from the session on the server (it is a client
 * page, filled in from the session's own API answers), so what is checked of
 * the server is that each person's admin page is answered for that request and
 * never from a shared cache. The greeting and navigation then check that the
 * per-person answers the page draws from are not shared either. Asked in turn
 * (the super-admin, a reader of posts, then the super-admin again), so an
 * answer kept from either person would show up on the other's next load.
 */
import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { signInAsLimitedUser, type LimitedUser } from "./support/limited-user";
import { waitForShellAnswers } from "./support/shell-geometry";
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

/**
 * The name the greeting gives, without its time of day, which changes on its
 * own at noon and at six in the evening.
 */
async function greetedName(page: Page): Promise<string> {
  await expect(greeting(page)).toBeVisible({ timeout: 30_000 });
  const text = (await greeting(page).textContent()) ?? "";
  return text.replace(/^Good (morning|afternoon|evening), /, "");
}

async function dashboard(page: Page): Promise<string> {
  await gotoAdmin(page, "/");
  return greetedName(page);
}

/**
 * The admin page, as the server answers it for this person: rendered for the
 * request, never kept for a shared cache. A production server sends a dynamic
 * render as `private` and `no-store`, and a prerendered one with a shared
 * lifetime (`s-maxage`) instead. The dev server sends `no-store` for every
 * page, so only `no-store` is asked of it.
 */
async function expectAnsweredForThisRequest(page: Page): Promise<void> {
  const response = await page.request.get("/admin");
  expect(response.status()).toBe(200);
  const directives = (response.headers()["cache-control"] ?? "")
    .split(",")
    .map(directive => directive.trim().split("=")[0].toLowerCase());
  expect(directives).toContain("no-store");
  if (process.env.E2E_SERVER === "production") {
    expect(directives).toContain("private");
  }
  expect(directives).not.toContain("s-maxage");
  expect(directives).not.toContain("public");
}

/** No Settings, asked once the shell's permission answer is in. */
async function expectNoSettings(page: Page): Promise<void> {
  // Before the permission answer arrives the sidebar offers no Settings to
  // anyone, so an absence read earlier would say nothing.
  await waitForShellAnswers(page);
  await expect(settingsLink(page)).toHaveCount(0);
}

test("each person signing in sees their own admin, whoever signed in before", async ({
  page,
}) => {
  await expectAnsweredForThisRequest(page);
  const adminName = await dashboard(page);
  // The control: the super-admin is offered the settings, so its absence for
  // the reader below is about who is signed in.
  await expect(settingsLink(page)).toBeVisible();

  const readerPage = await reader.context.newPage();
  await expectAnsweredForThisRequest(readerPage);
  const readerName = await dashboard(readerPage);
  expect(readerName).not.toBe(adminName);
  await expectNoSettings(readerPage);

  // The super-admin again, after the reader's render.
  await expectAnsweredForThisRequest(page);
  await page.reload();
  await expect
    .poll(() => greetedName(page), { timeout: 30_000 })
    .toBe(adminName);
  await expect(settingsLink(page)).toBeVisible();

  // And the reader once more, after the super-admin's.
  await expectAnsweredForThisRequest(readerPage);
  await readerPage.reload();
  await expect
    .poll(() => greetedName(readerPage), { timeout: 30_000 })
    .toBe(readerName);
  await expectNoSettings(readerPage);
  await readerPage.close();
});
