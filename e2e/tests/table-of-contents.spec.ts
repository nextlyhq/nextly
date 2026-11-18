/**
 * A Table of contents on the live page, with JavaScript off:
 *
 * - it is a navigation landmark named "On this page", listing the page's own
 *   H2s and H3s in page order, nested, and leaves out a heading in an
 *   accordion and one its author left out;
 * - each link jumps to its heading;
 * - in Chromium, which knows scroll-linked targets, the entry for the section
 *   being read is set heavier as the page scrolls, with no script on the page;
 * - numbers are drawn by the stylesheet, not written into the links;
 * - at 320px and 1440px, light and dark, the list passes axe's AA checks
 *   (script on, for axe itself), each link is a 44px target, and the page
 *   never scrolls sideways.
 *
 * Each test makes its own page, named uniquely, so no lock is needed.
 *
 * @module tests/table-of-contents.spec
 */
import {
  expect,
  type APIRequestContext,
  type Browser,
  type Page,
} from "@playwright/test";

import { expectNoAxeViolations } from "./support/axe";
import { test } from "./support/test";

const PAGES = "/admin/api/collections/pages/entries";

/** A unique suffix for this run's names. */
const stamp = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

let made = 0;
const id = () =>
  `00000000-0000-4000-8000-${String((made += 1)).padStart(12, "0")}`;

const heading = (text: string, level = "h2", props: object = {}) => ({
  id: id(),
  type: "core/heading",
  version: 1,
  props: { text, level, ...props },
});

/** A tall gap, so each section fills more than a window. */
const gap = () => ({
  id: id(),
  type: "core/spacer",
  version: 1,
  props: {},
  styles: { base: { base: { height: "1400px" } } },
});

/** A published page holding a contents block and three sections. */
async function contentsPage(request: APIRequestContext): Promise<string> {
  const slug = `table-of-contents-${stamp()}`;
  const created = await request.post(PAGES, {
    data: {
      title: `Table of contents ${slug}`,
      slug,
      status: "published",
      content: {
        formatVersion: 1,
        kind: "page",
        nodes: [
          {
            id: id(),
            type: "core/table-of-contents",
            version: 2,
            props: {
              title: "On this page",
              depth: "h2-h3",
              marker: "numbered",
              collapsible: true,
              highlight: true,
            },
          },
          heading("How we work"),
          gap(),
          heading("Site visit", "h3"),
          gap(),
          heading("Pricing"),
          gap(),
          {
            id: id(),
            type: "core/accordion",
            version: 1,
            props: { as: "div" },
            slots: {
              children: [
                {
                  id: id(),
                  type: "core/accordion-item",
                  version: 1,
                  props: { title: "A question" },
                  slots: { children: [heading("In an answer")] },
                },
              ],
            },
          },
          heading("Not listed", "h2", { tocExclude: true }),
          heading("Questions"),
          gap(),
        ],
      },
    },
  });
  expect(created.ok(), await created.text()).toBe(true);
  return slug;
}

/**
 * A visitor's page, signed in to nothing: with JavaScript off, unless a
 * check (axe) needs script of its own to run.
 */
async function visitor(
  browser: Browser,
  baseURL: string | undefined,
  width: number,
  options: { colorScheme?: "light" | "dark"; script?: boolean } = {}
): Promise<Page> {
  const { colorScheme = "light", script = false } = options;
  const context = await browser.newContext({
    baseURL,
    javaScriptEnabled: script,
    storageState: { cookies: [], origins: [] },
    viewport: { width, height: 800 },
    colorScheme,
  });
  return context.newPage();
}

test.describe("a table of contents on the live page, JavaScript off", () => {
  test.describe.configure({ timeout: 180_000 });

  test("lists the page's own headings, nested, and each link jumps to its heading", async ({
    page,
    browser,
    baseURL,
  }) => {
    const slug = await contentsPage(page.request);
    const live = await visitor(browser, baseURL, 1440);
    await live.goto(`/${slug}`);
    const contents = live.getByRole("navigation", { name: "On this page" });
    await expect(contents).toBeVisible();
    const links = await contents.getByRole("link").evaluateAll(each =>
      each.map(link => ({
        href: link.getAttribute("href"),
        text: link.textContent?.trim() ?? "",
        nested: link.closest("ol")?.parentElement?.closest("ol") !== null,
      }))
    );
    // The accordion's heading and the left-out one are on the page, unlisted.
    await expect(live.getByRole("heading", { name: "Not listed" })).toHaveCount(
      1
    );
    expect(links).toEqual([
      { href: "#how-we-work", text: "How we work", nested: false },
      { href: "#site-visit", text: "Site visit", nested: true },
      { href: "#pricing", text: "Pricing", nested: false },
      { href: "#questions", text: "Questions", nested: false },
    ]);

    // The numbers are the stylesheet's, so a link's name is only its words.
    await expect(
      contents.getByRole("link", { name: "Pricing", exact: true })
    ).toBeVisible();

    for (const { href, text } of links) {
      await contents.getByRole("link", { name: text, exact: true }).click();
      await expect(live).toHaveURL(new RegExp(`${href}$`));
      await expect(
        live.getByRole("heading", { name: text, exact: true })
      ).toBeInViewport();
    }
    await live.context().close();
  });

  test("highlights the entry of the section being read as the page scrolls", async ({
    page,
    browser,
    baseURL,
  }) => {
    const slug = await contentsPage(page.request);
    const live = await visitor(browser, baseURL, 1440);
    await live.goto(`/${slug}`);
    const contents = live.getByRole("navigation", { name: "On this page" });
    const entry = (name: string) =>
      contents.getByRole("link", { name, exact: true });
    const section = (name: string) =>
      live.getByRole("heading", { name, exact: true });

    // Scrolled to Pricing's section: its entry takes the weight.
    await section("Pricing").scrollIntoViewIfNeeded();
    await expect(entry("Pricing")).toHaveCSS("font-weight", "600");
    await expect(entry("How we work")).toHaveCSS("font-weight", "400");

    // Back up to the first section: the weight moves with the reader.
    await section("How we work").scrollIntoViewIfNeeded();
    await expect(entry("How we work")).toHaveCSS("font-weight", "600");
    await expect(entry("Pricing")).toHaveCSS("font-weight", "400");
    await live.context().close();
  });
});

test.describe("a table of contents on the live page, read by axe", () => {
  test.describe.configure({ timeout: 180_000 });

  for (const width of [320, 1440]) {
    for (const scheme of ["light", "dark"] as const) {
      test(`reads clearly at ${width}px, ${scheme}: AA checks, 44px targets, no sideways scroll`, async ({
        page,
        browser,
        baseURL,
      }) => {
        const slug = await contentsPage(page.request);
        // Script on for axe, which runs in the page; the page adds none.
        const live = await visitor(browser, baseURL, width, {
          colorScheme: scheme,
          script: true,
        });
        await live.goto(`/${slug}`);
        const nav = 'nav[aria-label="On this page"]';
        await expectNoAxeViolations(live, { include: nav });
        for (const link of await live.locator(`${nav} a`).all()) {
          const box = await link.boundingBox();
          expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
        }
        // Numbered by the stylesheet, nested as 1, 1.1.
        const marker = await live
          .locator(`${nav} li li`)
          .first()
          .evaluate(item => getComputedStyle(item, "::before").content);
        expect(marker).toContain("counters(nx-toc");
        expect(
          await live.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth
          )
        ).toBe(true);
        await live.context().close();
      });
    }
  }
});
