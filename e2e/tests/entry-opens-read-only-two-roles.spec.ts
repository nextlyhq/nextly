/**
 * A user holding two roles, each of which may only read Posts, opens a post
 * read-only exactly as one such role does: holding read twice grants no
 * change. `entry-opens-read-only.spec.ts` is the one-role case, and
 * `entry-list-editor.spec.ts` the control that may change Posts.
 */
import { expect, type Page } from "@playwright/test";

import { test } from "./support/test";
import { STORAGE_STATE } from "../global-setup";

import { gotoAdmin } from "./support/admin";
import { signInWithRoles } from "./support/limited-user";
import { createEntry } from "./support/runtime-collection";

// One signed-in user for the whole file: signing in spends the auth budget.
test.describe.configure({ mode: "serial" });

const RUN = Date.now().toString(36);

let reader: Awaited<ReturnType<typeof signInWithRoles>>;
let page: Page;
let postId: string;

test.beforeAll(async ({ browser, playwright }, testInfo) => {
  const baseURL = testInfo.project.use.baseURL;
  if (baseURL === undefined) throw new Error("[e2e] No baseURL configured.");
  const admin = await playwright.request.newContext({
    baseURL,
    storageState: STORAGE_STATE,
  });
  try {
    postId = await createEntry(admin, "posts", {
      title: `A post two roles read ${RUN}`,
      slug: `two-roles-${RUN}`,
    });
    reader = await signInWithRoles(browser, admin, baseURL, [
      ["read-posts"],
      ["read-posts"],
    ]);
  } finally {
    await admin.dispose();
  }
  page = await reader.context.newPage();
});

test.afterAll(async () => {
  await reader?.context.close();
});

test("opens a post read-only, with the same banner one role gets", async () => {
  await gotoAdmin(page, `/collections/posts/${postId}`);
  await expect(page.getByTestId("document-lock-banner")).toHaveText(
    "Your access lets you view this, but not change it. If you need to change it, ask an admin."
  );
  await expect(
    page.locator("main").getByRole("textbox", { name: "Excerpt", exact: true })
  ).not.toBeEditable();
  await expect(page.locator('[data-primary="true"]')).toHaveCount(0);
});
