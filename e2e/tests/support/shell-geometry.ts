/**
 * Where the admin shell draws the routed screen, read straight from the page.
 *
 * A layout-shift entry names at most five of the elements it moved, the largest first, and a
 * column that slides sideways is named by its own content, not by the shell that moved it. So a
 * question about whether the main column moved is answered by its box, measured before and after,
 * not by which elements a shift entry happened to list.
 *
 * @module tests/support/shell-geometry
 */
import { expect, type Page } from "@playwright/test";

/**
 * The admin's main landmark: the column the routed screen is drawn in. Held to the visible one, as
 * every lookup by id in this suite is, since a page kept mounted but hidden would carry its own.
 */
const MAIN_COLUMN = "#nextly-main-content:visible";

/** A box in CSS pixels, rounded so sub-pixel rendering never reads as a move. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The main column's box in the viewport. */
export async function mainColumnBox(page: Page): Promise<Box> {
  const box = await page.locator(MAIN_COLUMN).evaluate(element => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });
  // A column that never drew reads as a box of zero everywhere, which two
  // measurements would agree on whatever the shell did.
  expect(box.width, "the main column has no width").toBeGreaterThan(0);
  return {
    x: Math.round(box.x),
    y: Math.round(box.y),
    width: Math.round(box.width),
    height: Math.round(box.height),
  };
}

/**
 * Until every shell region has its answers in: the header's controls row and the sidebar's rail
 * each mark themselves `data-shell-answers="pending"` until the answers they draw from arrive.
 */
export async function waitForShellAnswers(page: Page): Promise<void> {
  await expect(page.locator('[data-shell-answers="pending"]')).toHaveCount(0, {
    timeout: 60_000,
  });
  // The positive control: the shell does mark itself, so no pending region means its answers are
  // in rather than that nothing is marked.
  await expect(
    page.locator('[data-shell-answers="settled"]').first()
  ).toBeAttached();
}
