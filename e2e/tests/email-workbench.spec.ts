/**
 * The email workbench against a real server, at phone, tablet and desktop
 * widths: the preview keeps its width beside the side sheet, nothing scrolls
 * sideways, a phone gets its tabs and its fixed bar, and an owner's email is
 * overridden, reset and the reset undone. Set `WORKBENCH_SHOTS_DIR` to keep
 * a screenshot of each width.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";

import { expect, type Page } from "@playwright/test";

import { test } from "./support/test";
import { gotoAdmin } from "./support/admin";
import { LOCK } from "./support/locks";

// Shares state with other specs; see support/locks.ts for what each lock guards.
test.describe.configure({ lock: [LOCK.email] });

const WIDTHS = [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
] as const;

/** Whether the page scrolls sideways, which no width may make it do. */
async function scrollsSideways(page: Page): Promise<boolean> {
  return page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth
  );
}

/** Open core's Welcome email in the workbench, from the Messages list. */
async function openWelcome(page: Page): Promise<void> {
  await gotoAdmin(page, "/email");
  // Below tablet width the list is cards; either way the name links in.
  await page
    .getByRole("link", { name: "Welcome Email", exact: true })
    .filter({ visible: true })
    .first()
    .click();
  await expect(page).toHaveURL(/\/admin\/email\/messages\/edit\//, {
    timeout: 30_000,
  });
  await expect(page.getByTestId("workbench-header")).toBeVisible({
    timeout: 30_000,
  });
}

/** Put Welcome back to core's version, whatever an earlier run left. */
async function resetIfCustomised(page: Page): Promise<void> {
  const reset = page.getByRole("button", { name: "Reset to Nextly's version" });
  if (await reset.isVisible()) {
    await reset.click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Reset", exact: true })
      .click();
    await expect(
      page.getByText(/Nextly keeps this email up to date/)
    ).toBeVisible({ timeout: 30_000 });
  }
}

async function box(page: Page, testId: string) {
  const found = await page.getByTestId(testId).boundingBox();
  expect(found, testId).not.toBeNull();
  return found!;
}

for (const size of WIDTHS) {
  test(`the workbench fits ${size.width} wide, beside its preview`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    await page.setViewportSize(size);
    await openWelcome(page);

    if (size.width < 640) {
      // A phone: one pane at a time, the actions in a bar at the bottom.
      for (const tab of ["Edit", "Preview", "Data", "Details"]) {
        await expect(page.getByRole("tab", { name: tab })).toBeVisible();
      }
      const bar = page.getByTestId("workbench-phone-bar");
      await expect(bar).toBeVisible();
      await expect(bar.getByRole("button", { name: "Save" })).toBeVisible();
      const barBox = await bar.boundingBox();
      expect(barBox!.y + barBox!.height).toBeCloseTo(size.height, 0);

      await page.getByRole("tab", { name: "Preview" }).click();
      await expect(page.getByTestId("workbench-phone-preview")).toBeVisible();
    } else {
      // The envelope card keeps its height: a shrunk card clips its own
      // fields, which a visibility check can't see.
      const envelope = await box(page, "workbench-envelope");
      const from = await page
        .getByRole("textbox", { name: "From" })
        .boundingBox();
      expect(
        from!.y + from!.height,
        "From inside its card"
      ).toBeLessThanOrEqual(envelope.y + envelope.height);

      await page.getByRole("button", { name: "Details" }).click();
      await expect(page.getByTestId("workbench-sheet")).toBeVisible();
      const preview = await box(page, "workbench-preview");
      const sheet = await box(page, "workbench-sheet");
      // The sheet makes room beside the preview; it never covers it.
      const overlap =
        Math.min(preview.x + preview.width, sheet.x + sheet.width) -
        Math.max(preview.x, sheet.x);
      expect(overlap, "sheet over preview").toBeLessThanOrEqual(0);
      expect(
        preview.width,
        "preview width with the sheet open"
      ).toBeGreaterThan(size.width < 1180 ? size.width / 2 - 40 : 300);
    }

    expect(await scrollsSideways(page), `at ${size.width}`).toBe(false);
    const shot = await page.screenshot({ fullPage: true });
    await testInfo.attach(`workbench-${size.width}`, {
      body: shot,
      contentType: "image/png",
    });
    const dir = process.env.WORKBENCH_SHOTS_DIR;
    if (dir) writeFileSync(path.join(dir, `workbench-${size.width}.png`), shot);
  });
}

test("overrides an owner's email, resets it, and undoes the reset", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openWelcome(page);
  await resetIfCustomised(page);

  // Core's email: read-only content, with Override.
  const subject = page.getByRole("textbox", { name: "Subject" });
  await expect(subject).toHaveAttribute("readonly", "");
  await page
    .getByTestId("workbench-header")
    .getByRole("button", { name: "Override" })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Override", exact: true })
    .click();
  await expect(subject).not.toHaveAttribute("readonly", "", {
    timeout: 30_000,
  });

  // Reset gives it back to core, and Undo puts the site's version back.
  await page.getByRole("button", { name: "Reset to Nextly's version" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Reset", exact: true })
    .click();
  await expect(subject).toHaveAttribute("readonly", "", { timeout: 30_000 });
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(subject).not.toHaveAttribute("readonly", "", {
    timeout: 30_000,
  });

  // Leave it as a fresh install has it.
  await resetIfCustomised(page);
});
