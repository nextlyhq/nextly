/**
 * Playwright's `test`, with every page held to its visible elements.
 *
 * Under Cache Components, Next.js keeps a visited page mounted but hidden, so
 * the document can hold a hidden copy of the page a spec is on. A role locator
 * leaves hidden elements out, but a text, label, test-id or placeholder
 * locator would match the hidden copy's as readily as the visible one's, so on
 * every page a spec reaches they find visible elements only: the page it is
 * handed, any other its context opens, and any page of a context or page it
 * makes itself, as a second user's sign-in does. A locator chained from one of
 * them is held to it.
 *
 * The base of the suite's own `test` (`./test`), which adds each file's
 * account. The production suite, which signs in through the real form, takes
 * this one. `scripts/e2e-specs-take-suite-test.test.mjs` holds every spec to
 * one of the two.
 *
 * @module tests/support/visible
 */
import {
  test as base,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";

/**
 * The page's locators that, unlike a role locator, match hidden elements as
 * well as visible ones.
 */
const MATCHES_HIDDEN = [
  "getByText",
  "getByLabel",
  "getByTestId",
  "getByPlaceholder",
] as const;

/** Make one of `page`'s locators find visible elements only. */
function findVisibleOnly<M extends (typeof MATCHES_HIDDEN)[number]>(
  page: Page,
  method: M
): void {
  const find = page[method].bind(page) as (
    ...args: Parameters<Page[M]>
  ) => Locator;
  page[method] = ((...args: Parameters<Page[M]>) =>
    find(...args).filter({ visible: true })) as Page[M];
}

/** The pages already held to visible elements, so none is wrapped twice. */
const visibleOnlyPages = new WeakSet<Page>();

/** Make a page's text, label, test-id and placeholder locators visible-only. */
function holdToVisible(page: Page): void {
  if (visibleOnlyPages.has(page)) return;
  visibleOnlyPages.add(page);
  for (const method of MATCHES_HIDDEN) findVisibleOnly(page, method);
}

/** Hold every page a context has, and every page it opens later, to visible. */
function holdContextToVisible(context: BrowserContext): void {
  for (const page of context.pages()) holdToVisible(page);
  context.on("page", holdToVisible);
}

/**
 * The page's whole document, for a spec that means to find a hidden element:
 * locators chained from it are not held to visible elements, as the page's
 * own are. Named at each use, so a spec reaching a hidden element says so.
 */
export function includingHidden(page: Page): Locator {
  return page.locator(":root");
}

export const test = base.extend({
  context: async ({ context }, use) => {
    holdContextToVisible(context);
    await use(context);
  },
  page: async ({ page }, use) => {
    holdToVisible(page);
    await use(page);
  },
  browser: [
    async ({ browser }, use) => {
      const newContext = browser.newContext.bind(browser);
      browser.newContext = async (
        ...args: Parameters<Browser["newContext"]>
      ) => {
        const context = await newContext(...args);
        holdContextToVisible(context);
        return context;
      };
      const newPage = browser.newPage.bind(browser);
      browser.newPage = async (...args: Parameters<Browser["newPage"]>) => {
        const page = await newPage(...args);
        holdToVisible(page);
        return page;
      };
      await use(browser);
    },
    { scope: "worker" },
  ],
});
