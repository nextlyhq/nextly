/**
 * The live-page parts the core blocks add hold up on a phone and in the dark.
 *
 * One published page holds a table of contents, an accordion, a list drawn
 * with ticks, an embed's poster, a form and a picture that opens in a
 * lightbox. A visitor reads it at 320px and
 * 1440px, in light and in dark, and:
 *
 * - nothing scrolls the page sideways;
 * - axe finds no colour-contrast failure, so text keeps 4.5:1 in the site's
 *   own values in both themes;
 * - each control a visitor taps (an accordion's question, the poster's play
 *   button, a form's fields and its send button, the lightbox's Close) is at
 *   least 44px tall, and the open lightbox keeps its contrast too;
 * - on a phone, a form's fields use at least a 16px font, so the browser
 *   never zooms into them.
 *
 * Its own page, named uniquely, so no lock is needed.
 *
 * @module tests/core-blocks-live-parts.spec
 */
import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  type APIRequestContext,
  type Browser,
  type Page,
} from "@playwright/test";

import { uploadImage } from "./support/media-upload";
import { test } from "./support/test";

const PAGES = "/admin/api/collections/pages/entries";

let counter = 0;
const id = () =>
  `00000000-0000-4000-8000-${String(0xe2300 + ++counter).padStart(12, "0")}`;

const heading = (text: string, level = "h2") => ({
  id: id(),
  type: "core/heading",
  version: 1,
  props: { text, level },
});

/** A published page holding every live part, and its slug. */
async function partsPage(request: APIRequestContext): Promise<string> {
  const picture = await uploadImage(request, `live-parts-${Date.now()}`);
  const slug = `live-parts-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const created = await request.post(PAGES, {
    data: {
      title: `Live parts ${slug}`,
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
            props: { title: "On this page", depth: "h2-h3" },
          },
          heading("Questions"),
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
                  props: { title: "How long does it take?" },
                  slots: {
                    children: [
                      {
                        id: id(),
                        type: "core/text",
                        version: 1,
                        props: { text: "About a week." },
                      },
                    ],
                  },
                },
              ],
            },
          },
          heading("What you get"),
          {
            id: id(),
            type: "core/list",
            version: 1,
            props: { kind: "checks", items: ["A plan", "A price"] },
          },
          heading("Watch"),
          {
            id: id(),
            type: "core/embed",
            version: 1,
            props: {
              title: "How it works",
              allowFullscreen: true,
              load: "click",
              privacy: true,
              src: "https://www.youtube.com/watch?v=aqz-KE-bpKQ",
            },
          },
          heading("See it"),
          {
            id: id(),
            type: "core/image",
            version: 1,
            props: {
              mediaId: picture.id,
              alt: "The finished room",
              whenClicked: "enlarge",
            },
          },
          heading("Ask us"),
          {
            id: id(),
            type: "core/form",
            version: 2,
            props: {
              submitText: "Send",
              fields: [
                { label: "Name", type: "text", required: true },
                { label: "Email", type: "email", required: true },
                { label: "Message", type: "textarea" },
              ],
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
  width: number,
  colorScheme: "light" | "dark"
): Promise<Page> {
  const context = await browser.newContext({
    baseURL,
    storageState: { cookies: [], origins: [] },
    viewport: { width, height: 800 },
    colorScheme,
  });
  return context.newPage();
}

/** The controls a visitor taps in the parts, shorter than 44px. */
async function shortTargets(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const taps = [
      ...document.querySelectorAll(
        "summary, form input, form textarea, form select, form button, button[aria-label^='Play']"
      ),
    ];
    return taps
      .filter(element => {
        // Only what a visitor can reach: a form's spam trap is out of the
        // tab order and hidden, and nobody taps it.
        if ((element as HTMLElement).tabIndex < 0) return false;
        if (element.closest("[aria-hidden='true']") !== null) return false;
        const box = element.getBoundingClientRect();
        return box.width > 0 && box.height < 44;
      })
      .map(element => {
        const box = element.getBoundingClientRect();
        return `${element.tagName.toLowerCase()}${element.getAttribute("type") === null ? "" : `[type=${element.getAttribute("type")}]`}${element.getAttribute("name") === null ? "" : `[name=${element.getAttribute("name")}]`} "${(element.getAttribute("aria-label") ?? element.textContent ?? "").trim().slice(0, 30)}" ${Math.round(box.height)}px tall`;
      });
  });
}

test.describe("the core blocks' live parts", () => {
  test.describe.configure({ timeout: 240_000 });

  test("fit 320px and 1440px, keep contrast in light and dark, and are easy to tap", async ({
    page,
    browser,
    baseURL,
  }) => {
    const slug = await partsPage(page.request);
    const problems: string[] = [];
    for (const width of [320, 1440]) {
      for (const scheme of ["light", "dark"] as const) {
        const at = `${width}px ${scheme}`;
        const live = await visitor(browser, baseURL, width, scheme);
        const response = await live.goto(`/${slug}`);
        expect(response?.ok(), `${at}: the page answers`).toBe(true);
        await expect(
          live.getByRole("navigation", { name: "On this page" })
        ).toBeVisible();

        const sideways = await live.evaluate(
          () =>
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth
        );
        if (sideways > 0)
          problems.push(`${at}: scrolls ${sideways}px sideways`);

        const contrast = await new AxeBuilder({ page: live })
          .withRules(["color-contrast"])
          .analyze();
        for (const violation of contrast.violations) {
          for (const node of violation.nodes) {
            problems.push(`${at}: contrast ${node.target.join(" ")}`);
          }
        }

        for (const target of await shortTargets(live)) {
          problems.push(`${at}: ${target}`);
        }

        if (width === 320) {
          const small = await live.evaluate(() =>
            [
              ...document.querySelectorAll(
                "form input, form textarea, form select"
              ),
            ]
              .filter(
                field => parseFloat(getComputedStyle(field).fontSize) < 16
              )
              .map(
                field =>
                  `${field.getAttribute("name") ?? field.tagName} ${getComputedStyle(field).fontSize}`
              )
          );
          for (const field of small)
            problems.push(`${at}: form field font ${field}`);
        }

        // The lightbox, open: its Close is easy to tap, and its own colours
        // hold their contrast.
        await live
          .getByRole("button", { name: "Enlarge: The finished room" })
          .click();
        await expect(
          live.locator("[data-nx-lightbox]:popover-open")
        ).toBeVisible();
        const close = live
          .locator("[data-nx-lightbox]")
          .getByRole("button", { name: "Close" });
        const closeBox = await close.boundingBox();
        if (closeBox === null || closeBox.height < 44 || closeBox.width < 44) {
          problems.push(
            `${at}: lightbox Close ${Math.round(closeBox?.width ?? 0)}x${Math.round(closeBox?.height ?? 0)}px`
          );
        }
        const lightboxContrast = await new AxeBuilder({ page: live })
          .include("[data-nx-lightbox]")
          .withRules(["color-contrast"])
          .analyze();
        for (const violation of lightboxContrast.violations) {
          for (const node of violation.nodes) {
            problems.push(`${at}: lightbox contrast ${node.target.join(" ")}`);
          }
        }
        await live.context().close();
      }
    }
    expect(problems).toEqual([]);
  });
});
