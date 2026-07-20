/**
 * Configured brand colors actually paint.
 *
 * The `--nx-*` tokens hold complete CSS colors and are consumed directly
 * (`--color-primary: var(--nx-primary)`). When branding resolved to a bare
 * "H S% L%" triplet instead, `background-color` got an invalid value and was
 * dropped, so every `bg-primary` surface rendered transparent rather than
 * branded — visibly broken, but silent. These assert the value both arrives
 * and is usable.
 */
import { expect, test } from "@playwright/test";

import { gotoAdmin } from "./support/admin";

// Mirrors apps/playground/nextly.config.ts.
const PRIMARY_HEX = "#6366f1";
const EXPECTED_PRIMARY = "hsl(238.7 83.5% 66.7%)";

const TRANSPARENT = "rgba(0, 0, 0, 0)";

test("the configured brand color reaches --nx-primary as a complete color", async ({
  page,
}) => {
  await gotoAdmin(page, "/");

  const primary = await page
    .locator(".nextly-admin")
    .first()
    .evaluate(el =>
      getComputedStyle(el).getPropertyValue("--nx-primary").trim()
    );

  expect(primary).toBe(EXPECTED_PRIMARY);
  // A bare triplet would be silently unusable downstream.
  expect(primary).not.toMatch(/^[\d.]+\s/);
});

test("a bg-primary surface paints the brand color instead of going transparent", async ({
  page,
}) => {
  await gotoAdmin(page, "/");

  const branded = page.locator('.nextly-admin [class*="bg-primary"]').first();
  await expect(branded).toBeVisible({ timeout: 30_000 });

  const background = await branded.evaluate(
    el => getComputedStyle(el).backgroundColor
  );

  expect(background).not.toBe(TRANSPARENT);

  // And it is the configured brand color, not the default token.
  const [r, g, b] = [0, 2, 4].map(i =>
    parseInt(PRIMARY_HEX.slice(1 + i, 3 + i), 16)
  );
  const channels = background.match(/[\d.]+/g)?.map(Number) ?? [];
  expect(channels.length).toBeGreaterThanOrEqual(3);
  for (const [i, expected] of [r, g, b].entries()) {
    // Allow for color-space conversion rounding.
    expect(Math.abs(channels[i] - expected)).toBeLessThanOrEqual(3);
  }
});
