/**
 * The permissions matrix, measured rather than rendered-and-hoped.
 *
 * Every assertion here is a number that jsdom cannot produce. It has no layout
 * engine, so `getBoundingClientRect()` returns zeros whether the bug is present
 * or not, and it does not cascade CSS, so a computed border colour is not
 * available to compare against the row behind it. These are the two defects
 * that reached a person's eyes in this admin, and neither was catchable in the
 * 3,800 tests that already existed.
 */
import { expect, test } from "@playwright/test";

import { contrastRatio, gotoAdmin, toRgb, type Theme } from "./support/admin";

/**
 * Gestalt proximity, not taste. The Name column reached 1024px and pushed the
 * first checkbox 1076px from the row's edge, which reads as "these two things
 * are unrelated" — the eye-tracking work on structurally identical spec sheets
 * shows people lose the row or start tracing with the cursor. 280px is the cap
 * the column is built to; this catches it drifting back.
 */
const NAME_COLUMN_MAX_PX = 280;

/** WCAG 2.5.8. The user-agent exemption covers a bare checkbox, not a styled one. */
const MIN_TARGET_PX = 24;

/** WCAG 1.4.11. A control's boundary must be findable against what is behind it. */
const MIN_CONTROL_CONTRAST = 3;

test.beforeEach(async ({ page }) => {
  await gotoAdmin(page, "/security/roles/create");
  await expect(page.getByRole("table")).toBeVisible();
});

test("the name column stays close to the checkboxes it labels", async ({
  page,
}) => {
  const nameHeader = page.locator("th#permission-matrix-name");
  await expect(nameHeader).toBeVisible();

  const header = await nameHeader.boundingBox();
  expect(header).not.toBeNull();
  expect(
    header!.width,
    `Name column is ${Math.round(header!.width)}px; the cap is ${NAME_COLUMN_MAX_PX}px`
  ).toBeLessThanOrEqual(NAME_COLUMN_MAX_PX);

  // The width is only a proxy. What actually hurt was the distance the eye had
  // to travel, so measure that too.
  const row = page.locator("tbody tr").first();
  const firstCheckbox = row.locator('button[role="checkbox"]').first();
  const rowBox = await row.boundingBox();
  const checkboxBox = await firstCheckbox.boundingBox();

  const travel = checkboxBox!.x - rowBox!.x;
  expect(
    travel,
    `first checkbox sits ${Math.round(travel)}px from the row edge`
  ).toBeLessThan(400);
});

test("every checkbox is big enough to hit", async ({ page }) => {
  const checkboxes = page.locator('tbody button[role="checkbox"]');
  const count = await checkboxes.count();
  expect(count).toBeGreaterThan(0);

  // The visual box is 16px by design; the claimable target is drawn by a
  // pseudo-element, so measure what a pointer would actually land on.
  const targets = await checkboxes.evaluateAll(nodes =>
    nodes.map(node => {
      const before = window.getComputedStyle(node, "::before");
      const rect = node.getBoundingClientRect();
      const width = parseFloat(before.width) || rect.width;
      const height = parseFloat(before.height) || rect.height;
      return { width, height };
    })
  );

  const tooSmall = targets.filter(
    t => t.width < MIN_TARGET_PX || t.height < MIN_TARGET_PX
  );
  expect(
    tooSmall.length,
    `${tooSmall.length} of ${count} checkboxes are under ${MIN_TARGET_PX}px`
  ).toBe(0);
});

for (const theme of ["light", "dark"] as Theme[]) {
  test(`checkbox outlines meet contrast in ${theme} mode`, async ({ page }) => {
    await gotoAdmin(page, "/security/roles/create", theme);
    await expect(page.getByRole("table")).toBeVisible();

    const checkbox = page.locator('tbody button[role="checkbox"]').first();
    await expect(checkbox).toBeVisible();

    const { border, behind } = await checkbox.evaluate(node => {
      const style = window.getComputedStyle(node);

      // Walk up for the first ancestor that actually paints something. The row
      // is usually transparent, so comparing against it measures nothing.
      let parent = node.parentElement;
      let background = "rgba(0, 0, 0, 0)";
      while (parent) {
        const value = window.getComputedStyle(parent).backgroundColor;
        if (value && value !== "rgba(0, 0, 0, 0)" && value !== "transparent") {
          background = value;
          break;
        }
        parent = parent.parentElement;
      }

      return { border: style.borderColor, behind: background };
    });

    const [borderRgb, behindRgb] = await Promise.all([
      toRgb(page, border),
      toRgb(page, behind),
    ]);

    const ratio = contrastRatio(borderRgb, behindRgb);
    expect(
      ratio,
      `${theme}: outline ${border} on ${behind} is ${ratio.toFixed(2)}:1, needs ${MIN_CONTROL_CONTRAST}:1`
    ).toBeGreaterThanOrEqual(MIN_CONTROL_CONTRAST);
  });
}
