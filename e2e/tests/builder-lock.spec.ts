/**
 * Two people and one page: the Page Builder keeps the document's soft lock.
 *
 * The second person sees the page read-only, named as held by the first, and
 * can ask for access; a takeover moves the document to them, and the first
 * person's unsaved edits are still theirs — in their form, unsaved, ready for
 * when they take the page back.
 *
 * Two browser contexts, signed in as two different users: the lock is held per
 * user, so one user in two tabs is one holder and proves nothing.
 *
 * @module tests/builder-lock
 */
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";

import { gotoAdmin } from "./support/admin";

const OPEN_BUILDER_ACTION = /^(?:Build this page|Open Page Builder)$/;
const HOMEPAGE_API = "/admin/api/singles/homepage";
const SECOND_PASSWORD = "Second-Editor-Pass-123!";

function heading(id: string, text: string) {
  return { id, type: "core/heading", version: 1, props: { text, level: "h2" } };
}

function block(page: Page, id: string) {
  return page.locator(`.nx-canvas [data-nx-node="${id}"]`).first();
}

/** A second super-admin, signed in in a context of its own. */
async function secondEditor(
  browser: Browser,
  first: Page
): Promise<{ context: BrowserContext; page: Page }> {
  const roles = await first.request.get("/admin/api/roles?pageSize=100");
  expect(roles.ok(), `listing roles: ${roles.status()}`).toBe(true);
  const { items } = (await roles.json()) as {
    items: { id: string; slug: string }[];
  };
  const superAdmin = items.find(role => role.slug === "super-admin");
  expect(superAdmin, "the super-admin role").toBeDefined();

  const email = `second-editor-${Date.now()}@nextly.local`;
  const created = await first.request.post("/admin/api/users", {
    data: {
      name: "Second Editor",
      email,
      password: SECOND_PASSWORD,
      isActive: true,
      roles: [superAdmin?.id],
    },
  });
  expect(created.ok(), `creating the second editor: ${created.status()}`).toBe(
    true
  );

  const context = await browser.newContext({ storageState: undefined });
  const page = await context.newPage();
  await page.goto("/admin/login");
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(SECOND_PASSWORD);
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  await page.waitForURL(/\/admin(?!\/login)/, { timeout: 30_000 });
  return { context, page };
}

async function openBuilder(page: Page): Promise<void> {
  await gotoAdmin(page, "/singles/homepage");
  await page.getByRole("link", { name: OPEN_BUILDER_ACTION }).click();
}

test.describe("two editors on one page", () => {
  test.beforeEach(async ({ page }) => {
    const stored = await page.request.patch(HOMEPAGE_API, {
      data: {
        layout: {
          formatVersion: 1,
          kind: "page",
          nodes: [heading("first", "First"), heading("second", "Second")],
        },
      },
    });
    expect(stored.ok()).toBe(true);
  });

  test("the second sees it read-only, named as held, and can ask for it", async ({
    page,
    browser,
  }) => {
    await openBuilder(page);
    await expect(block(page, "first")).toBeVisible({ timeout: 30_000 });

    const other = await secondEditor(browser, page);
    try {
      await openBuilder(other.page);
      await expect(
        other.page.getByText(/is editing this document/)
      ).toBeVisible({ timeout: 30_000 });
      // Read-only: the page is drawn, the editor's toolbar is not.
      await expect(
        other.page.getByRole("banner", { name: "Editor actions" })
      ).toHaveCount(0);

      await other.page
        .getByRole("button", { name: "Request edit access" })
        .click();
      // The holder learns at its next heartbeat that someone is waiting.
      await expect(
        page.getByText("Someone is waiting to edit this document.")
      ).toBeVisible({ timeout: 45_000 });
    } finally {
      await other.context.close();
    }
  });

  test("a takeover keeps the displaced author's unsaved edits", async ({
    page,
    browser,
  }) => {
    await openBuilder(page);
    await expect(block(page, "second")).toBeVisible({ timeout: 30_000 });
    await block(page, "second").click();
    await page.keyboard.press("Delete");
    await expect(block(page, "second")).toHaveCount(0);

    const other = await secondEditor(browser, page);
    try {
      await openBuilder(other.page);
      await other.page.getByRole("button", { name: "Take over" }).click();
      // The new holder edits the page as stored: the first author's edit was
      // never saved, so it is not theirs to see.
      await expect(block(other.page, "second")).toBeVisible({
        timeout: 30_000,
      });

      // The first author is told, and their edit is still in their page.
      await expect(
        page.getByText(
          /took over this document\. Your unsaved changes are still here/
        )
      ).toBeVisible({ timeout: 45_000 });
      // Drawn read-only now, outside the editor's canvas.
      await expect(
        page.locator('[data-nx-node="first"]').first()
      ).toBeVisible();
      await expect(page.locator('[data-nx-node="second"]')).toHaveCount(0);
    } finally {
      await other.context.close();
    }
  });
});
