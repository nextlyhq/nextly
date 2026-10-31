/**
 * A site page shown again after the admin looks as it does on a load of its
 * own.
 *
 * A site that links to its admin with `next/link` opens it without a document
 * load, and going Back leaves the admin's stylesheets in the document: React
 * keeps a stylesheet once it is added, and under Cache Components Next.js also
 * keeps the admin mounted, hidden. The admin's styles are scoped to the admin,
 * so none of them may reach the site page. Compared element by element on the
 * computed properties a stylesheet reaches, not on a screenshot.
 */
import { expect, type Locator, type Page } from "@playwright/test";

import { CACHE_COMPONENTS } from "./support/cache-components";
import { includingHidden, test } from "./support/test";

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

/** The site harness's elements, every kind a global rule could reach. */
function siteElements(page: Page): Record<string, Locator> {
  const site = page.getByTestId("site-harness");
  return {
    body: page.locator("body"),
    heading: site.getByRole("heading", { level: 1 }),
    paragraph: site.locator("p"),
    listItem: site.getByRole("listitem"),
    button: site.getByRole("button", { name: "A button" }),
    link: site.getByRole("link", { name: "Open the admin" }),
  };
}

/**
 * Under Cache Components, the route left behind must still be in the document,
 * hidden: otherwise the comparison says nothing about a hidden route's styles.
 */
async function expectAdminKeptHidden(page: Page): Promise<void> {
  if (!CACHE_COMPONENTS) return;
  const admin = includingHidden(page).locator(".nextly-admin");
  await expect(admin.first()).toBeAttached();
  await expect(admin.first()).toBeHidden();
}

test("a site page shown again after the admin looks as it does on its own load", async ({
  page,
}) => {
  await page.goto("/e2e-site");
  await expect(page.getByTestId("site-harness")).toBeVisible();
  const fresh = await stylesOf(page, siteElements(page));

  // Into the admin through the site's own link, without a document load.
  await page.getByRole("link", { name: "Open the admin" }).click();
  await expect(
    page.getByRole("navigation").getByRole("link", { name: "Dashboard" })
  ).toBeVisible({ timeout: 30_000 });

  // Back to the site, with the admin left behind.
  await page.evaluate(() => window.history.back());
  await expect(page.getByTestId("site-harness")).toBeVisible({
    timeout: 30_000,
  });
  await expectAdminKeptHidden(page);
  // Polled, so a transition the navigation started can finish: a leaked rule
  // never settles back to the fresh values.
  await expect
    .poll(() => stylesOf(page, siteElements(page)), { timeout: 5_000 })
    .toEqual(fresh);

  // The positive control: one global rule, such as an unscoped stylesheet
  // would add, and the comparison sees it.
  await page.addStyleTag({ content: "h1 { margin-top: 13px; }" });
  expect(await stylesOf(page, siteElements(page))).not.toEqual(fresh);
});
