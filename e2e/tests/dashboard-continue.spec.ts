/**
 * Continue where you left off lists the documents the reader just saved, a
 * row opens its document, and pinning one from its row's menu puts it first.
 *
 * Mine is the card's default tab and lists only the reader's own work, and
 * each spec file signs in as an account of its own, so other specs' saves
 * never reach this card. Which of several saves heads a row is the
 * integration suite's, on every dialect: here, on SQLite's whole-second
 * times, two saves in one second could stand in either order, so the spec
 * finds its posts by a stamp and asserts an order only once a pin decides it.
 */
import { expect, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { LOCK } from "./support/locks";
import { ok } from "./support/releases-api";
import { test } from "./support/test";

// Shares state with other specs; see support/locks.ts for what each lock guards.
test.describe.configure({ lock: [LOCK.dashboard] });

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

test("a row of the card opens the document it lists", async ({ page }) => {
  const stamp = Date.now().toString(36);
  const title = `Continue e2e ${stamp}`;
  const id = await savePost(page, title, `continue-e2e-${stamp}`);

  await gotoAdmin(page, "");
  const card = page.getByTestId(`widget-cell-${CARD}`);
  await expect(card).toBeVisible();

  const row = card.getByTestId("entity-row").filter({ hasText: title });
  await expect(row).toHaveCount(1);
  // The row says where it lives and that it was edited.
  await expect(row).toContainText(/posts/i);
  await expect(row).toContainText("edited");

  const link = row.getByRole("link", { name: title });
  await expect(link).toHaveAttribute(
    "href",
    new RegExp(`/admin/collections/posts/${id}(\\?|$)`)
  );
  await link.click();
  await expect(page).toHaveURL(
    new RegExp(`/admin/collections/posts/${id}(\\?|$)`)
  );
});

test("pinning a row from its menu puts it first on Mine, and unpinning lets it go", async ({
  page,
}) => {
  const stamp = Date.now().toString(36);
  const older = `Continue pin e2e ${stamp}`;
  const olderId = await savePost(page, older, `continue-pin-e2e-${stamp}`);

  await gotoAdmin(page, "");
  const card = page.getByTestId(`widget-cell-${CARD}`);
  const row = card.getByTestId("entity-row").filter({ hasText: older });
  await expect(row).toHaveCount(1);

  const pinned = page.waitForResponse(
    response =>
      response.request().method() === "POST" &&
      response.url().endsWith("/dashboard/pins")
  );
  await row.getByRole("button", { name: `Actions for ${older}` }).click();
  await page.getByRole("menuitem", { name: "Pin to dashboard" }).click();
  expect((await pinned).ok()).toBe(true);

  // Drawn again from the server's answer: the pin heads Mine.
  await expect(
    card.getByTestId("entity-row").first().getByTestId("entity-row-title")
  ).toHaveText(older);
  // Kept on the server: after a reload the row's menu offers the other verb.
  await page.reload();
  await card
    .getByTestId("entity-row")
    .filter({ hasText: older })
    .getByRole("button", { name: `Actions for ${older}` })
    .click();
  const unpinned = page.waitForResponse(
    response =>
      response.request().method() === "DELETE" &&
      response.url().endsWith("/dashboard/pins")
  );
  await page.getByRole("menuitem", { name: "Unpin from dashboard" }).click();
  expect((await unpinned).ok()).toBe(true);

  const pins = await ok<{ items: Array<{ entryId: string }> }>(
    await page.request.get(`${API}/dashboard/pins`)
  );
  expect(pins.items.some(pin => pin.entryId === olderId)).toBe(false);
});

test("the header's Mine and Team switch what the card lists", async ({
  page,
}) => {
  const stamp = Date.now().toString(36);
  const title = `Continue tabs e2e ${stamp}`;
  await savePost(page, title, `continue-tabs-e2e-${stamp}`);

  await gotoAdmin(page, "");
  const card = page.getByTestId(`widget-cell-${CARD}`);
  const tabs = card.getByRole("radiogroup", {
    name: /^Show for Continue where you left off/,
  });
  const row = card.getByTestId("entity-row").filter({ hasText: title });
  await expect(tabs.getByRole("radio", { name: "Mine" })).toHaveAttribute(
    "aria-checked",
    "true"
  );
  await expect(row).toHaveCount(1);

  // Team is other people's saves: the reader's own post is not on it.
  await tabs.getByRole("radio", { name: "Team" }).click();
  await expect(tabs.getByRole("radio", { name: "Team" })).toHaveAttribute(
    "aria-checked",
    "true"
  );
  await expect(row).toHaveCount(0);

  // The arrow keys move back to Mine and choose it, as a radio group does.
  await tabs.getByRole("radio", { name: "Team" }).press("ArrowLeft");
  await expect(tabs.getByRole("radio", { name: "Mine" })).toHaveAttribute(
    "aria-checked",
    "true"
  );
  await expect(row).toHaveCount(1);
});
