/**
 * The rail's foot: the reader's Inbox and account menu, at every window height.
 *
 * The rail holds the logo, every section's entry and, at its foot, the bell and
 * the avatar. On a window too short for all of them the entries scroll and the
 * foot stays in view, so the account menu is never pushed below the window
 * with nothing to scroll.
 *
 * @module tests/admin-rail-account.spec
 */
import { expect } from "@playwright/test";

import { test } from "./support/test";
import { gotoAdmin } from "./support/admin";
import { waitForShellAnswers } from "./support/shell-geometry";

test("keeps the account menu in reach on a short window", async ({ page }) => {
  // Shorter than the rail's logo, nine entries and its foot together.
  await page.setViewportSize({ width: 1440, height: 600 });
  await gotoAdmin(page, "/");
  await waitForShellAnswers(page);

  const foot = page.getByTestId("rail-account");
  const avatar = foot.getByRole("button", { name: "User profile menu" });
  await expect(avatar).toBeInViewport({ ratio: 1 });
  await expect(
    foot.getByRole("button", { name: /notifications/i })
  ).toBeInViewport({
    ratio: 1,
  });

  await avatar.click();
  await expect(page.getByRole("menuitem", { name: "Sign out" })).toBeVisible();
});
