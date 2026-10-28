/**
 * Recently edited lists a document the reader just saved, and its row opens
 * that document.
 *
 * A post is saved, so its save is the newest on the trail. The card lists it by
 * its title, with the collection and who saved it beside it, and the title's
 * link opens the post's own edit page. Which of several saves heads a row is
 * the integration suite's, on every dialect: here, on SQLite's whole-second
 * times, two saves in one second could stand in either order.
 *
 * Other specs save documents of their own into the shared database, so the
 * spec finds its post by a stamp rather than by its place in the list.
 */
import { expect } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { LOCK } from "./support/locks";
import { ok } from "./support/releases-api";
import { test } from "./support/test";

// Shares state with other specs; see support/locks.ts for what each lock guards.
test.describe.configure({ lock: [LOCK.dashboard] });

const API = "/admin/api";
const CARD = "core/recently-edited";

test("a row of the card opens the document it lists", async ({ page }) => {
  const stamp = Date.now().toString(36);
  const title = `Recently edited e2e ${stamp}`;
  const { item } = await ok<{ item: { id: string } }>(
    await page.request.post(`${API}/collections/posts/entries`, {
      data: { title, slug: `recently-edited-e2e-${stamp}`, status: "draft" },
    })
  );

  await gotoAdmin(page, "");
  const card = page.getByTestId(`widget-cell-${CARD}`);
  await expect(card).toBeVisible();

  const row = card.getByTestId("entity-row").filter({ hasText: title });
  await expect(row).toHaveCount(1);
  // The row says where it lives, by the collection's label as the reader is shown it.
  await expect(row).toContainText(/posts/i);

  const link = row.getByRole("link", { name: title });
  await expect(link).toHaveAttribute(
    "href",
    new RegExp(`/admin/collections/posts/${item.id}(\\?|$)`)
  );
  await link.click();
  await expect(page).toHaveURL(
    new RegExp(`/admin/collections/posts/${item.id}(\\?|$)`)
  );
});
