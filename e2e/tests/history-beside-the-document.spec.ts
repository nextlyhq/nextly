/**
 * History opens beside the document on a wide window and as a page on a
 * phone, and either way the editor underneath keeps what the author had: the
 * words they had not saved yet, and where they were on the page.
 *
 * Only a real browser can answer this: the panel's place comes from the
 * window's width, the layout keeps room for it, and the form has to survive
 * the panel opening and closing without remounting.
 */
import { test, expect, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";

const excerpt = (page: Page) =>
  page.locator("main").getByRole("textbox", { name: "Excerpt", exact: true });

/** A saved post, open in the editor, with a version in its history. */
async function savedPost(page: Page): Promise<void> {
  const stamp = Date.now();
  const title = `Beside ${stamp}`;
  await gotoAdmin(page, "/collections/posts/create");
  await page.getByRole("textbox", { name: "Title", exact: true }).fill(title);
  await excerpt(page).fill(`saved excerpt ${stamp}`);
  await page.getByRole("button", { name: /save draft/i }).click();
  // Saving a new entry returns to the list.
  await page.waitForURL(/\/collections\/posts$/, { timeout: 30_000 });
  await page.getByRole("link", { name: title }).click();
  await page.waitForURL(/\/collections\/posts\/(?!create$)[^/]+$/, {
    timeout: 30_000,
  });
  await expect(excerpt(page)).toHaveValue(`saved excerpt ${stamp}`, {
    timeout: 30_000,
  });
}

/**
 * How far the editor is scrolled. The admin scrolls a container of its own,
 * not the window, so this reads the field's nearest scrolling ancestor, and
 * `to` moves it.
 */
const editorScroll = (page: Page, to?: number) =>
  excerpt(page).evaluate((field, y) => {
    for (let node = field.parentElement; node; node = node.parentElement) {
      const overflow = getComputedStyle(node).overflowY;
      if (
        (overflow === "auto" || overflow === "scroll") &&
        node.scrollHeight > node.clientHeight
      ) {
        if (y !== undefined) node.scrollTop = y;
        return node.scrollTop;
      }
    }
    if (y !== undefined) window.scrollTo(0, y);
    return window.scrollY;
  }, to);

/** The history panel, by its heading. */
const panel = (page: Page) =>
  page.getByRole("dialog").filter({
    has: page.getByRole("heading", { name: "History", exact: true }),
  });

test.describe("history beside the document", () => {
  test("opens beside the editor on a wide window, keeping unsaved words", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await savedPost(page);
    await excerpt(page).fill("words not saved yet");

    await page.getByRole("button", { name: "History", exact: true }).click();
    await expect(panel(page)).toBeVisible({ timeout: 30_000 });
    expect(new URL(page.url()).searchParams.get("history")).toBe("1");

    // Beside: the editor is still on screen next to the panel, not under it.
    // Polled, because the layout makes room a frame after the panel appears.
    expect((await panel(page).boundingBox())?.width).toBe(400);
    await expect
      .poll(async () => {
        const panelBox = await panel(page).boundingBox();
        const fieldBox = await excerpt(page).boundingBox();
        if (!panelBox || !fieldBox) return Number.POSITIVE_INFINITY;
        return fieldBox.x + fieldBox.width - panelBox.x;
      })
      .toBeLessThanOrEqual(0);
    await expect(excerpt(page)).toHaveValue("words not saved yet");

    await page.getByRole("button", { name: "Close history" }).click();
    await expect(panel(page)).toBeHidden();
    expect(new URL(page.url()).searchParams.get("history")).toBeNull();
    // Closing is not leaving: nothing asked about unsaved work, and it is kept.
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await expect(excerpt(page)).toHaveValue("words not saved yet");
  });

  test("opens as a page on a phone, from the document's menu, keeping the place", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await savedPost(page);
    await excerpt(page).fill("phone words not saved");
    // A known place down the editor, so a panel that reset the scroll to the
    // top could not pass for one that kept it.
    await editorScroll(page, 400);
    await expect.poll(() => editorScroll(page)).toBeGreaterThan(0);
    const before = await editorScroll(page);

    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "History", exact: true }).click();
    await expect(panel(page)).toBeVisible({ timeout: 30_000 });

    // A page: the panel takes the whole width of the screen.
    const panelBox = await panel(page).boundingBox();
    expect(panelBox?.width).toBe(390);

    await page.getByRole("button", { name: "Close history" }).click();
    await expect(panel(page)).toBeHidden();
    await expect(excerpt(page)).toHaveValue("phone words not saved");
    expect(Math.abs((await editorScroll(page)) - before)).toBeLessThanOrEqual(
      4
    );
  });

  test("on a phone, reads a version with the page stepped aside, and comes back to the list", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await savedPost(page);
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "History", exact: true }).click();
    await expect(panel(page)).toBeVisible({ timeout: 30_000 });

    await panel(page)
      .getByRole("button", { name: /Version 1/ })
      .click();
    // Read in the document itself: the page over it steps aside.
    await expect(panel(page)).toBeHidden();
    const banner = page.getByRole("status").filter({ hasText: "past version" });
    await expect(banner).toBeVisible({ timeout: 30_000 });
    expect(new URL(page.url()).searchParams.get("version")).toBe("1");

    await banner.getByRole("button", { name: "History", exact: true }).click();
    await expect(panel(page)).toBeVisible();
    expect(new URL(page.url()).searchParams.get("version")).toBeNull();
  });
});
