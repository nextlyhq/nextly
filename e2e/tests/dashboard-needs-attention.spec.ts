/**
 * Needs attention's links open exactly what the card counted.
 *
 * A published post is edited without publishing, so it holds unpublished
 * changes. The card's link for posts opens the posts list under the same
 * condition the card counted with, and that list holds the post, with as
 * many entries as the card said.
 *
 * Other specs leave their own pending changes in the shared database, so the
 * spec reads the card's number back rather than assuming one, and finds its own
 * post by a stamp.
 */
import { expect } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { ok } from "./support/releases-api";
import { test } from "./support/test";

const API = "/admin/api";
const CARD = "core/needs-attention";

test("the card's link opens the posts it counted", async ({ page }) => {
  const stamp = Date.now().toString(36);
  const { item } = await ok<{ item: { id: string } }>(
    await page.request.post(`${API}/collections/posts/entries`, {
      data: {
        title: `Needs attention e2e ${stamp}`,
        slug: `needs-attention-e2e-${stamp}`,
        status: "published",
      },
    })
  );
  // No status named, on a published post: the edit is held as unpublished
  // changes and the live post stays as it was.
  await ok(
    await page.request.patch(`${API}/collections/posts/entries/${item.id}`, {
      data: { title: `Needs attention e2e ${stamp} (edited)` },
    })
  );

  await gotoAdmin(page, "");
  const card = page.getByTestId(`widget-cell-${CARD}`);
  await expect(card).toBeVisible();

  // The posts link: the kind's own when posts hold all of it, else the posts
  // part's. Either way its address names the condition the card counted with.
  const postsLink = card
    .getByRole("link")
    .filter({ hasText: /Posts|Unpublished changes/ })
    .and(card.locator('a[href*="/admin/collections/posts?"]'))
    .first();
  await expect(postsLink).toBeVisible();
  const href = (await postsLink.getAttribute("href")) ?? "";
  const where = new URLSearchParams(href.split("?")[1]).get("where");
  expect(JSON.parse(where ?? "null")).toEqual({ _pendingChange: true });
  // The number the card showed for that link, as it is spoken.
  const counted = Number(
    /:\s*(\d+)/.exec((await postsLink.getAttribute("aria-label")) ?? "")?.[1]
  );
  expect(counted).toBeGreaterThan(0);

  await postsLink.click();
  await expect(page).toHaveURL(/\/admin\/collections\/posts\?/);
  await expect(
    page.getByText(`Needs attention e2e ${stamp}`, { exact: false }).first()
  ).toBeVisible();

  // The list the link opened holds as many entries as the card counted: the
  // same condition, read as the same person, in the same language.
  const listed = await ok<{ meta: { total: number } }>(
    await page.request.get(
      `${API}/collections/posts/entries?status=all&limit=1&where=${encodeURIComponent(where ?? "")}`
    )
  );
  expect(listed.meta.total).toBe(counted);
});
