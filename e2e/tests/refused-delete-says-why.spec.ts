/**
 * A delete the server refuses is reported in the server's own words. A role
 * that may read and delete Posts opens a post, and then loses delete-posts, as
 * when an admin changes the role while the post is open. The editor still
 * offers Delete, the server answers 403, and the toast reads the server's
 * message as it is, "You can't delete this post.", with nothing put in front
 * of it. The post is still there afterwards.
 *
 * Only a browser shows this whole: the request, the refusal's body and the
 * toast that reads it are three layers, and a unit test stubs at least one.
 */
import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { fileAccount, test } from "./support/test";

import { gotoAdmin } from "./support/admin";
import { signInAsLimitedUser, type LimitedUser } from "./support/limited-user";
import { createEntry } from "./support/runtime-collection";

// One signed-in user for the whole file: signing in spends the auth budget.
test.describe.configure({ mode: "serial" });

// Unique to this attempt: a retry runs `beforeAll` again.
const RUN = Date.now().toString(36);

let admin: APIRequestContext;
let limited: LimitedUser;
let page: Page;
let postId: string;

test.beforeAll(async ({ browser, playwright }, testInfo) => {
  const baseURL = testInfo.project.use.baseURL;
  if (baseURL === undefined) throw new Error("[e2e] No baseURL configured.");
  admin = await playwright.request.newContext({
    baseURL,
    storageState: await fileAccount(baseURL, testInfo),
  });
  postId = await createEntry(admin, "posts", {
    title: `A post kept by a refusal ${RUN}`,
    slug: `refused-delete-${RUN}`,
  });
  limited = await signInAsLimitedUser(browser, admin, baseURL, [
    "read-posts",
    "delete-posts",
  ]);
  page = await limited.context.newPage();
});

test.afterAll(async () => {
  await limited?.context.close();
  await admin?.dispose();
});

/** Leave the role with read-posts alone, through the route the roles screen uses. */
async function takeAwayDelete(): Promise<void> {
  const list = await admin.get("/admin/api/permissions?page=1&limit=1000");
  expect(list.ok(), await list.text()).toBe(true);
  const { items } = (await list.json()) as {
    items: Array<{ id: string; slug: string }>;
  };
  const read = items.find(item => item.slug === "read-posts");
  if (!read) throw new Error('[e2e] No permission "read-posts".');
  const updated = await admin.patch(`/admin/api/roles/${limited.roleId}`, {
    data: { permissionIds: [read.id] },
  });
  expect(updated.ok(), await updated.text()).toBe(true);
}

test("a refused delete shows the server's message, and the post stays", async () => {
  await gotoAdmin(page, `/collections/posts/${postId}`);
  // The editor drew the post, so the Delete below is the one it offers.
  await expect(
    page.locator("main").getByRole("textbox", { name: "Excerpt", exact: true })
  ).toBeEditable();

  await takeAwayDelete();

  const answer = page.waitForResponse(
    response =>
      response.request().method() === "DELETE" &&
      response.url().includes(`/collections/posts/entries/${postId}`)
  );
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  const refusal = await answer;

  // The server refused it, and this is what it said.
  expect(refusal.status()).toBe(403);
  const { error } = (await refusal.json()) as { error: { message: string } };
  expect(error.message).toBe("You can't delete this post.");

  // The toast says exactly that, with nothing wrapped around it.
  await expect(page.getByText(error.message, { exact: true })).toBeVisible();
  await expect(page.getByText(/failed to delete/i)).toHaveCount(0);

  // Nothing was deleted, and the editor is still on the post.
  await expect(page).toHaveURL(new RegExp(`/collections/posts/${postId}$`));
  const read = await admin.get(
    `/admin/api/collections/posts/entries/${postId}`
  );
  expect(read.status(), await read.text()).toBe(200);
});
