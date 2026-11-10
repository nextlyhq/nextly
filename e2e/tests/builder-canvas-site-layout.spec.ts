/**
 * The canvas drawn inside the site's own layout.
 *
 * The playground serves the page builder's canvas route (`canvasPath`), an
 * empty mount point in the layout its published pages use, so the editor's
 * frame loads that page and draws the page being edited in it: the site's
 * global stylesheet reaches the canvas exactly as it reaches the published
 * page. Where the route cannot be shown, the canvas draws on the editor's own
 * blank page and a note above it says why.
 *
 * Black box like the rest of `e2e/`: no product code is imported.
 */
import { expect, type Page, type Route } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { canvasFrame, CANVAS_FRAME } from "./support/canvas-frame";
import { LOCK } from "./support/locks";
import { test } from "./support/test";

// Writes the homepage's layout, which other specs share; see support/locks.ts.
test.describe.configure({ lock: [LOCK.homepage] });

const OPEN_BUILDER_ACTION = /^(?:Build this page|Open Page Builder)$/;
const HOMEPAGE_API = "/admin/api/singles/homepage";
const BUILDER_URL = /\/admin\/singles\/homepage\/builder\?field=layout$/;
/** The playground's canvas route, its `canvasPath`. */
const CANVAS_ROUTE = "/page-builder-canvas";
/** What the note says when the route is set but cannot be shown. */
const FALLBACK_NOTE =
  "Shown without your site’s header, footer and styles. The site’s canvas page didn’t load. Details";

const TEXTS = {
  heading: "A heading on the site",
  text: "A paragraph the site's own stylesheet sets in its type.",
  button: "Get started",
} as const;

const NODES = [
  {
    id: "heading",
    type: "core/heading",
    version: 1,
    props: { text: TEXTS.heading, level: "h2" },
  },
  { id: "text", type: "core/text", version: 1, props: { text: TEXTS.text } },
  {
    id: "button",
    type: "core/button",
    version: 1,
    props: { label: TEXTS.button, href: "/start" },
  },
];

/** The properties a site's global stylesheet sets for every page. */
const TYPE = ["lineHeight", "fontFamily", "color"] as const;

type TypeReading = Record<string, Record<(typeof TYPE)[number], string>>;

async function seed(page: Page): Promise<void> {
  const stored = await page.request.patch(HOMEPAGE_API, {
    data: {
      layout: { formatVersion: 1, kind: "page", nodes: NODES },
      _overwrite: true,
    },
  });
  expect(stored.ok(), `seeding the homepage layout: ${stored.status()}`).toBe(
    true
  );
}

/**
 * The type of each text, read off the innermost element holding it, in the
 * document `root` is evaluated in.
 */
function readType(
  root: { evaluate: Page["evaluate"] },
  scope: string
): Promise<TypeReading> {
  return root.evaluate(
    ([texts, props, within]) => {
      const out: Record<string, Record<string, string>> = {};
      const holder = document.querySelector(within) ?? document.body;
      for (const [key, text] of Object.entries(texts)) {
        // The innermost element whose text is this text: on the canvas a
        // label can carry an element of the editor's own beside its words.
        const holds = (each: Element) =>
          (each.textContent ?? "").trim() === text;
        const element = [...holder.querySelectorAll("*")].find(
          each => holds(each) && ![...each.children].some(holds)
        );
        if (element === undefined) throw new Error(`no element reads ${text}`);
        const style = getComputedStyle(element);
        out[key] = Object.fromEntries(props.map(prop => [prop, style[prop]]));
      }
      return out;
    },
    [TEXTS, TYPE, scope] as const
  ) as Promise<TypeReading>;
}

async function openBuilder(page: Page): Promise<void> {
  await gotoAdmin(page, "/singles/homepage");
  await page.getByRole("link", { name: OPEN_BUILDER_ACTION }).click();
  await expect(page).toHaveURL(BUILDER_URL);
  await expect(
    canvasFrame(page).locator(".nx-canvas").getByText(TEXTS.heading)
  ).toBeVisible({ timeout: 30_000 });
}

/** The address of the page the canvas frame holds. */
async function framePage(page: Page): Promise<string> {
  const frame = await page.locator(CANVAS_FRAME).elementHandle();
  return (await frame?.contentFrame())?.url() ?? "";
}

/** The note above the canvas saying it is drawn without the site's layout. */
function siteLayoutNote(page: Page) {
  return page.locator('[data-canvas-state^="site-layout-"]');
}

/** Answer the canvas route's request with `answer`, for one test. */
async function answerCanvasRoute(
  page: Page,
  answer: (route: Route) => Promise<void>
): Promise<void> {
  await page.route(`**${CANVAS_ROUTE}`, async route => {
    // A thrown handler prints the request, headers and all; answer instead.
    try {
      await answer(route);
    } catch {
      await route.abort().catch(() => undefined);
    }
  });
}

test.describe("the canvas in the site's own layout", () => {
  test("draws the page in the site's own type and ink, as it is published", async ({
    page,
  }) => {
    await seed(page);
    await page.goto("/");
    for (const text of Object.values(TEXTS)) {
      await expect(page.getByText(text, { exact: true })).toBeVisible();
    }
    const published = await readType(page, "body");

    await openBuilder(page);
    expect(new URL(await framePage(page)).pathname).toBe(CANVAS_ROUTE);
    // Inside the route's mount point, with nothing said about a fallback.
    await expect(
      canvasFrame(page).locator("[data-nx-canvas-mount] .nx-canvas")
    ).toHaveCount(1);
    await expect(siteLayoutNote(page)).toHaveCount(0);

    // Every block drawn before any is read: they arrive one by one.
    for (const text of Object.values(TEXTS)) {
      await expect(
        canvasFrame(page).locator(".nx-canvas").getByText(text, { exact: true })
      ).toBeVisible();
    }
    const frame = page.frame({ url: url => url.pathname === CANVAS_ROUTE });
    if (frame === null) throw new Error("no canvas route frame");
    const canvas = await readType(frame, ".nx-canvas");
    // Line height, font stack and ink, element by element: the site's global
    // stylesheet decides each, on the canvas as on the published page.
    expect(canvas).toEqual(published);
  });

  test("keeps the site's own header around the page, inert", async ({
    page,
  }) => {
    await seed(page);
    await openBuilder(page);
    const frame = page.frame({ url: url => url.pathname === CANVAS_ROUTE });
    if (frame === null) throw new Error("no canvas route frame");
    // A header with a link and a form, as a site's layout draws one; put in
    // once the page is up, as a layout drawing part of itself late would.
    await frame.evaluate(() => {
      const header = document.createElement("header");
      header.id = "site-header";
      header.innerHTML =
        '<a href="/elsewhere">Site link</a><form action="/search"><input name="q" aria-label="Site search"></form>';
      document.body.prepend(header);
    });
    // Held to the visible header: an id alone would also match one in a hidden copy of a page.
    const header = canvasFrame(page).locator("#site-header:visible");
    await expect(header).toHaveAttribute("inert", "");
    await expect(header).toHaveAttribute("data-nx-site-chrome", "");

    // Pointing at it says why it can't be used: a cue over it in the editor,
    // with a not-allowed cursor and a tag naming it as the site's layout.
    const headerBox = await header.boundingBox();
    if (headerBox === null) throw new Error("the site's header is not drawn");
    await page.mouse.move(headerBox.x + 8, headerBox.y + headerBox.height / 2);
    // The cue the pointer is over: the header's.
    const cue = page.locator(".nx-site-chrome-cue:hover");
    await expect(cue).toHaveCount(1);
    await expect(cue.locator(".nx-site-chrome-cue__tag")).toHaveText(
      "Part of your site’s layout"
    );
    await expect(cue.locator(".nx-site-chrome-cue__tag")).toHaveCSS(
      "opacity",
      "1"
    );
    await expect(cue).toHaveCSS("cursor", "not-allowed");

    // Neither its link nor its field can be reached: a press on the link
    // leaves the frame where it is, and the field takes no focus.
    const link = canvasFrame(page).getByText("Site link");
    const box = await link.boundingBox();
    if (box === null) throw new Error("the site's link is not drawn");
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    expect(new URL(await framePage(page)).pathname).toBe(CANVAS_ROUTE);
    await expect(page).toHaveURL(BUILDER_URL);
    expect(
      await frame.evaluate(() => {
        const field =
          document.querySelector<HTMLInputElement>("#site-header input");
        field?.focus();
        return document.activeElement === field;
      })
    ).toBe(false);
  });

  test("falls back to the blank page, and says so, where the route is not found", async ({
    page,
  }) => {
    await seed(page);
    await answerCanvasRoute(page, route =>
      route.fulfill({
        status: 404,
        contentType: "text/html",
        body: "<!doctype html><html><body><main><h1>Not found</h1></main></body></html>",
      })
    );
    await openBuilder(page);
    await expect(siteLayoutNote(page)).toHaveAttribute(
      "data-canvas-state",
      "site-layout-not-served"
    );
    await expect(siteLayoutNote(page)).toHaveText(FALLBACK_NOTE);
    expect(await framePage(page)).toBe("about:srcdoc");
  });

  test("never draws into a route on another origin", async ({ page }) => {
    await seed(page);
    // The same route, reached by a redirect from `localhost`, the suite's
    // host, to `127.0.0.1`: another origin, whose document the editor cannot
    // reach.
    await answerCanvasRoute(page, route => {
      const elsewhere = new URL(route.request().url());
      // The redirected request matches too; it is let through to be served.
      if (elsewhere.hostname !== "localhost") return route.continue();
      elsewhere.hostname = "127.0.0.1";
      return route.fulfill({
        status: 302,
        headers: { location: elsewhere.href },
      });
    });
    await openBuilder(page);
    await expect(siteLayoutNote(page)).toHaveAttribute(
      "data-canvas-state",
      "site-layout-other-origin"
    );
    await expect(siteLayoutNote(page)).toHaveText(FALLBACK_NOTE);
    expect(await framePage(page)).toBe("about:srcdoc");
  });
});
