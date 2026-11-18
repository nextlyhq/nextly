/**
 * An Accordion on the live page, with JavaScript off and on.
 *
 * - The page source holds a native `<details>`/`<summary>` per question, the
 *   titles as `h3`, and the icon hidden from screen readers.
 * - A question opens and closes by a click, by Enter and by Space, with no
 *   script: the browser's own disclosure.
 * - With "One at a time", opening one closes the others; with "Many", each
 *   stays as it is. The first question starts open while "First open" is on.
 * - The toggle is at least 44px tall and shows a focus ring from the
 *   keyboard; at 320px and in the site's dark values the icon is drawn in
 *   the text's colour and the page never scrolls sideways.
 *
 * Each test makes its own page, named uniquely, so no lock is needed.
 *
 * @module tests/accordion-no-script.spec
 */
import {
  expect,
  type APIRequestContext,
  type Browser,
  type Page,
} from "@playwright/test";

import { test } from "./support/test";

const PAGES = "/admin/api/collections/pages/entries";

/** A unique suffix for this run's names. */
const stamp = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/** One Text's stored words. */
function words(text: string) {
  return {
    root: {
      type: "root",
      children: [
        { type: "paragraph", children: [{ type: "text", text, format: 0 }] },
      ],
    },
  };
}

/** A published page of one accordion of three questions, and its slug. */
async function accordionPage(
  request: APIRequestContext,
  props: Record<string, unknown>,
  opens: readonly boolean[] = [false, false, false]
): Promise<string> {
  const slug = `accordion-${stamp()}`;
  const id = (n: number) =>
    `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const created = await request.post(PAGES, {
    data: {
      title: `Accordion ${slug}`,
      slug,
      status: "published",
      content: {
        formatVersion: 1,
        kind: "page",
        nodes: [
          {
            id: id(1),
            type: "core/accordion",
            version: 1,
            props: { as: "div", contained: false, titlesAs: "h3", ...props },
            slots: {
              children: [1, 2, 3].map(n => ({
                id: id(10 + n),
                type: "core/accordion-item",
                version: 1,
                props: { title: `Question ${n}`, open: opens[n - 1] === true },
                slots: {
                  children: [
                    {
                      id: id(20 + n),
                      type: "core/text",
                      version: 2,
                      props: { text: words(`Answer ${n}`) },
                    },
                  ],
                },
              })),
            },
          },
        ],
      },
    },
  });
  expect(created.ok(), await created.text()).toBe(true);
  return slug;
}

/** A visitor's page, signed in to nothing. */
async function visitor(
  browser: Browser,
  baseURL: string | undefined,
  script: boolean,
  options: { width?: number; colorScheme?: "light" | "dark" } = {}
): Promise<Page> {
  const context = await browser.newContext({
    baseURL,
    javaScriptEnabled: script,
    storageState: { cookies: [], origins: [] },
    viewport: { width: options.width ?? 1280, height: 900 },
    colorScheme: options.colorScheme ?? "light",
  });
  return context.newPage();
}

/** Which questions are open, in order. */
async function openOnes(page: Page): Promise<boolean[]> {
  return page
    .locator(".nx-pb-page details")
    .evaluateAll(all => all.map(each => (each as HTMLDetailsElement).open));
}

/** The summary of the nth question. */
const toggle = (page: Page, n: number) =>
  page.locator(".nx-pb-page details > summary").nth(n);

for (const script of [false, true]) {
  test.describe(`an Accordion on the live page, JavaScript ${script ? "on" : "off"}`, () => {
    test.describe.configure({ timeout: 180_000 });

    test("is native details and summary, with heading titles and a hidden icon", async ({
      page,
      browser,
      baseURL,
    }) => {
      const slug = await accordionPage(page.request, {
        openMode: "one",
        firstOpen: true,
      });
      const source = await (await page.request.get(`/${slug}`)).text();
      expect(source.match(/<details\b/g)?.length).toBe(3);
      expect(source).toMatch(/<summary[^>]*>.*?<h3[^>]*>Question 1<\/h3>/);
      expect(source).toMatch(
        /<span class="nx-pb-disclosure-icon" aria-hidden="true"><\/span>/
      );
      const live = await visitor(browser, baseURL, script);
      await live.goto(`/${slug}`);
      await expect(toggle(live, 0)).toBeVisible();
      await expect(
        live.getByRole("heading", { level: 3, name: "Question 2" })
      ).toBeVisible();
      await live.context().close();
    });

    test("One at a time: opening one closes the others, by a click, Enter and Space", async ({
      page,
      browser,
      baseURL,
    }) => {
      const slug = await accordionPage(page.request, {
        openMode: "one",
        firstOpen: true,
      });
      const live = await visitor(browser, baseURL, script);
      await live.goto(`/${slug}`);
      await expect(toggle(live, 0)).toBeVisible();
      // First open: the first question starts open, the others closed.
      expect(await openOnes(live)).toEqual([true, false, false]);
      await expect(live.getByText("Answer 1")).toBeVisible();

      await toggle(live, 1).click();
      await expect.poll(() => openOnes(live)).toEqual([false, true, false]);
      await expect(live.getByText("Answer 2")).toBeVisible();
      await expect(live.getByText("Answer 1")).toBeHidden();

      await toggle(live, 2).focus();
      await live.keyboard.press("Enter");
      await expect.poll(() => openOnes(live)).toEqual([false, false, true]);

      await toggle(live, 0).focus();
      await live.keyboard.press("Space");
      await expect.poll(() => openOnes(live)).toEqual([true, false, false]);

      // And closed again by the same press.
      await live.keyboard.press("Space");
      await expect.poll(() => openOnes(live)).toEqual([false, false, false]);
      await live.context().close();
    });

    test("Many: each question opens and closes alone", async ({
      page,
      browser,
      baseURL,
    }) => {
      const slug = await accordionPage(page.request, {
        openMode: "many",
        firstOpen: false,
      });
      const live = await visitor(browser, baseURL, script);
      await live.goto(`/${slug}`);
      await expect(toggle(live, 0)).toBeVisible();
      expect(await openOnes(live)).toEqual([false, false, false]);
      await toggle(live, 0).click();
      await toggle(live, 2).focus();
      await live.keyboard.press("Enter");
      await expect.poll(() => openOnes(live)).toEqual([true, false, true]);
      await toggle(live, 0).click();
      await expect.poll(() => openOnes(live)).toEqual([false, false, true]);
      await live.context().close();
    });

    test("the toggle is a 44px target with a focus ring, at 320px and in dark values", async ({
      page,
      browser,
      baseURL,
    }) => {
      const slug = await accordionPage(page.request, {
        openMode: "one",
        firstOpen: true,
      });
      const paints: Record<string, string> = {};
      for (const colorScheme of ["light", "dark"] as const) {
        const live = await visitor(browser, baseURL, script, {
          width: 320,
          colorScheme,
        });
        await live.goto(`/${slug}`);
        const first = toggle(live, 0);
        await expect(first).toBeVisible();
        for (const n of [0, 1, 2]) {
          const box = await toggle(live, n).boundingBox();
          expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
        }
        // The icon is drawn, in the title's colour, whatever the scheme.
        // Recorded per scheme: the site's dark values must change it.
        const icon = await first.evaluate(element => {
          const glyph = element.querySelector(".nx-pb-disclosure-icon");
          const box = glyph?.getBoundingClientRect();
          return {
            width: box?.width ?? 0,
            paint: glyph === null ? "" : getComputedStyle(glyph).backgroundColor,
            text: getComputedStyle(element).color,
          };
        });
        expect(icon.width).toBeGreaterThan(0);
        expect(icon.paint).toBe(icon.text);
        paints[colorScheme] = icon.paint;
        expect(
          await live.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth
          )
        ).toBe(true);
        // A ring from the keyboard: Tab reaches the first toggle.
        await live.keyboard.press("Tab");
        let guard = 0;
        while (
          guard < 20 &&
          !(await first.evaluate(element => element === document.activeElement))
        ) {
          await live.keyboard.press("Tab");
          guard += 1;
        }
        const ring = await first.evaluate(element => {
          const style = getComputedStyle(element);
          return { style: style.outlineStyle, width: style.outlineWidth };
        });
        expect(ring).toEqual({ style: "solid", width: "2px" });
        await live.context().close();
      }
      // The site's dark values change it: drawn in each scheme's text colour.
      expect(paints.light).toBeTruthy();
      expect(paints.dark).toBeTruthy();
      expect(paints.dark).not.toBe(paints.light);
    });

    test("an accordion stored before Open opens each question by its own setting", async ({
      page,
      browser,
      baseURL,
    }) => {
      // No Open, no First open, and its second question set open itself.
      const slug = await accordionPage(page.request, {}, [false, true, false]);
      const live = await visitor(browser, baseURL, script);
      await live.goto(`/${slug}`);
      await expect(toggle(live, 0)).toBeVisible();
      expect(await openOnes(live)).toEqual([false, true, false]);
      await toggle(live, 0).click();
      await expect.poll(() => openOnes(live)).toEqual([true, true, false]);
      await live.context().close();
    });
  });
}
