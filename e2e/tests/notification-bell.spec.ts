/**
 * The header's notification bell held to WCAG 2.2 AA: with more than nine
 * unread changes its count says "9+", and an axe scan of the dashboard
 * passes with it drawn, in light and in dark. axe holds a two-character count
 * to the full ratio and sets a one-character count aside, so "9+" is the case
 * it judges.
 *
 * The bell lists the Schema Builder's changes, so the admin offers it only
 * where the builder runs. A production build turns the builder off and hides
 * the bell with it, so this runs on the dev server (`DEV_SPECS` in
 * `playwright.config.ts`).
 *
 * @module tests/notification-bell.spec
 */
import { expect, type Page } from "@playwright/test";

import { gotoAdmin, type Theme } from "./support/admin";
import { emptyScanReason, scanAxe } from "./support/axe-scan.mjs";
import { LOCK } from "./support/locks";
import { test } from "./support/test";

// Scans the dashboard as a whole, which other specs change; see support/locks.ts.
test.describe.configure({ lock: [LOCK.dashboard] });

const CELLS = '[data-testid^="widget-cell-"]';

/** Twelve unread changes from the journal the bell reads. */
async function twelveUnreadChanges(page: Page): Promise<void> {
  await page.route("**/admin/api/schema/journal**", async route => {
    try {
      const at = new Date().toISOString();
      await route.fulfill({
        json: {
          hasMore: false,
          rows: Array.from({ length: 12 }, (_, index) => ({
            id: `journal-${index}`,
            source: "ui",
            status: "success",
            scope: { kind: "global" },
            summary: { added: 1, removed: 0, renamed: 0, changed: 0 },
            startedAt: at,
            endedAt: at,
            durationMs: 1,
            errorCode: null,
            errorMessage: null,
          })),
        },
      });
    } catch {
      // The page closed while answering.
    }
  });
  // Last seen long before any of them.
  await page.addInitScript(() =>
    localStorage.setItem("nextly:journal:lastSeen", "2000-01-01T00:00:00.000Z")
  );
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
});

for (const theme of ["light", "dark"] as Theme[]) {
  test(`the bell's count passes axe (${theme})`, async ({ page }) => {
    await twelveUnreadChanges(page);

    // The dashboard drawn, every card's first answer in.
    await gotoAdmin(page, "/", theme);
    await expect(
      page.locator(CELLS).filter({ visible: true }).first()
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="widget-card-body"][aria-busy="true"]')
    ).toHaveCount(0, { timeout: 30_000 });
    await expect(page.getByTestId("notification-bell-badge")).toHaveText("9+");

    // Settled first: a colour mid-animation is one the page never rests at.
    await page.waitForFunction(() =>
      document
        .getAnimations()
        .every(
          animation =>
            animation.playState !== "running" ||
            animation.effect?.getTiming().iterations ===
              Number.POSITIVE_INFINITY
        )
    );
    const { results, findings } = await scanAxe(page);
    expect(emptyScanReason(results)).toBeNull();
    expect(
      findings,
      `axe reported ${findings.length} violation(s):\n${JSON.stringify(findings, null, 2)}`
    ).toEqual([]);
  });
}
