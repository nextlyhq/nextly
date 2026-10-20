/**
 * Customise mode in a browser: where focus goes, what the keyboard can reach,
 * what happens on the way out with unsaved changes, and an axe scan.
 *
 * jsdom has no `inert`, no focus navigation and no `beforeunload` prompt, so
 * the component tests can say which attributes and handlers are there but not
 * what a reader meets. These press the keys and follow the history.
 *
 * Nothing here saves. Each test still returns the reader to the default
 * dashboard when it ends, as `dashboard-arrangement.spec.ts` does, so a test
 * that fails half way leaves the next spec the dashboard a new site has.
 *
 * @module tests/dashboard-customise.spec
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { gotoAdmin, type Theme } from "./support/admin";

const CELLS = '[data-testid^="widget-cell-"]';

/** The dashboard's address, with or without the trailing slash. */
const DASHBOARD_PATH = /\/admin\/?$/;

/** WCAG 2.2 AA and every level below it, as `builder-a11y.spec.ts` states. */
const AA_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/**
 * The host app's `<title>`, which the playground's client root layout cannot
 * declare. The reason is given in full in `builder-a11y.spec.ts`.
 */
const HOST_OWNED_RULES = ["document-title"];

/** Back to the default dashboard, through the guarded reset a reader uses. */
async function resetToDefault(page: Page): Promise<void> {
  const read = await page.request.get("/admin/api/dashboard/layout");
  const body = (await read.json()) as { version: number; scope: string };
  if (body.version === 0) return;
  const reset = await page.request.delete(
    `/admin/api/dashboard/layout?version=${body.version}&scope=${encodeURIComponent(body.scope)}`
  );
  expect(reset.status()).toBe(200);
}

function bar(page: Page) {
  return page.getByRole("group", { name: "Customize your dashboard" });
}

/** Opens customise mode from the keyboard. */
async function customize(page: Page): Promise<void> {
  const begin = page.getByTestId("dashboard-edit-begin");
  await begin.focus();
  await page.keyboard.press("Enter");
  await expect(bar(page)).toBeVisible();
}

/** One unsaved change: the first card moved one place later. */
async function moveFirstCardLater(page: Page): Promise<void> {
  await page
    .getByRole("button", { name: /^Card actions for / })
    .first()
    .click();
  await page.getByRole("menuitem", { name: "Move later" }).click();
  await expect(bar(page).getByText("Unsaved changes")).toBeVisible();
}

/** The unsaved-changes prompt's buttons, by name, in document order. */
async function promptChoices(page: Page): Promise<string[]> {
  return page
    .getByRole("alertdialog")
    .getByRole("button")
    .evaluateAll(buttons => buttons.map(button => button.textContent ?? ""));
}

/** axe's AA violations on the whole page, named so a failure says what to fix. */
async function expectNoAxeViolations(page: Page): Promise<void> {
  // Scanned once the page has settled: a menu fading out or a moved card's
  // transition caught halfway is a colour the page never rests at, and axe
  // measures its contrast as drawn. Endless animations (a spinner) never
  // settle and are left out of the wait.
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every(
        animation =>
          animation.playState !== "running" ||
          animation.effect?.getTiming().iterations === Number.POSITIVE_INFINITY
      )
  );
  const results = await new AxeBuilder({ page })
    .withTags(AA_TAGS)
    .disableRules(HOST_OWNED_RULES)
    .analyze();
  // A scan of nothing reports no violations too; enough passing rules shows
  // it looked at a drawn page.
  expect(
    results.passes.length,
    "axe reported no passing rules, so it scanned nothing"
  ).toBeGreaterThan(10);
  const findings = results.violations.map(v => ({
    id: v.id,
    impact: v.impact ?? "unknown",
    targets: v.nodes.map(node => node.target.map(String).join(" ")),
  }));
  expect(
    findings,
    `axe reported ${findings.length} violation(s):\n${JSON.stringify(findings, null, 2)}`
  ).toEqual([]);
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
});

test.afterEach(async ({ page }) => {
  await resetToDefault(page);
});

test("entering by keyboard lands on the bar, and Tab never reaches a card's own link", async ({
  page,
}) => {
  await gotoAdmin(page, "/");
  await expect(page.locator(CELLS).first()).toBeVisible();
  // The positive control: at rest the cards DO hold links of their own, so a
  // Tab walk that meets none in customise mode has measured a fence rather
  // than an empty dashboard.
  // Waited for: a card draws its links once its data arrives, after the
  // card itself, so a count taken at once can read an empty dashboard.
  const cardLinks = page.locator(`${CELLS} a[href]`);
  await expect(cardLinks.first()).toBeVisible();

  await customize(page);
  await expect(bar(page)).toBeFocused();

  // Tab from the bar through every card, until focus reaches the add picker
  // below them. Each stop inside a card must be one of its edit controls.
  const stops: Array<{ label: string; inCard: boolean; isControl: boolean }> =
    [];
  for (let i = 0; i < 400; i += 1) {
    await page.keyboard.press("Tab");
    const stop = await page.evaluate(() => {
      const active = document.activeElement;
      if (!active) return null;
      return {
        label:
          active.getAttribute("aria-label") ?? active.textContent?.trim() ?? "",
        inCard: active.closest('[data-testid^="widget-cell-"]') !== null,
        isControl: active.matches(
          '[data-testid="widget-drag-handle"], [aria-label^="Card actions for "]'
        ),
        pastCards: active.closest('[data-testid="add-widget-picker"]') !== null,
        onBar: active.closest('[data-testid="dashboard-edit-bar"]') !== null,
      };
    });
    if (!stop || stop.pastCards) break;
    // Round the page and back to the bar: every card has been passed.
    if (stop.onBar && stops.some(seen => seen.inCard)) break;
    stops.push(stop);
  }
  const intoCards = stops.filter(stop => stop.inCard);
  expect(intoCards.length, "Tab never reached the cards").toBeGreaterThan(0);
  expect(intoCards.filter(stop => !stop.isControl)).toEqual([]);
  // And the links are still drawn, each inside the fence.
  await expect(cardLinks.first()).toBeVisible();
  expect(
    await cardLinks.evaluateAll(links =>
      links.every(link => link.closest("[inert]") !== null)
    )
  ).toBe(true);
});

test("moving within the admin with unsaved changes asks, and Keep Editing stays", async ({
  page,
}) => {
  await gotoAdmin(page, "/");
  await customize(page);
  await moveFirstCardLater(page);

  // An ordinary in-app link: the sidebar's, to any page but this one.
  await page.locator('aside nav a[href^="/admin/"]').first().click();

  const prompt = page.getByRole("alertdialog");
  await expect(prompt).toBeVisible();
  expect(await promptChoices(page)).toEqual([
    "Discard Changes",
    "Keep Editing",
    "Save Changes",
  ]);
  const keep = prompt.getByRole("button", { name: "Keep Editing" });
  await expect(keep).toBeFocused();
  await expect(page).toHaveURL(DASHBOARD_PATH);

  await page.keyboard.press("Enter");
  await expect(prompt).toBeHidden();
  await expect(page).toHaveURL(DASHBOARD_PATH);
  await expect(bar(page).getByText("Unsaved changes")).toBeVisible();
});

test("going Back with unsaved changes asks, and Keep Editing stays", async ({
  page,
}) => {
  // Reach the dashboard from another admin page inside the app, so Back has
  // an in-app entry to go to. Through `history.pushState`, which is how the
  // admin's own links move: its router hears it and draws the page.
  await gotoAdmin(page, "/");
  const elsewhere = await page
    .locator('aside nav a[href^="/admin/"]')
    .first()
    .getAttribute("href");
  expect(elsewhere).not.toBeNull();
  await page.evaluate(
    path => window.history.pushState(null, "", path),
    elsewhere
  );
  await expect(page).not.toHaveURL(DASHBOARD_PATH);
  await page.evaluate(() => window.history.pushState(null, "", "/admin"));
  await expect(page).toHaveURL(DASHBOARD_PATH);
  await expect(page.locator(CELLS).first()).toBeVisible();

  await customize(page);
  await moveFirstCardLater(page);

  // From the page itself, as the browser's Back button does: Playwright's
  // own `goBack` waits for a navigation the guard is there to hold.
  await page.evaluate(() => window.history.back());

  const prompt = page.getByRole("alertdialog");
  await expect(prompt).toBeVisible();
  await expect(page).toHaveURL(DASHBOARD_PATH);
  // Still the dashboard behind the question, not the page Back was going to.
  // Found among hidden elements: the prompt is modal, so everything behind it
  // is out of the accessibility tree while it shows, though still drawn.
  await expect(
    page.getByRole("group", {
      name: "Customize your dashboard",
      includeHidden: true,
    })
  ).toBeVisible();
  await prompt.getByRole("button", { name: "Keep Editing" }).click();
  await expect(prompt).toBeHidden();
  await expect(page).toHaveURL(DASHBOARD_PATH);
  await expect(bar(page).getByText("Unsaved changes")).toBeVisible();
});

test("reloading with unsaved changes gets the browser's own prompt", async ({
  page,
}) => {
  await gotoAdmin(page, "/");
  await customize(page);
  await moveFirstCardLater(page);

  const dialog = page.waitForEvent("dialog");
  // Started from the page, which the browser runs `beforeunload` for; not
  // awaited, because the reload waits on the answer to the prompt.
  void page.evaluate(() => window.location.reload()).catch(() => undefined);
  const prompt = await dialog;
  expect(prompt.type()).toBe("beforeunload");
  await prompt.dismiss();

  // Dismissed, the page stays, changes and all.
  await expect(bar(page).getByText("Unsaved changes")).toBeVisible();
});

for (const theme of ["light", "dark"] as Theme[]) {
  test(`customise mode passes axe at 1440 (${theme})`, async ({ page }) => {
    await gotoAdmin(page, "/", theme);
    await expect(page.locator(CELLS).first()).toBeVisible();
    await customize(page);
    // With a change made, so the unsaved-changes marker is scanned too.
    await moveFirstCardLater(page);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expectNoAxeViolations(page);
  });
}
