/**
 * Sharing a preview from the editor: a link made for a chosen time and copied
 * in one step, the page's live links listed with who made each, when it ends
 * and how often it was opened, and any one revoked so that only it stops.
 *
 * Asked of the real server as a reviewer meets it: each link is opened by a
 * visitor with no session, and a revoked one is refused while the other still
 * redirects. Links made before links were recorded are signed here as an
 * earlier version minted them, shown as one row, and ended by revoke-all.
 */
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { olderPreviewToken } from "./support/preview-links";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

/** The site's address, so a link names this server rather than another. */
async function useThisSite(page: Page, baseURL: string): Promise<void> {
  const saved = await page.request.patch("/admin/api/general-settings", {
    data: { siteUrl: baseURL },
  });
  expect(saved.ok(), `saving the site URL: ${saved.status()}`).toBe(true);
}

async function blockPage(page: Page, title: string): Promise<string> {
  const created = await page.request.post(
    "/admin/api/collections/block-pages/entries",
    {
      data: {
        title,
        slug: `share-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      },
    }
  );
  expect(created.ok()).toBe(true);
  const { item } = (await created.json()) as { item: { id: string } };
  return item.id;
}

/** Open the share popover from the preview control's menu. */
async function openShare(page: Page): Promise<void> {
  await page.getByRole("button", { name: /preview options$/i }).click();
  await page.getByRole("menuitem", { name: "Share preview link…" }).click();
  await expect(
    page.getByRole("heading", { name: "Share a preview" })
  ).toBeVisible();
}

/**
 * Make a link for the chosen lifetime, and read it back off the clipboard.
 *
 * Waits for the clipboard itself to change rather than for the confirmation:
 * the previous link's confirmation may still be on screen, and reading then
 * would hand back the previous link.
 */
async function createLink(page: Page, lifetime: string): Promise<string> {
  const before = await page.evaluate(() =>
    navigator.clipboard.readText().catch(() => "")
  );
  await page.getByRole("radio", { name: lifetime }).check();
  await page.getByRole("button", { name: "Create and copy link" }).click();
  let url = "";
  await expect
    .poll(async () => {
      url = await page.evaluate(() => navigator.clipboard.readText());
      return url !== before && /\/api\/preview\?token=/.test(url);
    })
    .toBe(true);
  return url;
}

function liveRows(page: Page) {
  return page.locator("[data-share-links] > li");
}

/**
 * The live row of the link a URL carries, found by the link's id: the token's
 * `jti`. Two links made in the same second have no order between them, so a
 * row's position names neither.
 */
function rowOf(page: Page, url: string) {
  const token = new URL(url).searchParams.get("token") ?? "";
  const payload = JSON.parse(
    Buffer.from(token.split(".")[1] ?? "", "base64url").toString()
  ) as { jti: string };
  return page.locator(`[data-share-link="${payload.jti}"]`);
}

/** Revoke every link of the page, and wait until the server has. */
async function revokeAll(page: Page): Promise<void> {
  await page
    .getByRole("button", { name: "Revoke all links to this page" })
    .click();
  await page.getByRole("button", { name: "Revoke all", exact: true }).click();
  await expect(
    page.getByText("All links to this page are revoked.", { exact: false })
  ).toBeVisible();
}

/** What a visitor with no session gets from a link: a redirect, or 404. */
async function opens(
  visitor: APIRequestContext,
  url: string
): Promise<boolean> {
  const response = await visitor.get(url, { maxRedirects: 0, timeout: 60_000 });
  expect([307, 404]).toContain(response.status());
  return response.status() === 307;
}

test.describe("sharing a preview", () => {
  test("an entry's links are made, listed and revoked one at a time", async ({
    page,
    playwright,
  }, testInfo) => {
    const baseURL = testInfo.project.use.baseURL!;
    const visitor = await playwright.request.newContext({ baseURL });
    try {
      await useThisSite(page, baseURL);
      const id = await blockPage(page, "Share entry");
      await gotoAdmin(page, `/collections/block-pages/${id}`);

      await openShare(page);
      const first = await createLink(page, "3 days");
      await expect(liveRows(page)).toHaveCount(1);
      await expect(liveRows(page).first()).toContainText("Not opened yet");
      const second = await createLink(page, "1 hour");
      await expect(liveRows(page)).toHaveCount(2);

      expect(await opens(visitor, first)).toBe(true);
      expect(await opens(visitor, second)).toBe(true);

      await rowOf(page, first)
        .getByRole("button", { name: /^Revoke the link/ })
        .click();
      await expect(liveRows(page)).toHaveCount(1);
      await expect(rowOf(page, second)).toBeVisible();

      expect(await opens(visitor, first)).toBe(false);
      expect(await opens(visitor, second)).toBe(true);

      // Everything, after asking once more.
      await revokeAll(page);
      await expect(page.getByText("No live links to this page.")).toBeVisible();
      expect(await opens(visitor, second)).toBe(false);
    } finally {
      await visitor.dispose();
    }
  });

  test("a Single's links are made, listed and revoked", async ({
    page,
    playwright,
  }, testInfo) => {
    const baseURL = testInfo.project.use.baseURL!;
    const visitor = await playwright.request.newContext({ baseURL });
    try {
      await useThisSite(page, baseURL);
      await gotoAdmin(page, "/singles/landing-page");

      await openShare(page);
      const link = await createLink(page, "1 day");
      await expect(rowOf(page, link)).toBeVisible();
      expect(await opens(visitor, link)).toBe(true);

      await rowOf(page, link)
        .getByRole("button", { name: /^Revoke the link/ })
        .click();
      await expect(rowOf(page, link)).toHaveCount(0);
      expect(await opens(visitor, link)).toBe(false);
    } finally {
      await visitor.dispose();
    }
  });

  test("on a phone, the popover opens from the document menu and every action in it is reachable", async ({
    page,
    playwright,
  }, testInfo) => {
    const baseURL = testInfo.project.use.baseURL!;
    const visitor = await playwright.request.newContext({ baseURL });
    try {
      await useThisSite(page, baseURL);
      const id = await blockPage(page, "Share phone");
      await page.setViewportSize({ width: 390, height: 844 });
      await gotoAdmin(page, `/collections/block-pages/${id}`);

      // The preview control folds into the document's menu at this width.
      await page.getByRole("button", { name: "More actions" }).click();
      await page.getByRole("menuitem", { name: "Share preview link…" }).click();
      await expect(
        page.getByRole("heading", { name: "Share a preview" })
      ).toBeVisible();
      const first = await createLink(page, "1 hour");
      const second = await createLink(page, "7 days");
      await expect(liveRows(page)).toHaveCount(2);

      // The popover is taller than what is left of the screen, and scrolls
      // within itself: the last action is still there to press.
      await revokeAll(page);
      expect(await opens(visitor, first)).toBe(false);
      expect(await opens(visitor, second)).toBe(false);
    } finally {
      await visitor.dispose();
    }
  });

  test("links made before links were recorded show as one row, ended by revoke-all", async ({
    page,
    playwright,
  }, testInfo) => {
    const baseURL = testInfo.project.use.baseURL!;
    const visitor = await playwright.request.newContext({ baseURL });
    try {
      await useThisSite(page, baseURL);
      const id = await blockPage(page, "Share older");
      const session = await page.request.get("/admin/api/auth/session");
      const { user } = (await session.json()) as { user: { id: string } };
      const older = `${baseURL}/api/preview?token=${olderPreviewToken({
        collection: "block-pages",
        entryId: id,
        minter: user.id,
        generation: 0,
        ttlSeconds: 24 * 60 * 60,
      })}`;
      // The premise: the earlier link works.
      expect(await opens(visitor, older)).toBe(true);

      await gotoAdmin(page, `/collections/block-pages/${id}`);
      await openShare(page);
      const row = page.locator("[data-share-older]");
      await expect(row).toContainText("Earlier links");
      await expect(row).toContainText("can only be revoked all together");
      // It carries no id, so it is not one of the live rows.
      await expect(liveRows(page)).toHaveCount(0);

      await revokeAll(page);

      expect(await opens(visitor, older)).toBe(false);
      await expect(row).toHaveCount(0);
    } finally {
      await visitor.dispose();
    }
  });
});
