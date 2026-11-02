/**
 * Two people and one Single: an editor who gains it starts from the copy
 * that was saved while they waited.
 *
 * The Single counterpart of `entry-lock-fresh-copy`: B opens the playground's
 * homepage while A holds it, A saves its title, and when B gains it, by A
 * leaving or by B taking it over, B's form shows A's title before it lets B
 * type. B's read of the Single after the gain is held until the test lets it
 * go, so the form is seen read-only while the latest version is on its way.
 *
 * @module tests/single-lock-fresh-copy
 */
import {
  expect,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";

import { test } from "./support/test";
import {
  createSignedInUser,
  superAdminRoleId,
  uniqueTag,
} from "./support/accounts";
import { gotoAdmin } from "./support/admin";
import { EVERY_DIALECT } from "./support/every-dialect";
import { LOCK } from "./support/locks";

// Shares state with other specs; see support/locks.ts for what each lock guards.
test.describe.configure({ lock: [LOCK.homepage, LOCK.usersRoles] });

const HOMEPAGE_API = "/admin/api/singles/homepage";

/**
 * A second super-admin in a context of its own, so the two pages are two lock
 * holders.
 */
async function secondEditor(
  browser: Browser,
  first: Page,
  baseURL: string | undefined
): Promise<{ context: BrowserContext; page: Page }> {
  if (!baseURL) throw new Error("The suite configures no baseURL.");
  const { storageState } = await createSignedInUser(first.request, baseURL, {
    email: `second-editor-${uniqueTag()}@nextly.local`,
    name: "Second Editor",
    roleIds: [await superAdminRoleId(first.request)],
  });
  const context = await browser.newContext({ baseURL, storageState });
  return { context, page: await context.newPage() };
}

function title(page: Page) {
  return page.getByRole("textbox", { name: "Title", exact: true });
}

/**
 * Hold the page's reads of the homepage document until the returned release
 * is called, and say when the first one is asked for. Its schema and other
 * sub-resources carry more path after the slug.
 */
async function holdHomepageReads(page: Page) {
  const read = new RegExp(`${HOMEPAGE_API}(?:\\?|$)`);
  let release: () => void = () => {};
  const released = new Promise<void>(resolve => {
    release = resolve;
  });
  await page.route(read, async route => {
    if (route.request().method() !== "GET") return route.continue();
    await released;
    await route.continue();
  });
  const asked = page.waitForRequest(
    request => request.method() === "GET" && read.test(request.url()),
    { timeout: 45_000 }
  );
  return { asked, release };
}

test.describe(
  "an editor who gains a Single starts from the saved copy",
  { tag: EVERY_DIALECT },
  () => {
    test.describe.configure({ timeout: 120_000 });

    let before = "";
    test.beforeEach(async ({ page }) => {
      before = `Homepage before ${uniqueTag()}`;
      const stored = await page.request.patch(HOMEPAGE_API, {
        data: { title: before },
      });
      expect(stored.ok(), await stored.text()).toBe(true);
    });

    for (const way of ["leaves", "takes over"] as const) {
      const name =
        way === "leaves"
          ? "B sees A's saved value before the form unlocks after A leaves"
          : "B sees A's saved value before the form unlocks after B takes over";

      test(name, async ({ page, browser, baseURL }) => {
        const saved = `Saved by A ${uniqueTag()}`;
        await gotoAdmin(page, "/singles/homepage");
        await expect(title(page)).toBeEditable({ timeout: 30_000 });

        const other = await secondEditor(browser, page, baseURL);
        try {
          await gotoAdmin(other.page, "/singles/homepage");
          await expect(
            other.page.getByText(/is editing this document/)
          ).toBeVisible({ timeout: 30_000 });
          await expect(title(other.page)).toHaveValue(before);
          await expect(title(other.page)).not.toBeEditable();

          await title(page).fill(saved);
          const stored = page.waitForResponse(
            response =>
              response.url().includes(HOMEPAGE_API) &&
              response.request().method() === "PATCH",
            { timeout: 30_000 }
          );
          await page.getByRole("button", { name: /save draft/i }).click();
          expect((await stored).ok(), "A's save must be stored").toBe(true);

          const reads = await holdHomepageReads(other.page);
          if (way === "leaves") {
            // Leaving inside the admin, which releases the claim as the
            // editor unmounts.
            await page
              .getByRole("navigation", { name: "Breadcrumb" })
              .locator('a[href="/admin/singles"]')
              .click();
            await page.waitForURL(/\/singles$/);
          } else {
            await other.page.getByRole("button", { name: "Take over" }).click();
          }

          await reads.asked;
          await expect(
            other.page.getByText(/Loading the latest version/)
          ).toBeVisible();
          await expect(title(other.page)).not.toBeEditable();

          reads.release();
          await expect(title(other.page)).toHaveValue(saved, {
            timeout: 30_000,
          });
          await expect(title(other.page)).toBeEditable();
        } finally {
          await other.context.close();
        }
      });
    }
  }
);
