/**
 * A screen's stylesheets left in the document do not change how the screen on
 * view looks.
 *
 * Stylesheets a screen brings in stay in the document after the reader moves
 * on: React keeps them, and under Cache Components Next.js keeps a visited
 * route mounted, hidden, with its styles. An admin screen shown again after
 * another, here one drawing a plugin's own styled card, must look exactly as
 * it does on a load of its own. Compared element by element on the computed
 * properties a stylesheet reaches, not on a screenshot.
 */
import { expect, type Locator, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { test } from "./support/test";

/** The computed properties compared: what a global rule would change. */
const PROPERTIES = [
  "font-family",
  "font-size",
  "font-weight",
  "line-height",
  "letter-spacing",
  "color",
  "background-color",
  "margin-top",
  "margin-bottom",
  "padding-top",
  "padding-left",
  "border-top-width",
  "border-top-style",
  "display",
  "list-style-type",
  "text-decoration-line",
] as const;

type Styles = Record<string, Record<string, string>>;

/**
 * Each named element's computed properties, as the browser resolves them, with
 * the pointer moved off the page first so no reading includes a hover state.
 */
async function stylesOf(
  page: Page,
  elements: Record<string, Locator>
): Promise<Styles> {
  await page.mouse.move(0, 0);
  const styles: Styles = {};
  for (const [name, element] of Object.entries(elements)) {
    styles[name] = await element.evaluate(
      (node, properties) => {
        const computed = window.getComputedStyle(node);
        return Object.fromEntries(
          properties.map(property => [
            property,
            computed.getPropertyValue(property),
          ])
        );
      },
      [...PROPERTIES]
    );
  }
  return styles;
}

/**
 * Whether a rule for this selector is in one of the document's stylesheets,
 * looking inside layers and media blocks as well.
 */
async function documentHasRule(page: Page, selector: string): Promise<boolean> {
  return page.evaluate(wanted => {
    const holds = (rules: CSSRuleList): boolean =>
      [...rules].some(rule =>
        rule instanceof CSSStyleRule
          ? rule.selectorText.includes(wanted)
          : rule instanceof CSSGroupingRule && holds(rule.cssRules)
      );
    return [...document.styleSheets].some(sheet => holds(sheet.cssRules));
  }, selector);
}

/** The dashboard's elements: its heading, a navigation link, an action. */
function dashboardElements(page: Page): Record<string, Locator> {
  return {
    heading: page.locator("main").getByRole("heading", { level: 1 }),
    navigationLink: page
      .getByRole("navigation")
      .getByRole("link", { name: "Dashboard" }),
    action: page.locator("main").getByRole("button", { name: "Customize" }),
  };
}

test("the dashboard shown again after a plugin's styled screen looks as it does on its own load", async ({
  page,
}) => {
  await gotoAdmin(page, "/");
  await expect(dashboardElements(page).action).toBeVisible({ timeout: 30_000 });
  const fresh = await stylesOf(page, dashboardElements(page));

  // The posts list, where the style-fixture plugin draws its own styled card.
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Content" })
    .click();
  await page.getByRole("link", { name: "Posts", exact: true }).first().click();
  await expect(page.getByTestId("sf-card")).toBeVisible({ timeout: 30_000 });

  // Back to the dashboard, with that screen left behind.
  await page.evaluate(() => window.history.back());
  await expect(dashboardElements(page).action).toBeVisible({ timeout: 30_000 });
  // The plugin's own rules must still be in the document: otherwise the
  // comparison says nothing about the styles the screen left behind. Admin
  // screens are one Next.js route, moved between by the admin's own router, so
  // no hidden copy of the screen is kept here; the stylesheet is what stays.
  expect(await documentHasRule(page, ".sf-panel")).toBe(true);
  // Polled, so a transition the navigation started can finish: a leaked rule
  // never settles back to the fresh values.
  await expect
    .poll(() => stylesOf(page, dashboardElements(page)), { timeout: 5_000 })
    .toEqual(fresh);
});
