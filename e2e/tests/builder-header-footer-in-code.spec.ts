/**
 * A site that draws its header and footer in code (`siteHeaderFooter:
 * "code"`) sees no header & footer tools, which would change nothing it shows:
 *
 * - no header or footer regions on the canvas, for a page whose stored choice
 *   is a set with a header;
 * - no Header & footer group in the Pages panel, and the line saying why, with
 *   the docs;
 * - no "Header & footer" menu in Page settings, on the entry page, or in the
 *   New page dialog;
 * - and the page's stored choice is kept as it was.
 *
 * Runs only on a playground started in that mode
 * (`E2E_HEADER_FOOTER_IN_CODE_ONLY=1`, see e2e/playwright.config.ts).
 *
 * @module tests/builder-header-footer-in-code.spec
 */
import {
  expect,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";

import { canvasRoot } from "./canvas/editor-driver";
import { gotoAdmin } from "./support/admin";
import { test } from "./support/test";

const API = "/admin/api";
const PAGES = `${API}/collections/pages/entries`;
const STAMP = `${Date.now().toString(36)}${Math.round(Math.random() * 1e4)}`;

async function idOf(
  response: {
    ok(): boolean;
    status(): number;
    text(): Promise<string>;
    json(): Promise<unknown>;
  },
  what: string
): Promise<string> {
  expect(
    response.ok(),
    `${what}: ${response.status()} ${await response.text()}`
  ).toBe(true);
  return ((await response.json()) as { item: { id: string } }).item.id;
}

/** A published header component, a set using it, and a page choosing that set. */
async function seed(
  api: APIRequestContext
): Promise<{ pageId: string; setId: string }> {
  const header = await idOf(
    await api.post(`${API}/collections/components/entries`, {
      data: {
        title: `Code site header ${STAMP}`,
        slug: `code-site-header-${STAMP}`,
        status: "published",
        content: {
          formatVersion: 1,
          kind: "component",
          nodes: [
            {
              id: "h",
              type: "core/heading",
              version: 1,
              props: { text: "A stored header", level: "h2" },
            },
          ],
        },
      },
    }),
    "creating the header"
  );
  const setId = await idOf(
    await api.post(`${API}/collections/layouts/entries`, {
      data: {
        title: `Code site set ${STAMP}`,
        slug: `code-site-set-${STAMP}`,
        areas: [{ area: "header", component: header }],
        status: "published",
      },
    }),
    "creating the set"
  );
  const pageId = await idOf(
    await api.post(PAGES, {
      data: {
        title: `Code site page ${STAMP}`,
        slug: `code-site-page-${STAMP}`,
        status: "draft",
        layout: setId,
        content: {
          formatVersion: 1,
          kind: "page",
          nodes: [
            {
              id: "body",
              type: "core/heading",
              version: 1,
              props: { text: "Page body", level: "h2" },
            },
          ],
        },
      },
    }),
    "creating the page"
  );
  return { pageId, setId };
}

async function openBuilder(page: Page, pageId: string): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoAdmin(page, `/collections/pages/${pageId}/builder?field=content`);
  await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible({
    timeout: 60_000,
  });
}

function railButton(page: Page, name: string) {
  return page
    .getByRole("navigation", { name: "Editor panels" })
    .getByRole("button", { name, exact: true });
}

const MENU = { name: "Header & footer" } as const;

/**
 * Whether `place` ever shows the menu while it is watched. Each place draws
 * its menu only once its own reads answer (the page's form, the New page
 * dialog's facts, a lazy tab), so a single look on opening would pass on a
 * site that does show it; this watches for a while instead. The control
 * run, on a Page Builder site, finds the menu in each place within it.
 */
async function menuShows(place: Locator | Page): Promise<boolean> {
  const menu = place.getByRole("combobox", MENU);
  for (let look = 0; look < 16; look++) {
    if ((await menu.count()) > 0) return true;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  return false;
}

test.describe("a site that draws its header and footer in code", () => {
  test.describe.configure({ timeout: 240_000 });

  test("shows no header & footer tools anywhere, and keeps the page's stored choice", async ({
    page,
  }) => {
    await gotoAdmin(page, "/");
    const { pageId, setId } = await seed(page.request);
    await openBuilder(page, pageId);

    // The canvas: the page's body, and no region of its stored set.
    const root = await canvasRoot(page);
    await expect(root.getByText("Page body")).toBeVisible();
    // Each absence below is soft, so a run on a Page Builder site (the
    // control) reports every tool it finds, not only the first.
    await expect.soft(root.locator("[data-nx-region]")).toHaveCount(0);

    // The Pages panel: the line, with the docs, and no group.
    await railButton(page, "Pages").click();
    const line = page.getByText(
      "This site draws its header and footer in code."
    );
    await expect.soft(line).toBeVisible();
    await expect
      .soft(line.getByRole("link", { name: /^Details/ }))
      .toHaveAttribute(
        "href",
        /a-site-that-draws-its-header-and-footer-in-code/
      );
    await expect
      .soft(page.getByRole("region", { name: "Header & footer" }))
      .toHaveCount(0);

    // The New page dialog, opened from the panel: no menu.
    await page.getByRole("button", { name: "New page" }).first().click();
    const dialog = page.getByRole("dialog", { name: "New page" });
    await expect(dialog).toBeVisible();
    expect
      .soft(await menuShows(dialog), "the New page dialog's menu")
      .toBe(false);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    // Page settings: no menu on General.
    await railButton(page, "Settings").click();
    const settings = page.getByRole("dialog", { name: /^Page settings · / });
    await expect(settings).toBeVisible();
    expect.soft(await menuShows(settings), "Page settings' menu").toBe(false);
    await page.keyboard.press("Escape");

    // The entry page: no menu.
    await gotoAdmin(page, `/collections/pages/${pageId}`);
    // The form is drawn: its title field holds the page's title, and the
    // Page Builder card, where the menu sits on any other site, is there.
    await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue(
      `Code site page ${STAMP}`,
      { timeout: 60_000 }
    );
    await expect(
      page.getByRole("group", { name: "Page Builder" })
    ).toBeVisible();
    expect.soft(await menuShows(page), "the entry page's menu").toBe(false);

    // Nothing stored was changed: the page still chooses its set.
    // A draft, so read as stored, whatever its status.
    const read = await page.request.get(`${PAGES}/${pageId}?status=all`);
    expect(read.ok(), `reading the page: ${read.status()}`).toBe(true);
    const stored = (await read.json()) as {
      item?: { layout?: unknown };
      layout?: unknown;
    };
    const layout = stored.item?.layout ?? stored.layout;
    expect(
      typeof layout === "object" && layout !== null
        ? (layout as { id?: unknown }).id
        : layout
    ).toBe(setId);
  });
});
