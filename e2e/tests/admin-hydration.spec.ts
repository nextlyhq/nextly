/**
 * Admin screens draw while their reads are out without invalid nesting: no
 * block element inside a paragraph, which React reports in the console as
 * "In HTML, <div> cannot be a descendant of <p>. This will cause a hydration
 * error." and the Next.js overlay counts as an issue.
 *
 * Each case holds the read whose placeholder used to nest wrongly, so the
 * placeholder is on screen when the console is read: a read that answered at
 * once would pass without ever drawing it.
 *
 * @module tests/admin-hydration.spec
 */
import { expect, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { test } from "./support/test";

const ENTRIES = "/admin/api/collections/posts/entries";
const NESTING = /cannot be a descendant of|cannot contain a nested/;

/** Every console message about invalid nesting, from now on. */
function nestingErrors(page: Page): string[] {
  const seen: string[] = [];
  page.on("console", message => {
    if (NESTING.test(message.text())) seen.push(message.text());
  });
  return seen;
}

/** Hold every request matching `pattern` until `release` is called. */
async function hold(page: Page, pattern: string): Promise<() => void> {
  let release = () => {};
  const released = new Promise<void>(resolve => {
    release = resolve;
  });
  await page.route(pattern, async route => {
    try {
      await released;
      await route.continue();
    } catch {
      // The page went away while the request was held: nothing to answer.
    }
  });
  return release;
}

test.describe("admin screens nest their placeholders validly", () => {
  test("an entry page while its releases are checked", async ({ page }) => {
    const created = await page.request.post(ENTRIES, {
      data: { title: `Nesting ${Date.now()}` },
    });
    expect(created.ok(), `creating a post: ${created.status()}`).toBe(true);
    const { item } = (await created.json()) as { item: { id: string } };

    // Wide enough that the document panel, and its Publishing section, show.
    await page.setViewportSize({ width: 1440, height: 900 });
    const errors = nestingErrors(page);
    const release = await hold(page, "**/admin/api/releases*");
    await gotoAdmin(page, `/collections/posts/${item.id}`);

    // The Publishing section's placeholder is drawn: its words are for
    // screen readers only, so it is found by its busy region.
    const checking = page
      .locator('[aria-busy="true"]')
      .filter({ hasText: "Checking releases" });
    await expect(checking).toHaveCount(1, { timeout: 30_000 });
    expect(errors).toEqual([]);
    release();
    await expect(checking).toHaveCount(0, { timeout: 30_000 });
    await expect(page.getByText("Not scheduled.")).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("the dashboard while its setup steps load", async ({ page }) => {
    const errors = nestingErrors(page);
    await gotoAdmin(page, "");
    await expect(
      page.getByRole("heading", { level: 1 }).first()
    ).toBeVisible({ timeout: 30_000 });
    // Settled: every card has drawn its placeholder and its answer.
    await page.waitForLoadState("networkidle");
    expect(errors).toEqual([]);
  });
});
