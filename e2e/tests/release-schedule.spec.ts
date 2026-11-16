/**
 * Scheduling a release from its own page, in a real browser: Schedule… opens a
 * dialog that takes focus and gives it back on Escape; a date, a time and a
 * zone go in, and the release is Scheduled, listed under Upcoming with the
 * time it was given. The dialog is checked with axe.
 */
import { expect } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { expectNoAxeViolations } from "./support/axe";
import { cancel, post, readRelease, release } from "./support/releases-api";
import { test } from "./support/test";

/** `YYYY-MM-DDTHH:MM` in UTC, as a datetime-local field takes it. */
function wallClockUtc(at: Date): string {
  return at.toISOString().slice(0, 16);
}

test("schedules a release from its page for a time in a named zone", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const stamp = Date.now().toString(36);
  const title = `Scheduled e2e ${stamp}`;
  const releaseId = await release(page, title, await post(page, stamp));
  // Whole minutes, three days on: well clear of now, on any runner's clock.
  const at = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
  at.setUTCSeconds(0, 0);
  try {
    await gotoAdmin(page, `/releases/${releaseId}`);
    const opener = page.getByRole("button", { name: "Schedule…" });
    await opener.click();

    const dialog = page.getByRole("dialog", { name: "Schedule this release" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("Date and time")).toBeFocused();
    await expectNoAxeViolations(page, { include: '[role="dialog"]' });

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();

    await page.keyboard.press("Enter");
    await dialog.getByLabel("Date and time").fill(wallClockUtc(at));
    await dialog.getByLabel("Timezone").fill("UTC");
    await dialog.getByRole("button", { name: "Schedule release" }).click();
    await expect(dialog).toHaveCount(0);

    // Stored as the instant and the zone it was given.
    await expect
      .poll(async () => (await readRelease(page, releaseId)).state)
      .toBe("scheduled");
    const stored = (await page.request
      .get(`/admin/api/releases/${releaseId}`)
      .then(response => response.json())) as {
      scheduledAt?: string;
      timezone?: string;
      item?: { scheduledAt?: string; timezone?: string };
    };
    const item = stored.item ?? stored;
    expect(Date.parse(item.scheduledAt ?? "")).toBe(at.getTime());
    expect(item.timezone).toBe("UTC");

    // Listed under Upcoming.
    await gotoAdmin(page, "/releases");
    await page.getByPlaceholder("Search by title or description").fill(title);
    await expect(page.getByRole("tab", { name: /^Upcoming/ })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    await expect(
      page.locator("main").getByText(title).filter({ visible: true })
    ).toBeVisible();
  } finally {
    await cancel(page, releaseId).catch(() => undefined);
  }
});
