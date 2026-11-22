/**
 * The entry page shows its status once and its address always.
 *
 * The status pill sits beside the title; scrolled until the title is gone,
 * the sticky bar shows it instead, and back at the top only the title's is
 * there, so at every point exactly one pill is visible. Counted as the
 * browser sees it, because the property is about what is on screen, which a
 * component test cannot measure.
 *
 * On a phone-sized touch screen the address chip's buttons are on screen
 * without any pointer hovering, since a finger has no hover to reveal them.
 */
import { expect, type Page } from "@playwright/test";

import { uniqueTag } from "./support/accounts";
import { gotoAdmin } from "./support/admin";
import { createEntry } from "./support/runtime-collection";
import { test } from "./support/test";

/**
 * Where each status pill on screen is: "title" for the one on the title's
 * row, "bar" for one in the sticky bar (which sits in the admin's top bar on
 * a wide screen). A pill counts only where it is what the screen shows at its
 * own centre, so one scrolled away or covered by the bar does not.
 */
async function pillsOnScreen(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const main = document.querySelector("main");
    const where: string[] = [];
    for (const pill of Array.from(document.querySelectorAll("[data-status]"))) {
      const box = pill.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      const seen = document.elementFromPoint(
        box.left + box.width / 2,
        box.top + box.height / 2
      );
      if (!seen || !pill.contains(seen)) continue;
      const byTitle =
        main?.contains(pill) === true &&
        pill.closest("[data-testid='document-bar']") === null;
      where.push(byTitle ? "title" : "bar");
    }
    return where;
  });
}

const title = (page: Page) =>
  page.locator("main").getByRole("textbox", { name: "Title", exact: true });

test("one status pill is visible as a long entry scrolls", async ({ page }) => {
  // Short enough that the post's own fields scroll the title away.
  await page.setViewportSize({ width: 1280, height: 520 });
  const tag = uniqueTag();
  const id = await createEntry(page.request, "posts", {
    title: `Status once ${tag}`,
    slug: `status-once-${tag}`,
    excerpt: "A post long enough to scroll.",
  });
  await gotoAdmin(page, `/collections/posts/${id}`);
  await expect(title(page)).toHaveValue(`Status once ${tag}`, {
    timeout: 30_000,
  });

  // At the top: one pill, beside the title.
  await expect.poll(() => pillsOnScreen(page)).toEqual(["title"]);

  // Scrolled until the title is out of view: still one, now in the bar.
  await title(page).hover();
  for (let i = 0; i < 12 && (await title(page).isVisible()); i += 1) {
    await page.mouse.wheel(0, 400);
  }
  await expect
    .poll(async () => {
      const box = await title(page).boundingBox();
      return box === null || box.y + box.height < 120;
    })
    .toBe(true);
  await expect.poll(() => pillsOnScreen(page)).toEqual(["bar"]);

  // Back at the top: one again, beside the title.
  for (let i = 0; i < 12; i += 1) await page.mouse.wheel(0, -400);
  await expect(title(page)).toBeInViewport();
  await expect.poll(() => pillsOnScreen(page)).toEqual(["title"]);
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("the address chip's buttons are visible without hovering", async ({
    page,
  }) => {
    const tag = uniqueTag();
    const id = await createEntry(page.request, "posts", {
      title: `Address chip ${tag}`,
      slug: `address-chip-${tag}`,
    });
    await gotoAdmin(page, `/collections/posts/${id}`);
    const chip = page.getByTestId("document-address");
    await expect(chip).toContainText(`address-chip-${tag}`, {
      timeout: 30_000,
    });
    for (const name of ["Copy address", "Edit address"]) {
      const button = chip.getByRole("button", { name });
      await expect(button).toBeVisible();
      // Big enough for a finger.
      const box = await button.boundingBox();
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(32);
    }
  });
});
