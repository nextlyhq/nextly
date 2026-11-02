/**
 * The editor's canvas draws the page in the SITE's colours and type, whatever
 * theme the admin around it is in.
 *
 * The canvas sits inside the admin, so anything it does not state for itself it
 * inherits from the admin: the background, the text colour, the font and the
 * colour scheme native controls and scrollbars are drawn in. In dark mode that
 * made a white site's page solid black with light text, which is a page no
 * visitor ever loads. Only a real browser can see this: jsdom applies no stylesheet and
 * resolves no inherited colour.
 *
 * The editor's own chrome drawn over the page — the block toolbar here — is the
 * other half of the contract: it stays in the ADMIN's theme and face, so it
 * reads as the editor's and remains legible on top of any page. The marks drawn
 * on the page — the selection ring — take a hue chosen for the page's ground.
 *
 * Driven through the playground's homepage Single, whose `layout` field is a
 * blocks field, and compared against the same document as the site serves it.
 *
 * @module tests/builder-canvas-colours
 */
import { expect, type Locator, type Page } from "@playwright/test";

import { test } from "./support/test";
import { contrastRatio, gotoAdmin, toRgb, type Theme } from "./support/admin";
import { LOCK } from "./support/locks";

// Shares state with other specs; see support/locks.ts for what each lock guards.
test.describe.configure({ lock: [LOCK.homepage] });

const OPEN_BUILDER_ACTION = /^(?:Build this page|Open Page Builder)$/;
const HOMEPAGE_API = "/admin/api/singles/homepage";
const HEADING = "Canvas colours";
const PARAGRAPH = "The canvas draws this page the way a visitor sees it.";

const NODES = [
  {
    id: "intro",
    type: "core/section",
    version: 1,
    props: { as: "section", contained: true },
    // A background of the section's own, from a site token, so the page has a
    // surface that is the SITE's colour rather than an inherited one.
    styles: {
      base: {
        base: {
          backgroundColor: { $token: "color.surface" },
          padding: {
            blockStart: "2rem",
            blockEnd: "2rem",
            inlineStart: "2rem",
            inlineEnd: "2rem",
          },
        },
      },
    },
    slots: {
      children: [
        {
          id: "title",
          type: "core/heading",
          version: 1,
          props: { text: HEADING, level: "h1" },
        },
        {
          id: "lead",
          type: "core/text",
          version: 1,
          props: { text: PARAGRAPH },
        },
        {
          id: "cta",
          type: "core/button",
          version: 1,
          props: { label: "Get started", href: "/start" },
        },
      ],
    },
  },
  {
    id: "logo",
    type: "core/image",
    version: 1,
    props: { src: "/nextly-logo.svg", alt: "The Nextly logo" },
    styles: { base: { base: { width: "240px" } } },
  },
];

async function seed(page: Page): Promise<void> {
  const stored = await page.request.patch(HOMEPAGE_API, {
    data: { layout: { formatVersion: 1, kind: "page", nodes: NODES } },
  });
  expect(stored.ok(), `seeding the homepage layout: ${stored.status()}`).toBe(
    true
  );
}

/** The text block's element on the canvas. */
function canvasText(page: Page): Locator {
  return page.locator('.nx-canvas [data-nx-node="lead"]').first();
}

async function openBuilder(page: Page, theme: Theme): Promise<void> {
  await seed(page);
  await gotoAdmin(page, "/singles/homepage", theme);
  await page.getByRole("link", { name: OPEN_BUILDER_ACTION }).click();
  await expect(canvasText(page)).toBeVisible({ timeout: 30_000 });
}

/**
 * The colour a reader actually sees behind an element: its own background, or
 * the first ancestor's that is not transparent.
 *
 * Walked rather than read off one element because the canvas and the published
 * page paint their ground at different depths — the published page leaves it
 * to the document, the canvas states it on its own root — and the question is
 * the same for both.
 */
async function groundBehind(target: Locator): Promise<string> {
  return target.evaluate(element => {
    for (let at: Element | null = element; at !== null; at = at.parentElement) {
      const fill = getComputedStyle(at).backgroundColor;
      if (fill !== "rgba(0, 0, 0, 0)" && fill !== "transparent") return fill;
    }
    // Nothing painted at all: the browser's own canvas colour shows.
    return "rgb(255, 255, 255)";
  });
}

/**
 * What the published homepage paints behind the page.
 *
 * Read once the seeded heading is on screen: an empty page root has no box,
 * and a ground read before the document arrived would describe nothing.
 */
async function published(
  page: Page
): Promise<{ ground: [number, number, number] }> {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: HEADING, level: 1 })
  ).toBeVisible({ timeout: 30_000 });
  const root = page.locator(".nx-pb-page").first();
  return { ground: await toRgb(page, await groundBehind(root)) };
}

for (const theme of ["dark", "light"] as const) {
  test.describe(`with the admin in ${theme} mode`, () => {
    test("the canvas page takes the site's colours, not the admin's", async ({
      page,
      context,
    }) => {
      // The first visit to each route compiles it in the dev server.
      test.slow();
      await seed(page);
      // The published page first, in a tab of its own so the admin's theme
      // storage never reaches it.
      const site = await published(await context.newPage());

      await openBuilder(page, theme);
      const canvas = page.locator(".nx-canvas");

      expect(
        await toRgb(page, await groundBehind(canvas)),
        "the page behind the blocks is the site's ground, as published"
      ).toEqual(site.ground);

      expect(
        await canvas.evaluate(element => getComputedStyle(element).colorScheme),
        "native controls and scrollbars on the page follow the site, not the admin"
      ).toBe("light");

      // The admin's own text colour, read off the editor's chrome root.
      const adminText = await toRgb(
        page,
        await page
          .locator(".nx-builder-chrome")
          .first()
          .evaluate(element => getComputedStyle(element).color)
      );
      const pageText = await toRgb(
        page,
        await canvasText(page).evaluate(
          element => getComputedStyle(element).color
        )
      );
      if (theme === "dark") {
        expect(
          pageText,
          "the page's text is not the admin's light foreground"
        ).not.toEqual(adminText);
      }
      expect(
        contrastRatio(pageText, site.ground),
        `page text ${pageText.join(",")} must read on the site's ground`
      ).toBeGreaterThanOrEqual(4.5);

      // The page is set in the site's body font, not the admin's Geist.
      const face = await canvasText(page).evaluate(
        element => getComputedStyle(element).fontFamily
      );
      expect(face, "the page is not set in the admin's face").not.toContain(
        "Geist"
      );
      expect(face.split(",")[0]?.trim()).toBe("system-ui");
    });

    test("the editor's marks on the page are legible and its chrome stays the admin's", async ({
      page,
    }) => {
      test.slow();
      await openBuilder(page, theme);
      await canvasText(page).click();

      const toolbar = page.locator(".nx-canvas .nx-block-toolbar");
      await expect(toolbar).toBeVisible({ timeout: 15_000 });

      expect(
        await toolbar.evaluate(
          element => getComputedStyle(element).colorScheme
        ),
        "chrome's native controls follow the admin's theme"
      ).toBe(theme);

      /*
       * The selection ring is drawn on the PAGE, so its hue is the one for the
       * page's light ground in either admin theme: the admin's primary was
       * white in the dark theme and vanished on a white page.
       */
      const selected = canvasText(page);
      await expect(selected).toHaveAttribute("data-nx-selected", /.*/);
      const ring = await toRgb(
        page,
        await selected.evaluate(
          element => getComputedStyle(element).outlineColor
        )
      );
      expect(ring, "the selection ring is the select blue").toEqual([
        37, 99, 235,
      ]);
      const ground = await toRgb(
        page,
        await groundBehind(page.locator(".nx-canvas"))
      );
      expect(
        contrastRatio(ring, ground),
        "the ring stands out from the page it is drawn on"
      ).toBeGreaterThanOrEqual(3);

      /*
       * The bar of block actions is a dark ink with light text in both themes,
       * so it reads the same on any page and is legible on its own surface.
       */
      const toolbarText = await toRgb(
        page,
        await toolbar
          .locator("button")
          .first()
          .evaluate(element => getComputedStyle(element).color)
      );
      const toolbarFill = await toRgb(
        page,
        await toolbar.evaluate(
          element => getComputedStyle(element).backgroundColor
        )
      );
      expect(
        contrastRatio(toolbarFill, [0, 0, 0]),
        `the toolbar is a dark bar, not ${toolbarFill.join(",")}`
      ).toBeLessThan(1.5);
      expect(
        contrastRatio(toolbarText, toolbarFill),
        "the toolbar stays legible on its own surface"
      ).toBeGreaterThanOrEqual(4.5);

      // The bar keeps the admin's face; the page around it does not.
      expect(
        await toolbar
          .locator("button")
          .first()
          .evaluate(element => getComputedStyle(element).fontFamily),
        "the toolbar is set in the admin's face"
      ).toContain("Geist");
    });
  });
}

test.describe("with the system in dark mode", () => {
  test("the canvas page follows the site's own dark mode, not the admin's light one", async ({
    page,
    context,
  }) => {
    /*
     * The playground's site darkens with the system (its strategy is `media`),
     * so with the system in dark its tokens take their dark values and the
     * published page is dark — while the admin here is pinned to LIGHT. The
     * canvas page has to follow the site: a light ground under dark tokens is
     * a page no visitor loads.
     */
    test.slow();
    await page.emulateMedia({ colorScheme: "dark" });
    await seed(page);
    const sitePage = await context.newPage();
    await sitePage.emulateMedia({ colorScheme: "dark" });
    const site = await published(sitePage);
    expect(
      contrastRatio(site.ground, [0, 0, 0]),
      "the published page is dark with the system in dark"
    ).toBeLessThan(1.5);

    await openBuilder(page, "light");
    const canvas = page.locator(".nx-canvas");
    expect(
      await canvas.evaluate(element => getComputedStyle(element).colorScheme)
    ).toBe("dark");
    const ground = await toRgb(page, await groundBehind(canvas));
    expect(
      contrastRatio(ground, [0, 0, 0]),
      `the canvas page is dark too, not ${ground.join(",")}`
    ).toBeLessThan(1.5);
    const pageText = await toRgb(
      page,
      await canvasText(page).evaluate(
        element => getComputedStyle(element).color
      )
    );
    expect(
      contrastRatio(pageText, ground),
      `page text ${pageText.join(",")} must read on the dark page`
    ).toBeGreaterThanOrEqual(4.5);
  });
});
