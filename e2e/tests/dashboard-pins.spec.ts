/**
 * A reader pins an entry from its edit page, and the pin is kept on the
 * server: after a reload the menu offers to unpin it, and the reader's pins
 * name the entry with its title. Unpinning from the same menu lets it go.
 *
 * Only a browser shows this whole: the menu item, the write it makes, and the
 * server's answer read back on the next page load are three layers, and a unit
 * test stubs at least one.
 */
import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { fileAccount, test } from "./support/test";

import { gotoAdmin } from "./support/admin";
import { createEntry } from "./support/runtime-collection";

test.describe.configure({ mode: "serial" });

// Unique to this attempt: a retry runs `beforeAll` again.
const RUN = Date.now().toString(36);
const TITLE = `A post worth coming back to ${RUN}`;

let admin: APIRequestContext;
let page: Page;
let postId: string;

test.beforeAll(async ({ browser, playwright }, testInfo) => {
  const baseURL = testInfo.project.use.baseURL;
  if (baseURL === undefined) throw new Error("[e2e] No baseURL configured.");
  const storageState = await fileAccount(baseURL, testInfo);
  admin = await playwright.request.newContext({ baseURL, storageState });
  postId = await createEntry(admin, "posts", {
    title: TITLE,
    slug: `pinned-${RUN}`,
  });
  page = await (await browser.newContext({ baseURL, storageState })).newPage();
});

test.afterAll(async () => {
  await page?.context().close();
  await admin?.dispose();
});

/** The reader's pins, as the server answers them. */
async function pins(): Promise<
  Array<{ targetSlug: string; entryId: string; title: string }>
> {
  const answer = await admin.get("/admin/api/dashboard/pins");
  expect(answer.ok(), await answer.text()).toBe(true);
  return ((await answer.json()) as { items: never[] }).items;
}

async function openMenu(): Promise<void> {
  await page.getByRole("button", { name: "More actions" }).click();
}

test("pins an entry from its edit page, keeps it on the server, and unpins it", async () => {
  await gotoAdmin(page, `/collections/posts/${postId}`);
  await openMenu();
  const pinned = page.waitForResponse(
    response =>
      response.request().method() === "POST" &&
      response.url().endsWith("/dashboard/pins")
  );
  await page.getByRole("menuitem", { name: "Pin to dashboard" }).click();
  expect((await pinned).ok()).toBe(true);

  // Kept on the server: a fresh page load offers the other verb.
  await page.reload();
  await openMenu();
  await expect(
    page.getByRole("menuitem", { name: "Unpin from dashboard" })
  ).toBeVisible();

  // And the reader's pins name the entry, titled.
  expect(await pins()).toContainEqual(
    expect.objectContaining({
      targetSlug: "posts",
      entryId: postId,
      title: TITLE,
    })
  );

  const unpinned = page.waitForResponse(
    response =>
      response.request().method() === "DELETE" &&
      response.url().endsWith("/dashboard/pins")
  );
  await page.getByRole("menuitem", { name: "Unpin from dashboard" }).click();
  expect((await unpinned).ok()).toBe(true);
  expect((await pins()).some(pin => pin.entryId === postId)).toBe(false);
});
