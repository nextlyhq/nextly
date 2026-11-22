/**
 * Every pin is on the dashboard or one click away. With five pins kept, a
 * sixth pinned from its entry page shows at once at the head of the Continue
 * card's "Pinned" group, with the toast saying so; with seven, the card says
 * "View all pins (7)", whose dialog lists every pin newest first, each with
 * "Unpin", each opening its document where it opens.
 *
 * Only a browser shows this whole: the entry page's menu, the server's
 * order and split, the card's groups and footer, and the dialog loaded on
 * first open are four layers, and a unit test stubs at least one. Each spec
 * file signs in as an account of its own, so its pins are its alone.
 */
import { expect, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { LOCK } from "./support/locks";
import { ok } from "./support/releases-api";
import { test } from "./support/test";

// Reads the dashboard's cards; see support/locks.ts.
test.describe.configure({ lock: [LOCK.dashboard], mode: "serial" });

const API = "/admin/api";
const CARD = "core/continue";

/** A new post saved by the reader; its id. */
async function savePost(page: Page, title: string, slug: string) {
  const { item } = await ok<{ item: { id: string } }>(
    await page.request.post(`${API}/collections/posts/entries`, {
      data: { title, slug, status: "draft" },
    })
  );
  return item.id;
}

/** Pin a post through the same route the menu writes to. */
async function pinPost(page: Page, id: string) {
  await ok(
    await page.request.post(`${API}/dashboard/pins`, {
      data: { targetType: "collection", targetSlug: "posts", entryId: id },
    })
  );
}

/** `count` new posts, each pinned in turn, a moment apart so their order is sure. */
async function pinnedPosts(page: Page, stamp: string, count: number) {
  const posts: { id: string; title: string }[] = [];
  for (let i = 1; i <= count; i++) {
    const title = `Pinned e2e ${stamp} ${i}`;
    const id = await savePost(page, title, `pinned-e2e-${stamp}-${i}`);
    await pinPost(page, id);
    posts.push({ id, title });
    // SQLite keeps whole milliseconds; apart, the newest pin is sure.
    await page.waitForTimeout(20);
  }
  return posts;
}

test("a sixth pin shows at once at the head of Pinned, and the toast says it is there", async ({
  page,
}) => {
  const stamp = Date.now().toString(36);
  // Recent work of the reader's own that is not pinned, for Recent to show.
  for (let i = 1; i <= 3; i++) {
    await savePost(
      page,
      `Recent e2e ${stamp} ${i}`,
      `recent-e2e-${stamp}-${i}`
    );
  }
  await pinnedPosts(page, stamp, 5);
  const sixth = `Sixth pin e2e ${stamp}`;
  const sixthId = await savePost(page, sixth, `sixth-pin-e2e-${stamp}`);

  await gotoAdmin(page, `/collections/posts/${sixthId}`);
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Pin to dashboard" }).click();
  // The default dashboard holds the Continue card, so the toast says so.
  await expect(page.getByText("Pinned to your dashboard.")).toBeVisible();

  await gotoAdmin(page, "");
  const card = page.getByTestId(`widget-cell-${CARD}`);
  const pinned = card.getByRole("group", { name: "Pinned" });
  await expect(pinned.getByTestId("entity-row-title").first()).toHaveText(
    sixth
  );
  // Three pins on the default five rows, then Recent; six pins in all.
  await expect(pinned.getByTestId("entity-row")).toHaveCount(3);
  await expect(card.getByRole("group", { name: "Recent" })).toBeVisible();
  await expect(
    card.getByRole("button", { name: "View all pins (6)" })
  ).toBeVisible();
});

test("View all pins lists all seven, newest first, each opening its document, each with Unpin", async ({
  page,
}) => {
  // Starts from none: the file's account kept the last test's six.
  const before = await ok<{ items: Array<{ entryId: string }> }>(
    await page.request.get(`${API}/dashboard/pins`)
  );
  for (const pin of before.items) {
    await ok(
      await page.request.delete(`${API}/dashboard/pins`, {
        data: {
          targetType: "collection",
          targetSlug: "posts",
          entryId: pin.entryId,
        },
      })
    );
  }
  const stamp = Date.now().toString(36);
  const posts = await pinnedPosts(page, stamp, 7);
  const newestFirst = [...posts].reverse();

  await gotoAdmin(page, "");
  const card = page.getByTestId(`widget-cell-${CARD}`);
  const viewAll = card.getByRole("button", { name: "View all pins (7)" });
  await viewAll.click();
  const dialog = page.getByRole("dialog", { name: "Your pins" });
  await expect(dialog).toBeVisible();
  const rows = dialog.getByTestId("all-pins-row");
  await expect(rows).toHaveCount(7);
  await expect(rows.getByRole("link")).toHaveText(
    newestFirst.map(post => post.title)
  );
  for (const post of newestFirst) {
    await expect(
      dialog.getByRole("button", { name: `Unpin ${post.title}` })
    ).toBeVisible();
  }

  // Unpin takes it off the list, and off the server.
  const gone = newestFirst[6]!;
  await dialog.getByRole("button", { name: `Unpin ${gone.title}` }).click();
  await expect(rows).toHaveCount(6);
  const after = await ok<{ items: Array<{ entryId: string }> }>(
    await page.request.get(`${API}/dashboard/pins`)
  );
  expect(after.items.some(pin => pin.entryId === gone.id)).toBe(false);

  // A pin opens its document where a post opens: its form.
  const first = newestFirst[0]!;
  await dialog.getByRole("link", { name: first.title }).click();
  await expect(page).toHaveURL(
    new RegExp(`/admin/collections/posts/${first.id}(\\?|$)`)
  );
  await expect(page.getByRole("dialog", { name: "Your pins" })).toHaveCount(0);
});
