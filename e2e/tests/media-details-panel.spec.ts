/**
 * An item's details open beside the library's grid where there is room, and
 * over it where there isn't, in a real browser at three widths.
 *
 * What a unit test cannot see: the library's measured width deciding the
 * layout, the panel staying beside a grid that is still usable (a second tile
 * opens while the first is shown), the sheet that replaces it on a narrow
 * window, and focus landing back on the tile when either closes.
 */
import { expect, type Page } from "@playwright/test";

import { gotoAdmin, type Theme } from "./support/admin";
import { expectNoAxeViolations } from "./support/axe";
import { dropFiles, pngBuffer } from "./support/media-files";
import { test } from "./support/test";

async function libraryWithTwoImages(page: Page, theme: Theme, tag: string) {
  await gotoAdmin(page, "/media", theme);
  await dropFiles(page, [
    { name: `${tag}-a.png`, buffer: pngBuffer(60) },
    { name: `${tag}-b.png`, buffer: pngBuffer(180) },
  ]);
  await expect(
    page.getByRole("status").filter({ hasText: /uploaded/ })
  ).toContainText("2 uploaded", { timeout: 30_000 });
  // The upload tray stays in the corner until it is closed; close it so it
  // can't sit over a tile these tests click.
  await page.getByRole("button", { name: "Close uploads" }).click();
  await page.getByRole("button", { name: "Grid view" }).click();
}

const tile = (page: Page, name: string) =>
  page.getByRole("button", { name: new RegExp(`^${name}`) }).first();

for (const theme of ["light", "dark"] as const) {
  test(`beside the grid at 1440px (${theme}): a second tile opens without closing the first`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await libraryWithTwoImages(page, theme, `wide-${theme}`);

    await tile(page, `wide-${theme}-a.png`).click();
    const panel = page.getByRole("complementary", { name: "Media details" });
    await expect(
      panel.getByRole("heading", { name: `wide-${theme}-a.png` })
    ).toBeVisible();
    // Beside, not over: nothing modal covers the grid.
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await tile(page, `wide-${theme}-b.png`).click();
    await expect(
      panel.getByRole("heading", { name: `wide-${theme}-b.png` })
    ).toBeVisible();
    await expect(
      page.getByRole("complementary", { name: "Media details" })
    ).toHaveCount(1);

    await expectNoAxeViolations(page, {
      include: "[data-media-details-panel]",
    });

    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(tile(page, `wide-${theme}-b.png`)).toBeFocused();
  });
}

for (const width of [860, 390]) {
  test(`over the grid at ${width}px: a sheet with its own close button`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await libraryWithTwoImages(page, "light", `narrow-${width}`);

    await tile(page, `narrow-${width}-a.png`).click();
    const sheet = page.getByRole("dialog", { name: `narrow-${width}-a.png` });
    await expect(sheet).toBeVisible();
    await expect(
      page.getByRole("complementary", { name: "Media details" })
    ).toHaveCount(0);

    // Out by the sheet's own close button, back to the tile.
    await sheet.getByRole("button", { name: "Close details" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(tile(page, `narrow-${width}-a.png`)).toBeFocused();
  });
}

test("the viewer expands from the panel and Escape returns to it", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await libraryWithTwoImages(page, "light", "viewer");

  await tile(page, "viewer-a.png").click();
  const expand = page.getByRole("button", { name: "Expand to full screen" });
  await expand.click();
  await expect(
    page.getByRole("dialog", { name: /viewer-[ab]\.png/ })
  ).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("complementary", { name: "Media details" })
  ).toBeVisible();
  await expect(expand).toBeFocused();
});
