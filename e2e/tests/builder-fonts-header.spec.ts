/**
 * The Fonts header at the top of Design → Type, in the browser:
 *
 * - "Fonts" heads the Body and Headings fonts, its left edge on the same
 *   line as every other section header in the tab;
 * - "Manage fonts…" sits at the header's right end, inside its row, and is
 *   the tab's only way to the Fonts screen (no link loose under the fonts);
 * - closing the Fonts screen hands focus back to it.
 *
 * Black box like the rest of `e2e/`: no product code is imported.
 */
import { expect, type Locator, type Page } from "@playwright/test";

import { openEditorWith } from "./canvas/editor-driver";
import { LOCK } from "./support/locks";
import { test } from "./support/test";

// The homepage is reseeded to open the editor on it.
test.describe.configure({ lock: [LOCK.homepage] });

const HEADING = "fonts-header-heading";
const NODES = [
  {
    id: HEADING,
    type: "core/heading",
    version: 1,
    props: { text: "A heading under the Fonts header", level: "h1" },
  },
];

/** Design → Type, opened from the rail unless the panel was left open. */
async function openType(page: Page): Promise<Locator> {
  const panel = page.getByRole("region", { name: "Design panel" });
  await page.getByRole("navigation", { name: "Editor panels" }).waitFor();
  const open = await panel
    .waitFor({ timeout: 3_000 })
    .then(() => true)
    .catch(() => false);
  if (!open) {
    await page
      .getByRole("navigation", { name: "Editor panels" })
      .getByRole("button", { name: "Design", exact: true })
      .click();
  }
  await panel.getByRole("tab", { name: "Type" }).click();
  return panel;
}

/** A locator's box, failing the test when it has none. */
async function box(
  locator: Locator
): Promise<{ x: number; y: number; width: number; height: number }> {
  const found = await locator.boundingBox();
  expect(found, "the element is drawn").not.toBeNull();
  return found!;
}

test("the Fonts header lines up with the other headers, with Manage fonts… at its end", async ({
  page,
}) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openEditorWith(page, NODES, HEADING);
  const panel = await openType(page);

  const fonts = panel.getByRole("region", { name: "Fonts", exact: true });
  const heading = fonts.getByRole("heading", { name: "Fonts", exact: true });
  await expect(heading).toBeVisible({ timeout: 30_000 });

  // The Fonts header starts on the same vertical line as the section headers
  // of the variables under it (Site text and the groups), at least one of
  // which is there to compare. Text styles, drawn after the variables, keeps
  // its own place for now and is not measured here.
  const headers = panel.locator(".nx-vars__body .nx-vars__group-name");
  // The Fonts header is drawn before the site's variables arrive, so wait
  // for the headers it is measured against rather than for it alone.
  await expect(headers.first()).toBeVisible({ timeout: 30_000 });
  expect(await headers.count()).toBeGreaterThan(0);
  const fontsLeft = (await box(heading)).x;
  for (const other of await headers.all()) {
    expect(Math.abs((await box(other)).x - fontsLeft)).toBeLessThanOrEqual(1);
  }
  // Every header's left edge, so a failure shows which one moved.
  const lefts = await panel
    .locator(".nx-vars__group-name")
    .evaluateAll(all =>
      all.map(h => `${h.textContent?.trim()}: ${h.getBoundingClientRect().x}`)
    );
  test
    .info()
    .annotations.push({ type: "header lefts", description: lefts.join(" | ") });

  // "Manage fonts…" is in the header row, at its right end, and it is the
  // only one in the tab: no loose link under the fonts.
  const manage = panel.getByRole("button", { name: "Manage fonts…" });
  await expect(manage).toHaveCount(1);
  const row = await box(heading.locator(".."));
  const link = await box(manage);
  expect(Math.abs(link.x + link.width - (row.x + row.width))).toBeLessThan(1);
  expect(link.y).toBeGreaterThanOrEqual(row.y - 1);
  expect(link.y + link.height).toBeLessThanOrEqual(row.y + row.height + 1);
  // A target of its own, at least 24px tall.
  expect(link.height).toBeGreaterThanOrEqual(24);
  // Above the fonts it heads.
  const body = await box(fonts.getByRole("button", { name: /^Body font,/ }));
  expect(link.y + link.height).toBeLessThanOrEqual(body.y);

  // Open the Fonts screen and come back: focus is on the link again.
  await manage.click();
  const back = panel.getByRole("button", { name: "Back to Design" });
  await expect(back).toBeFocused();
  await back.click();
  await expect(panel.getByRole("tab", { name: "Type" })).toHaveAttribute(
    "aria-selected",
    "true"
  );
  await expect(
    panel.getByRole("button", { name: "Manage fonts…" })
  ).toBeFocused();
});
