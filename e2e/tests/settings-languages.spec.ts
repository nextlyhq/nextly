/**
 * Settings › Languages on the playground as it ships, whose configuration
 * declares English, Spanish and Arabic: the list is read-only.
 *
 * - every declared language, in the configuration's order, with its code,
 *   writing direction and fallback, and English marked as the default;
 * - the page says where the languages are set, and offers no add, edit,
 *   reorder or remove;
 * - reached from the Settings navigation;
 * - nothing falls off the side at 390 px;
 * - axe's AA scan, in light and in dark.
 *
 * The changes themselves run against a playground that declares no languages
 * (`settings-languages-unlocked.spec.ts`).
 *
 * What the component tests cannot see: the route, the session, and the real
 * server's answer for a configuration that locks the list.
 *
 * @module tests/settings-languages.spec
 */
import { expect, type Page } from "@playwright/test";

import { gotoAdmin, type Theme } from "./support/admin";
import { expectNoAxeViolations } from "./support/axe";
import { test } from "./support/test";

const THEMES: readonly Theme[] = ["light", "dark"];

/** The page, drawn with its list. */
async function openLanguages(page: Page, theme: Theme = "light") {
  await gotoAdmin(page, "/settings/languages", theme);
  const list = page.getByRole("list", { name: "Languages in use" });
  await expect(list.getByRole("listitem")).toHaveCount(3, { timeout: 30_000 });
  return list;
}

test("lists the declared languages read-only, saying where they are set", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const list = await openLanguages(page);

  const rows = list.getByRole("listitem");
  await expect(rows.nth(0)).toContainText("English");
  await expect(rows.nth(0)).toContainText("en");
  await expect(rows.nth(0)).toContainText("Default");
  await expect(rows.nth(0)).toContainText("Left to right");
  await expect(rows.nth(1)).toContainText("Spanish");
  // English appears in Spanish's row only as its fallback.
  await expect(rows.nth(1)).toContainText("Falls back to");
  await expect(rows.nth(1)).toContainText("English");
  await expect(rows.nth(2)).toContainText("Arabic");
  await expect(rows.nth(2)).toContainText("Right to left");

  await expect(
    page.getByText(/These languages are set in this site's configuration/)
  ).toHaveText(
    "These languages are set in this site's configuration, in the localization block of nextly.config.ts, so they can only be changed there."
  );
  // The positive control for the absences below: the page's own controls
  // would be drawn here, beside the drawn list.
  await expect(
    page.getByRole("heading", { name: "Languages in use" })
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Add language" })).toHaveCount(
    0
  );
  await expect(page.getByRole("button", { name: /^Actions for / })).toHaveCount(
    0
  );
  // The server refuses any change to a list the configuration declares.
  const refused = await page.request.post("/admin/api/languages", {
    data: { kind: "update", code: "es", label: "Español" },
  });
  expect(refused.status()).toBe(400);
  expect(await refused.text()).toContain("languages_locked_by_config");
});

test("is reached from the Settings navigation", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoAdmin(page, "/settings");
  await page.getByRole("link", { name: "Languages", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/settings\/languages$/);
  await expect(
    page.getByRole("list", { name: "Languages in use" })
  ).toBeVisible();
});

test("fits a 390 px screen with nothing off the side", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const list = await openLanguages(page);
  await expect(list).toBeVisible();

  const widths = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(widths.scroll).toBeLessThanOrEqual(widths.client + 1);
  for (const row of await list.getByRole("listitem").all()) {
    const box = await row.boundingBox();
    expect(box, "a row on screen").not.toBeNull();
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(391);
  }
});

for (const theme of THEMES) {
  test(`passes axe's AA scan (${theme})`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openLanguages(page, theme);
    await expectNoAxeViolations(page);
  });
}
