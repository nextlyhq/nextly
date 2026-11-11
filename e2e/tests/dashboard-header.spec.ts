/**
 * The top of the dashboard, in a browser: one greeting line as the page's only
 * heading, with nothing else above the cards, and the page's one action, a cog
 * named "Customize dashboard", at the right end of the admin's top bar. There
 * is no "+ New" anywhere: not on the dashboard, not in the rail, not in the
 * phone's menu drawer, and not on a collection's list either.
 *
 * Customise mode itself, which the cog opens, is `dashboard-customise.spec.ts`'s.
 *
 * @module tests/dashboard-header.spec
 */
import { expect, type Page } from "@playwright/test";

import { test } from "./support/test";
import { gotoAdmin } from "./support/admin";
import { expectNoAxeViolations } from "./support/axe";
import { LOCK } from "./support/locks";

// Shares state with other specs; see support/locks.ts for what each lock guards.
test.describe.configure({ lock: [LOCK.dashboard] });

const GREETING = /^(Good (morning|afternoon|evening), \S+|Welcome)$/;

/** The admin's one top bar: the page's breadcrumb at its left, its actions at its right. */
function topBar(page: Page) {
  return page
    .locator("header")
    .filter({ has: page.getByRole("navigation", { name: "Breadcrumb" }) });
}

/** Every control that would be "+ New": the old trigger, or a button named New. */
function newControls(page: Page) {
  return page
    .getByTestId("new-menu-trigger")
    .or(page.getByRole("button", { name: "New", exact: true }))
    .or(page.getByRole("button", { name: "+ New", exact: true }));
}

for (const theme of ["light", "dark"] as const) {
  test(`one greeting line is the page's heading, and the bar's cog is Customize dashboard (${theme})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoAdmin(page, "/", theme);
    const heading = page.getByRole("heading", { level: 1 });
    await expect(heading).toHaveCount(1);
    await expect(heading).toHaveText(GREETING);
    await expect(heading).toHaveAttribute("id", "dashboard-heading");
    // As the approved design draws it: 20px, semibold, held a touch tight.
    expect(
      await heading.evaluate(node => {
        const style = getComputedStyle(node);
        return [style.fontSize, style.fontWeight, style.marginBottom];
      })
    ).toEqual(["20px", "600", "18px"]);

    // Nothing else above the cards: no project name, badge, summary or freshness line.
    const main = page.locator("main");
    await expect(main).not.toContainText("Nextly Playground");
    await expect(page.getByTestId("dashboard-summary-slot")).toHaveCount(0);
    await expect(page.getByTestId("dashboard-environment")).toHaveCount(0);
    await expect(main.getByText(/^Updated .* ago/)).toHaveCount(0);
    await expect(main.getByText("Resume setup")).toHaveCount(0);

    // The cog, in the bar, 34px, named and tooltipped by what it does.
    const cog = page.getByRole("button", { name: "Customize dashboard" });
    await expect(topBar(page)).toContainText("Dashboard");
    expect(
      await topBar(page).locator("[data-testid=dashboard-edit-begin]").count()
    ).toBe(1);
    const box = await cog.boundingBox();
    expect([box?.width, box?.height]).toEqual([34, 34]);
    await cog.hover();
    await expect(page.getByRole("tooltip")).toHaveText("Customize dashboard");
    // Moved away in steps, as a hand does, so the pointer is seen leaving.
    await page.mouse.move(0, 400, { steps: 10 });
    await expect(page.getByRole("tooltip")).toHaveCount(0);

    await expect(
      page.locator('[data-testid="widget-card-body"][aria-busy="true"]')
    ).toHaveCount(0, { timeout: 30_000 });
    await expectNoAxeViolations(page);
  });
}

test("the cog opens customise mode by keyboard, Enter or Space", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoAdmin(page, "/");
  const group = page.getByRole("group", { name: "Customize dashboard" });
  for (const key of ["Enter", "Space"]) {
    const cog = page.getByRole("button", { name: "Customize dashboard" });
    await cog.focus();
    await page.keyboard.press(key);
    await expect(group).toBeFocused();
    await group.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
  }
});

for (const viewport of [
  { name: "1440", width: 1440, height: 900 },
  { name: "390", width: 390, height: 844 },
]) {
  test(`no "+ New" on the dashboard or a collection's list at ${viewport.name}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    for (const path of ["/", "/collections/posts"]) {
      await gotoAdmin(page, path);
      await expect(page.locator("main")).toBeVisible();
      if (viewport.width < 1024) {
        // The phone's menu drawer, where the rail's items go.
        await page
          .getByRole("button", { name: "Open the navigation menu" })
          .click();
        await expect(page.getByRole("dialog")).toBeVisible();
      }
      await expect(newControls(page)).toHaveCount(0);
      if (viewport.width < 1024) await page.keyboard.press("Escape");
    }
  });
}
