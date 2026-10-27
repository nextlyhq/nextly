/**
 * A role that may read Posts but not change them opens a post on the same page
 * an editor gets, read-only: a banner says their access lets them view it but
 * not change it, nothing saves or publishes it, and its history and id are
 * still there. A preview is not offered, and a Single opens the same way. At a
 * phone's width too.
 *
 * Only a browser shows this whole: the route, the lock, the fields and the
 * header are each their own component. `entry-list-editor.spec.ts` is the
 * control: a role that may change Posts gets the editable page, no banner and
 * the preview, so the absences here are the permission and not a page that
 * offers nothing to anyone.
 */
import { expect, type Page } from "@playwright/test";

import { test } from "./support/test";
import { STORAGE_STATE } from "../global-setup";

import { gotoAdmin } from "./support/admin";
import { signInAsLimitedUser, type LimitedUser } from "./support/limited-user";
import { LOCK } from "./support/locks";
import { createEntry } from "./support/runtime-collection";

// One signed-in user for the whole file: signing in spends the auth budget.
// Shares state with other specs; see support/locks.ts for what each lock guards.
test.describe.configure({ mode: "serial", lock: [LOCK.siteSettings] });

// Unique to this attempt: a retry runs `beforeAll` again.
const RUN = Date.now().toString(36);

let limited: LimitedUser;
let page: Page;
let postId: string;
let blockPageId: string;

test.beforeAll(async ({ browser, playwright }, testInfo) => {
  const baseURL = testInfo.project.use.baseURL;
  if (baseURL === undefined) throw new Error("[e2e] No baseURL configured.");
  const admin = await playwright.request.newContext({
    baseURL,
    storageState: STORAGE_STATE,
  });
  try {
    postId = await createEntry(admin, "posts", {
      title: `A post to read ${RUN}`,
      slug: `read-only-page-${RUN}`,
    });
    // A collection with a preview, so its absence below is the permission.
    blockPageId = await createEntry(admin, "block-pages", {
      title: `A page to read ${RUN}`,
      slug: `read-only-block-${RUN}`,
    });
    limited = await signInAsLimitedUser(browser, admin, baseURL, [
      "read-posts",
      "read-block-pages",
      "read-site-settings",
    ]);
  } finally {
    await admin.dispose();
  }
  page = await limited.context.newPage();
});

test.afterAll(async () => {
  await limited?.context.close();
});

const READER_NOTICE =
  "Your access lets you view this, but not change it. If you need to change it, ask an admin.";

/**
 * Opens `path` and waits for the reader's banner. Every case below opens its
 * page itself and waits for this first: an absence checked on a page that
 * never drew would pass whatever the page offers.
 */
async function openAsReader(path: string): Promise<void> {
  await gotoAdmin(page, path);
  await expect(page.getByTestId("document-lock-banner")).toHaveText(
    READER_NOTICE
  );
}

const excerpt = () =>
  page.locator("main").getByRole("textbox", { name: "Excerpt", exact: true });

test("opens a post read-only, with a banner saying why", async () => {
  await openAsReader(`/collections/posts/${postId}`);
  await expect(page).toHaveURL(new RegExp(`/collections/posts/${postId}$`));
  await expect(excerpt()).toBeVisible();
  await expect(excerpt()).not.toBeEditable();
  // Nothing saves or publishes: no leading action, and no draft save.
  await expect(page.locator('[data-primary="true"]')).toHaveCount(0);
  await expect(page.locator('[data-action="save"]')).toHaveCount(0);
  // The id is still there to copy.
  await expect(
    page.getByRole("button", { name: "Copy ID to clipboard" })
  ).toBeVisible();
});

test("opens a post's history", async () => {
  await openAsReader(`/collections/posts/${postId}`);
  await page.getByRole("button", { name: "History", exact: true }).click();
  await expect(
    page
      .getByRole("dialog")
      .filter({ has: page.getByRole("heading", { name: "History" }) })
  ).toBeVisible();
  await page.keyboard.press("Escape");
});

test("offers no preview of a page it may only read", async () => {
  await openAsReader(`/collections/block-pages/${blockPageId}`);
  await expect(
    page.getByRole("button", { name: /preview options$/i })
  ).toHaveCount(0);
});

test("opens a Single read-only, with the same banner", async () => {
  await openAsReader("/singles/site-settings");
  await expect(page).toHaveURL(/\/singles\/site-settings$/);
  await expect(page.locator('[data-primary="true"]')).toHaveCount(0);
});

test("opens a post read-only at a phone's width, its id still to copy", async () => {
  await limited.context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.setViewportSize({ width: 390, height: 844 });
  try {
    await openAsReader(`/collections/posts/${postId}`);
    await expect(excerpt()).not.toBeEditable();
    await expect(page.locator('[data-primary="true"]')).toHaveCount(0);
    // The rail holding the id is hidden at this width; the strip offers it.
    await page.getByRole("button", { name: "Copy ID to clipboard" }).click();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe(postId);
  } finally {
    await page.setViewportSize({ width: 1280, height: 720 });
  }
});
