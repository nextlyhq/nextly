/**
 * A delete the server refuses is reported in the server's own words. A role
 * that may read, edit and delete Posts opens a post, and then loses
 * delete-posts, as when an admin changes the role while the post is open. The editor still
 * offers Delete, the server answers 403, and the toast reads the server's
 * message as it is, "You can't delete this post.", with nothing put in front
 * of it. The post is still there afterwards.
 *
 * Only a browser shows this whole: the request, the refusal's body and the
 * toast that reads it are three layers, and a unit test stubs at least one.
 */
import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { fileAccount, includingHidden, test } from "./support/test";

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
    "update-posts",
    "delete-posts",
  ]);
  page = await limited.context.newPage();
});

test.afterAll(async () => {
  await limited?.context.close();
  await admin?.dispose();
});

/**
 * Leave the role with read-posts and update-posts, through the route the roles
 * screen uses. Without update-posts the editor opens read-only.
 */
async function takeAwayDelete(): Promise<void> {
  const list = await admin.get("/admin/api/permissions?page=1&limit=1000");
  expect(list.ok(), await list.text()).toBe(true);
  const { items } = (await list.json()) as {
    items: Array<{ id: string; slug: string }>;
  };
  const kept = ["read-posts", "update-posts"].map(slug => {
    const found = items.find(item => item.slug === slug);
    if (!found) throw new Error(`[e2e] No permission "${slug}".`);
    return found.id;
  });
  const updated = await admin.patch(`/admin/api/roles/${limited.roleId}`, {
    data: { permissionIds: kept },
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
  await expect(
    includingHidden(page).getByText(/failed to delete/i)
  ).toHaveCount(0);

  // Nothing was deleted, and the editor is still on the post.
  await expect(page).toHaveURL(new RegExp(`/collections/posts/${postId}$`));
  // `status=all`: the post is a draft, and the REST read answers only
  // published entries unless asked for every status.
  const read = await admin.get(
    `/admin/api/collections/posts/entries/${postId}?status=all`
  );
  expect(read.status(), await read.text()).toBe(200);
});
