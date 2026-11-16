/**
 * History by keyboard alone: into the history panel by Tab, a version opened with Enter and
 * another with Space, the changes walked with Next and Previous change (each landing said
 * aloud), and the restore dialog opened, then closed with Escape, focus going back to the
 * control that opened it. Every stop shows where focus is.
 */
import { expect, type Locator, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { expectNoAxeViolations } from "./support/axe";
import { test } from "./support/test";

const ENTRIES = "/admin/api/collections/history-notes/entries";

/** A published note saved three times, so it has versions 1 to 3 with changes between them. */
async function noteWithThreeVersions(page: Page): Promise<string> {
  const stamp = Date.now();
  const created = await page.request.post(ENTRIES, {
    data: {
      title: `Keyboard note ${stamp}`,
      summary: "first summary",
      details: { subtitle: "first subtitle", byline: "Ana" },
      status: "published",
    },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const { item } = (await created.json()) as { item: { id: string } };
  for (const data of [
    {
      summary: "second summary",
      details: { subtitle: "second subtitle", byline: "Bo" },
    },
    { summary: "third summary" },
  ]) {
    const saved = await page.request.patch(`${ENTRIES}/${item.id}`, {
      data: { ...data, status: "published", _overwrite: true },
    });
    expect(saved.ok(), await saved.text()).toBe(true);
  }
  return item.id;
}

/** What has the keyboard's focus, by its accessible name or text. */
function focusedName(page: Page): Promise<string> {
  return page.evaluate(() => {
    const element = document.activeElement;
    return (
      element?.getAttribute("aria-label") ?? element?.textContent?.trim() ?? ""
    );
  });
}

/** Tab (or Shift+Tab) until the control with this name has focus. */
async function tabTo(
  page: Page,
  name: string | RegExp,
  direction: "forward" | "back" = "forward"
): Promise<void> {
  const key = direction === "forward" ? "Tab" : "Shift+Tab";
  for (let presses = 0; presses < 120; presses += 1) {
    const focused = await focusedName(page);
    if (typeof name === "string" ? focused === name : name.test(focused)) {
      return;
    }
    await page.keyboard.press(key);
  }
  throw new Error(`Tab never reached ${String(name)}`);
}

/** The focused element shows it: it matches `:focus-visible`, as a keyboard move leaves it. */
async function expectFocusShown(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(
        () => document.activeElement?.matches(":focus-visible") ?? false
      )
    )
    .toBe(true);
}

const comparison = (page: Page): Locator =>
  page.getByRole("region", { name: "Comparison" });

test.describe("history by keyboard alone", () => {
  test("reads versions, walks their changes and leaves the restore dialog, with focus shown at each stop", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const id = await noteWithThreeVersions(page);
    await gotoAdmin(page, `/collections/history-notes/${id}?history=1`);
    const panel = page.locator("[data-history-panel]");
    await expect(
      panel.getByRole("list", { name: "History, newest first" })
    ).toBeVisible({ timeout: 30_000 });

    // Into the panel and onto the first version by Tab; Enter opens it.
    await tabTo(page, /Version 1\b/);
    await expectFocusShown(page);
    await page.keyboard.press("Enter");
    await expect(comparison(page)).toBeVisible({ timeout: 30_000 });

    // Another version, opened with Space.
    await tabTo(page, /Version 2\b/, "back");
    await expectFocusShown(page);
    await page.keyboard.press("Space");
    await expect(comparison(page)).toContainText(/Version 2/, {
      timeout: 30_000,
    });

    // Next and Previous change: each lands on a changed field and says where.
    // They sit in the page above the history panel, so back from the panel.
    await tabTo(page, "Next change", "back");
    await expectFocusShown(page);
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("status").filter({ hasText: /^Change 2 of \d+: / })
    ).toHaveCount(1);
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.id ?? ""))
      .toMatch(/^version-change-/);
    await tabTo(page, "Previous change", "back");
    await expectFocusShown(page);
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("status").filter({ hasText: /^Change 1 of \d+: / })
    ).toHaveCount(1);

    // The restore dialog, opened by keyboard and closed with Escape: focus goes
    // back to the control that opened it, not to the top of the page.
    await tabTo(page, "Restore this version", "back");
    await expectFocusShown(page);
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    await expectNoAxeViolations(page, { include: '[role="alertdialog"]' });
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(
      page
        .getByRole("banner")
        .getByRole("button", { name: "Restore this version" })
    ).toBeFocused();
  });
});
