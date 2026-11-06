/**
 * Making a release from the Releases page, in a real browser and by keyboard
 * alone: New release opens a dialog that takes focus, holds it, and gives it
 * back on Escape; the name and description go in, and Create release lands on
 * the new release's own page, a draft. The dialog is checked with axe.
 */
import { expect } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { expectNoAxeViolations } from "./support/axe";
import { test } from "./support/test";

const API = "/admin/api";

test("makes a release by keyboard, and lands on its page as a draft", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const title = `Created e2e ${Date.now().toString(36)}`;
  let releaseId: string | undefined;
  try {
    await gotoAdmin(page, "/releases");
    const opener = page
      .locator("main")
      .getByRole("button", { name: "New release" })
      .first();
    await opener.focus();
    await page.keyboard.press("Enter");

    const dialog = page.getByRole("dialog", { name: "New release" });
    await expect(dialog).toBeVisible();
    // Focus starts in the dialog, on the name.
    await expect(dialog.getByLabel("Name")).toBeFocused();
    await expectNoAxeViolations(page, { include: '[role="dialog"]' });

    // Escape closes it and gives focus back to what opened it.
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();

    await page.keyboard.press("Enter");
    await expect(dialog.getByLabel("Name")).toBeFocused();
    await page.keyboard.type(title);
    await page.keyboard.press("Tab");
    await expect(dialog.getByLabel(/^Description/)).toBeFocused();
    await page.keyboard.type("Made by keyboard alone.");
    // Tab stays inside the dialog: Cancel, then Create release.
    await page.keyboard.press("Tab");
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
    await page.keyboard.press("Tab");
    const create = dialog.getByRole("button", { name: "Create release" });
    await expect(create).toBeFocused();
    await page.keyboard.press("Enter");

    await expect(page).toHaveURL(/\/admin\/releases\/[^/?#]+$/);
    releaseId = new URL(page.url()).pathname.split("/").pop();
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await expect(page.locator("main").getByText("Draft").first()).toBeVisible();
    await expect(
      page.locator("main").getByText("Made by keyboard alone.")
    ).toBeVisible();
  } finally {
    // A draft is deleted outright, so nothing of this test is left behind.
    if (releaseId) {
      await page.request
        .delete(`${API}/releases/${releaseId}`)
        .catch(() => undefined);
    }
  }
});
