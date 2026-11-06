/**
 * The editor keeps its preferences per signed-in author, not per browser.
 *
 * Two authors take turns in one browser, so they share its storage. The first
 * inherits the record kept before preferences were per user; the second starts
 * from the defaults; and the first finds their own zoom again after the second
 * has used the editor.
 *
 * Each author opens a page of their own: the preferences are the author's,
 * whichever document is open, and a page each keeps a document's claim from
 * standing between them.
 *
 * @module builder-preferences-per-user.spec
 */
import {
  expect,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { fileAccount, test } from "./support/test";

const ENTRIES = "/admin/api/collections/pages/entries";
/** Where the shell kept its preferences before they were kept per user. */
const LEGACY_KEY = "nextly.builder.shell";

/** A page of the author's own, opened in the editor at a desktop width. */
async function openOwnPage(page: Page, author: string): Promise<void> {
  const created = await page.request.post(ENTRIES, {
    data: {
      title: `Preferences of ${author}`,
      slug: `preferences-${author}-${Date.now()}`,
      content: { formatVersion: 1, kind: "page", nodes: [] },
    },
  });
  expect(created.ok(), `seeding ${author}'s page: ${created.status()}`).toBe(
    true
  );
  const id = ((await created.json()) as { item: { id: string } }).item.id;
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoAdmin(page, `/collections/pages/${id}/builder?field=content`);
}

/** The zoom menu's trigger, whose name says the zoom the editor holds. */
const zoom = (page: Page) =>
  page.getByRole("button", { name: /^Canvas zoom:/ });

/** Sign the browser in as another author, keeping its storage. */
async function becomeAuthor(
  context: BrowserContext,
  state: Awaited<ReturnType<typeof fileAccount>>
): Promise<void> {
  await context.clearCookies();
  await context.addCookies(state.cookies);
}

async function newBrowserFor(
  browser: Browser,
  state: Awaited<ReturnType<typeof fileAccount>>
): Promise<BrowserContext> {
  return browser.newContext({
    storageState: { cookies: state.cookies, origins: [] },
  });
}

test("two authors of one browser each keep their own zoom, and the old record goes to the first", async ({
  browser,
}, testInfo) => {
  test.setTimeout(180_000);
  const baseURL = testInfo.project.use.baseURL;
  if (baseURL === undefined) throw new Error("[e2e] No baseURL configured.");
  const ada = await fileAccount(baseURL, testInfo, 1);
  const grace = await fileAccount(baseURL, testInfo, 2);

  const context = await newBrowserFor(browser, ada);
  try {
    const page = await context.newPage();
    // The record a browser kept before preferences were per user: 150%.
    await gotoAdmin(page, "/");
    await page.evaluate(
      ([key, value]) => window.localStorage.setItem(key, value),
      [LEGACY_KEY, JSON.stringify({ zoom: 1.5 })] as const
    );

    // The first author to open the editor takes it, once.
    await openOwnPage(page, "ada");
    await expect(zoom(page)).toHaveAccessibleName("Canvas zoom: 150%", {
      timeout: 30_000,
    });
    expect(
      await page.evaluate(key => window.localStorage.getItem(key), LEGACY_KEY)
    ).toBeNull();

    // The second author starts from the defaults: fitting the canvas.
    await becomeAuthor(context, grace);
    await openOwnPage(page, "grace");
    await expect(zoom(page)).toHaveAccessibleName(/^Canvas zoom: fitting/, {
      timeout: 30_000,
    });
    await zoom(page).click();
    await page.getByRole("menuitemradio", { name: "200%" }).click();
    await expect(zoom(page)).toHaveAccessibleName("Canvas zoom: 200%");

    // The first author finds their own zoom again, not the second's.
    await becomeAuthor(context, ada);
    await openOwnPage(page, "ada");
    await expect(zoom(page)).toHaveAccessibleName("Canvas zoom: 150%", {
      timeout: 30_000,
    });
  } finally {
    await context.close();
  }
});
