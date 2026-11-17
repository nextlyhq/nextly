/**
 * An Image set to Enlarge, on the live page and on the canvas.
 *
 * - With JavaScript off (and on), a click on the picture opens its full-size
 *   file over the page with its caption, in the browser's own popover; Close,
 *   Escape and a click outside each close it. Focus is back on the picture
 *   after Close, Escape and a click over the picture behind the backdrop; a
 *   click elsewhere leaves it where it went.
 * - The full-size file is fetched only when the lightbox opens.
 * - At 320px and 1440px the opened picture fits 90% of the window, Close is
 *   a 44px target, and the page never scrolls sideways.
 * - In the site's dark values the panel takes them.
 * - On the canvas, a click on the picture selects the block and opens
 *   nothing.
 *
 * Each test makes its own page, named uniquely, so no lock is needed.
 *
 * @module tests/image-lightbox.spec
 */
import {
  expect,
  type APIRequestContext,
  type Browser,
  type Page,
} from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { canvasFrame } from "./support/canvas-frame";
import { pngBuffer } from "./support/media-files";
import { test } from "./support/test";

const PAGES = "/admin/api/collections/pages/entries";
const IMAGE = "00000000-0000-4000-8000-00000000c401";
const ALT = "Surveyors on a ridge at dawn";
const CAPTION = "The survey team, first light";

/** A unique suffix for this run's names. */
const stamp = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/** A wide picture in the media library, large enough to have copies. */
async function widePicture(request: APIRequestContext): Promise<string> {
  const uploaded = await request.post("/admin/api/media", {
    multipart: {
      file: {
        name: `lightbox-${stamp()}.png`,
        mimeType: "image/png",
        buffer: pngBuffer(90, 0, { width: 2400, height: 1350 }),
      },
    },
  });
  expect(uploaded.ok(), `uploading: ${uploaded.status()}`).toBe(true);
  const body = (await uploaded.json()) as { item?: { id: string } };
  return String(body.item?.id);
}

/** A page in `collection` holding one enlarged Image, and its id and slug. */
async function enlargedPage(
  request: APIRequestContext,
  collection: string,
  status: "draft" | "published"
): Promise<{ id: string; slug: string }> {
  const mediaId = await widePicture(request);
  const slug = `image-lightbox-${stamp()}`;
  const created = await request.post(collection, {
    data: {
      title: `Image lightbox ${slug}`,
      slug,
      status,
      content: {
        formatVersion: 1,
        kind: "page",
        nodes: [
          {
            id: IMAGE,
            type: "core/image",
            version: 1,
            props: {
              mediaId,
              alt: ALT,
              caption: CAPTION,
              whenClicked: "enlarge",
            },
          },
        ],
      },
    },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const id = ((await created.json()) as { item: { id: string } }).item.id;
  return { id, slug };
}

/** A visitor's page, signed in to nothing, at `width`. */
async function visitor(
  browser: Browser,
  baseURL: string | undefined,
  width: number,
  script: boolean,
  colorScheme: "light" | "dark" = "light"
): Promise<Page> {
  const context = await browser.newContext({
    baseURL,
    javaScriptEnabled: script,
    storageState: { cookies: [], origins: [] },
    viewport: { width, height: 900 },
    colorScheme,
  });
  return context.newPage();
}

/** The picture's button and its lightbox, on a visitor's page. */
function lightboxOn(page: Page) {
  const opener = page.getByRole("button", { name: `Enlarge: ${ALT}` });
  const panel = page.locator("[data-nx-lightbox]");
  return {
    opener,
    panel,
    open: page.locator("[data-nx-lightbox]:popover-open"),
    close: panel.getByRole("button", { name: "Close" }),
    // The full-size file, drawn as this element's background.
    full: panel.locator("[data-nx-lightbox-picture]"),
  };
}

/*
 * Every case runs twice: with JavaScript off, which is what the lightbox
 * promises, and on, where nothing a script does may change it.
 */
for (const script of [false, true]) {
  test.describe(`an enlarged Image on the live page, JavaScript ${script ? "on" : "off"}`, () => {
    test.describe.configure({ timeout: 180_000 });

    test("opens full size with its caption, and Close, Escape and a click outside close it, each giving focus back", async ({
      page,
      browser,
      baseURL,
    }) => {
      const { slug } = await enlargedPage(page.request, PAGES, "published");
      const live = await visitor(browser, baseURL, 1440, script);
      await live.goto(`/${slug}`);
      const box = lightboxOn(live);
      // The browser's own popover opens it, with or without a script.
      await expect(box.panel).toHaveCount(1);
      await expect(box.open).toHaveCount(0);
      await expect(box.full).toBeHidden();

      // Close.
      await box.opener.click();
      await expect(box.open).toHaveCount(1);
      await expect(box.full).toBeVisible();
      await expect(box.panel.getByText(CAPTION)).toBeVisible();
      await box.close.click();
      await expect(box.open).toHaveCount(0);
      await expect(box.opener).toBeFocused();

      // Escape, from the keyboard: Enter opens, Tab reaches Close.
      await box.opener.focus();
      await live.keyboard.press("Enter");
      await expect(box.open).toHaveCount(1);
      await live.keyboard.press("Tab");
      await expect(box.close).toBeFocused();
      await live.keyboard.press("Escape");
      await expect(box.open).toHaveCount(0);
      await expect(box.opener).toBeFocused();

      // Close from the keyboard.
      await live.keyboard.press("Enter");
      await live.keyboard.press("Tab");
      await live.keyboard.press("Enter");
      await expect(box.open).toHaveCount(0);
      await expect(box.opener).toBeFocused();

      // A click outside the picture, on the backdrop, closes it. Beside the
      // panel the page's own picture lies beneath, so the click lands on its
      // button, which closes the lightbox and holds the focus.
      await box.opener.click();
      await expect(box.open).toHaveCount(1);
      await box.close.focus();
      const panel = await box.panel.boundingBox();
      expect(panel?.x ?? 0, "room beside the panel").toBeGreaterThan(10);
      await live.mouse.click(
        (panel?.x ?? 0) / 2,
        (panel?.y ?? 0) + (panel?.height ?? 0) / 2
      );
      await expect(box.open).toHaveCount(0);
      await expect(box.opener).toBeFocused();
      // In the window's corner, over the page's header, it closes too; the
      // focus goes where the click went, as the browser's own light dismiss
      // leaves it, rather than back to the picture.
      await box.opener.click();
      await expect(box.open).toHaveCount(1);
      await live.mouse.click(5, 5);
      await expect(box.open).toHaveCount(0);
      await live.context().close();
    });

    test("fetches the full-size file only when the lightbox opens", async ({
      page,
      browser,
      baseURL,
    }) => {
      const { slug } = await enlargedPage(page.request, PAGES, "published");
      const live = await visitor(browser, baseURL, 1440, script);
      const asked: string[] = [];
      live.on("request", request => {
        if (request.resourceType() === "image") asked.push(request.url());
      });
      await live.goto(`/${slug}`);
      const box = lightboxOn(live);
      const pagePicture = box.opener.locator("img");
      await expect
        .poll(() =>
          pagePicture.evaluate(
            element => (element as HTMLImageElement).complete
          )
        )
        .toBe(true);
      const background = /url\("([^"]+)"\)/.exec(
        (await box.full.getAttribute("style")) ?? ""
      )?.[1];
      expect(background, "the full-size file's address").toBeTruthy();
      const full = new URL(background ?? "", live.url()).href;
      const shown = await pagePicture.evaluate(
        element => (element as HTMLImageElement).currentSrc
      );
      // The control: the page draws a sized copy, so the full-size file is a
      // request of its own.
      expect(shown, "the page's picture is a sized copy").not.toBe(full);
      await live.waitForLoadState("networkidle");
      expect(asked.filter(each => each === full)).toHaveLength(0);

      await box.opener.click();
      await expect
        .poll(() => asked.filter(each => each === full).length)
        .toBe(1);
      await live.context().close();
    });

    for (const width of [320, 1440]) {
      test(`fits the window at ${width}px, with a 44px Close and no sideways scroll`, async ({
        page,
        browser,
        baseURL,
      }) => {
        const { slug } = await enlargedPage(page.request, PAGES, "published");
        const live = await visitor(browser, baseURL, width, script);
        await live.goto(`/${slug}`);
        const box = lightboxOn(live);
        await box.opener.click();
        await expect(box.open).toHaveCount(1);
        const size = live.viewportSize() ?? { width, height: 900 };
        const picture = await box.full.boundingBox();
        expect(picture, "the full-size picture has a box").not.toBeNull();
        expect(picture?.width ?? 0).toBeGreaterThan(width * 0.5);
        expect(picture?.width ?? Infinity).toBeLessThanOrEqual(
          size.width * 0.9
        );
        expect(picture?.height ?? Infinity).toBeLessThanOrEqual(
          size.height * 0.9
        );
        // Its proportion kept: 16:9, as the file is.
        expect(
          Math.abs((picture?.width ?? 0) / (picture?.height ?? 1) - 16 / 9)
        ).toBeLessThan(0.02);
        const panel = await box.panel.boundingBox();
        expect(panel?.width ?? Infinity).toBeLessThanOrEqual(
          size.width * 0.9 + 1
        );
        expect(panel?.height ?? Infinity).toBeLessThanOrEqual(
          size.height * 0.9 + 1
        );
        // Centred: as much room on either side, and above as below.
        expect(
          Math.abs(
            (panel?.x ?? 0) -
              (size.width - (panel?.x ?? 0) - (panel?.width ?? 0))
          )
        ).toBeLessThanOrEqual(2);
        expect(
          Math.abs(
            (panel?.y ?? 0) -
              (size.height - (panel?.y ?? 0) - (panel?.height ?? 0))
          )
        ).toBeLessThanOrEqual(2);
        // The panel hugs the picture rather than leaving a band beside it.
        expect((panel?.width ?? 0) - (picture?.width ?? 0)).toBeLessThan(40);
        const close = await box.close.boundingBox();
        expect(close?.width ?? 0).toBeGreaterThanOrEqual(44);
        expect(close?.height ?? 0).toBeGreaterThanOrEqual(44);
        expect(
          await live.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth
          )
        ).toBe(true);
        await live.context().close();
      });
    }

    test("takes the site's dark values in a dark window", async ({
      page,
      browser,
      baseURL,
    }) => {
      const { slug } = await enlargedPage(page.request, PAGES, "published");
      const colours: Record<string, { background: string; text: string }> = {};
      for (const scheme of ["light", "dark"] as const) {
        const live = await visitor(browser, baseURL, 1440, script, scheme);
        await live.goto(`/${slug}`);
        const box = lightboxOn(live);
        await box.opener.click();
        await expect(box.open).toHaveCount(1);
        colours[scheme] = await box.panel.evaluate(element => {
          const style = getComputedStyle(element);
          return { background: style.backgroundColor, text: style.color };
        });
        await live.context().close();
      }
      // The site's page colours, as its default tokens hold them.
      expect(colours.light).toEqual({
        background: "rgb(255, 255, 255)",
        text: "rgb(17, 24, 39)",
      });
      expect(colours.dark).toEqual({
        background: "rgb(11, 15, 25)",
        text: "rgb(249, 250, 251)",
      });
    });
  });
}

test.describe("an enlarged Image on the canvas", () => {
  test.describe.configure({ timeout: 180_000 });

  test("a click on the picture selects the block and opens nothing", async ({
    page,
  }) => {
    const { id } = await enlargedPage(page.request, PAGES, "draft");
    await gotoAdmin(page, `/collections/pages/${id}/builder?field=content`);
    await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible({
      timeout: 60_000,
    });
    const canvas = canvasFrame(page);
    await canvas.getByRole("button", { name: `Enlarge: ${ALT}` }).click();
    await expect(page.locator("[data-block-card]")).toBeVisible();
    await expect(page.locator("[data-block-card]")).toContainText("Image");
    await expect(canvas.locator("[data-nx-lightbox]:popover-open")).toHaveCount(
      0
    );
  });
});
