/**
 * An Embed with a provider's link, on the live page and in the editor.
 *
 * - On the live page with JavaScript off, a YouTube link set to play when
 *   pressed makes no request to YouTube's hosts until the visitor presses
 *   "Play: <title>" on the poster; then the frame loads the no-cookie player.
 * - With privacy mode off, the poster plays the normal player; with "Right
 *   away", the player frame is on the page, loaded lazily.
 * - A poster picture from the media library is served by the site.
 * - On the canvas, a new Embed asks for a link; one pasted is stored with
 *   the provider's shape, and the inspector says what was found.
 * - "Use the video's thumbnail" finds the copy the media library holds for
 *   the video and makes it the poster, and a second press adds no copy. The
 *   copy's first fetch, from the provider's own host, is the route's unit
 *   test's: a browser test cannot stand in for YouTube's picture host.
 *
 * Each test makes its own page, named uniquely, so no lock is needed. The
 * provider's hosts are answered by the test, so nothing leaves the machine.
 *
 * @module tests/builder-embed.spec
 */
import {
  expect,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { canvasFrame } from "./support/canvas-frame";
import { pngBuffer } from "./support/media-files";
import { uploadImage } from "./support/media-upload";
import { test } from "./support/test";

const PAGES = "/admin/api/collections/pages/entries";
const EMBED = "00000000-0000-4000-8000-00000000e801";
const TITLE = "Our launch";

/** A unique suffix for this run's names. */
const stamp = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/** A YouTube video id of this run's own: eleven of its URL-safe characters. */
function videoId(): string {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";
  return Array.from(
    { length: 11 },
    () => alphabet[Math.floor(Math.random() * alphabet.length)]
  ).join("");
}

/** The hosts a YouTube embed would reach. */
const YOUTUBE_HOSTS =
  /^https:\/\/([a-z0-9-]+\.)?(youtube\.com|youtube-nocookie\.com|ytimg\.com|googlevideo\.com)\//;

/** A page in the pages collection holding one Embed, and its id and slug. */
async function embedPage(
  request: APIRequestContext,
  props: Record<string, unknown>,
  status: "draft" | "published" = "published"
): Promise<{ id: string; slug: string }> {
  const slug = `embed-${stamp()}`;
  const created = await request.post(PAGES, {
    data: {
      title: `Embed ${slug}`,
      slug,
      status,
      content: {
        formatVersion: 1,
        kind: "page",
        nodes: [{ id: EMBED, type: "core/embed", version: 1, props }],
      },
    },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const id = ((await created.json()) as { item: { id: string } }).item.id;
  return { id, slug };
}

/**
 * A visitor's page, signed in to nothing, whose requests to YouTube's hosts
 * are answered here and recorded.
 */
async function visitor(
  browser: Browser,
  baseURL: string | undefined,
  script: boolean
): Promise<{ page: Page; context: BrowserContext; provider: string[] }> {
  const context = await browser.newContext({
    baseURL,
    javaScriptEnabled: script,
    storageState: { cookies: [], origins: [] },
    viewport: { width: 1280, height: 900 },
  });
  const provider: string[] = [];
  await context.route(YOUTUBE_HOSTS, route => {
    provider.push(route.request().url());
    return route
      .fulfill({
        contentType: "text/html",
        body: "<!doctype html><title>player</title><p>The player</p>",
      })
      .catch(() => undefined);
  });
  return { page: await context.newPage(), context, provider };
}

const NEW_EMBED = { title: TITLE, allowFullscreen: true, load: "click", privacy: true };

test.describe("an Embed on the live page", () => {
  test.describe.configure({ timeout: 180_000 });

  test("asks nothing of YouTube until play, with JavaScript off, then plays the no-cookie player", async ({
    page,
    browser,
    baseURL,
  }) => {
    const id = videoId();
    const { slug } = await embedPage(page.request, {
      ...NEW_EMBED,
      src: `https://www.youtube.com/watch?v=${id}`,
    });
    const live = await visitor(browser, baseURL, false);
    await live.page.goto(`/${slug}`, { waitUntil: "load" });

    const frame = live.page.frameLocator(`iframe[title="${TITLE}"]`);
    const play = frame.getByRole("link", { name: `Play: ${TITLE}` });
    await expect(play).toBeVisible();
    await expect(frame.getByText("YouTube")).toBeVisible();
    // Settled: the page and its poster are loaded, and nothing went to YouTube.
    await live.page.waitForLoadState("networkidle");
    expect(live.provider).toEqual([]);

    const loaded = live.page.waitForRequest(request =>
      request.url().startsWith(`https://www.youtube-nocookie.com/embed/${id}`)
    );
    await play.click();
    expect((await loaded).url()).toBe(
      `https://www.youtube-nocookie.com/embed/${id}?autoplay=1`
    );
    await expect(frame.getByText("The player")).toBeVisible();
    await live.context.close();
  });

  test("plays the normal player with privacy mode off, and loads it lazily with Right away", async ({
    page,
    browser,
    baseURL,
  }) => {
    const id = videoId();
    const off = await embedPage(page.request, {
      ...NEW_EMBED,
      privacy: false,
      src: `https://youtu.be/${id}`,
    });
    const away = await embedPage(page.request, {
      ...NEW_EMBED,
      load: "page",
      src: `https://youtu.be/${id}`,
    });
    const live = await visitor(browser, baseURL, false);

    await live.page.goto(`/${off.slug}`);
    await expect(
      live.page
        .frameLocator(`iframe[title="${TITLE}"]`)
        .getByRole("link", { name: `Play: ${TITLE}` })
    ).toHaveAttribute("href", `https://www.youtube.com/embed/${id}?autoplay=1`);

    await live.page.goto(`/${away.slug}`);
    const player = live.page.locator(`iframe[title="${TITLE}"]`);
    await expect(player).toHaveAttribute(
      "src",
      `https://www.youtube-nocookie.com/embed/${id}`
    );
    await expect(player).toHaveAttribute("loading", "lazy");
    await live.context.close();
  });

  test("draws a poster picture from the site's media library", async ({
    page,
    browser,
    baseURL,
  }) => {
    const picture = await uploadImage(page.request, `embed-poster-${stamp()}`);
    const { slug } = await embedPage(page.request, {
      ...NEW_EMBED,
      poster: picture.id,
      src: `https://www.youtube.com/watch?v=${videoId()}`,
    });
    const live = await visitor(browser, baseURL, false);
    await live.page.goto(`/${slug}`, { waitUntil: "load" });
    const poster = live.page
      .frameLocator(`iframe[title="${TITLE}"]`)
      .locator("img");
    await expect(poster).toHaveCount(1);
    const src = await poster.getAttribute("src");
    // The site's own file, never the provider's picture.
    expect(new URL(String(src), baseURL).origin).toBe(new URL(String(baseURL)).origin);
    await live.page.waitForLoadState("networkidle");
    expect(live.provider).toEqual([]);
    await live.context.close();
  });
});

test.describe("an Embed in the editor", () => {
  test.describe.configure({ timeout: 180_000 });

  async function openBuilder(page: Page, id: string): Promise<void> {
    await gotoAdmin(page, `/collections/pages/${id}/builder?field=content`);
    await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible({
      timeout: 60_000,
    });
  }

  test("asks for a link, stores a pasted one with the provider's shape, and says what it found", async ({
    page,
  }) => {
    const { id } = await embedPage(
      page.request,
      { title: "", allowFullscreen: true, load: "click", privacy: true },
      "draft"
    );
    await openBuilder(page, id);
    // The box the Embed draws for the field, sized as the frame would be.
    await expect(
      canvasFrame(page).locator(`[data-nx-node="${EMBED}"][data-nx-embed-empty]`)
    ).toBeVisible();
    const field = page.getByLabel("Paste a YouTube, Vimeo or other link");
    await expect(field).toBeVisible();

    const video = videoId();
    await field.fill(`https://www.youtube.com/shorts/${video}`);
    await page
      .locator(".nx-embed-state")
      .getByRole("button", { name: "Embed", exact: true })
      .click();

    // The poster replaces the box, and the inspector says what was found.
    await expect(
      canvasFrame(page).locator(`iframe[data-nx-node="${EMBED}"]`)
    ).toBeVisible();
    await expect(
      page.getByText("YouTube detected. Size set from the video.")
    ).toBeVisible();
    await expect(page.getByText("Privacy mode", { exact: true })).toBeVisible();
    // Written as the block's own proportion, which Style shows and changes.
    await expect
      .poll(() =>
        canvasFrame(page)
          .locator(`iframe[data-nx-node="${EMBED}"]`)
          .evaluate(element => getComputedStyle(element).aspectRatio)
      )
      .toBe("9 / 16");
  });

  test("Use the video's thumbnail makes the library's copy the poster, and adds no second copy", async ({
    page,
  }) => {
    const video = videoId();
    const name = `youtube-${video}-thumbnail`;
    const copied = await page.request.post("/admin/api/media", {
      multipart: {
        file: {
          name: `${name}.png`,
          mimeType: "image/png",
          buffer: pngBuffer(120, 0, { width: 480, height: 360 }),
        },
      },
    });
    expect(copied.ok(), `uploading: ${copied.status()}`).toBe(true);
    const copyId = String(
      ((await copied.json()) as { item?: { id: string } }).item?.id
    );

    const { id } = await embedPage(
      page.request,
      { ...NEW_EMBED, src: `https://www.youtube.com/watch?v=${video}` },
      "draft"
    );
    await openBuilder(page, id);
    // The editor's see-through cover over the frame takes the click and
    // selects the Embed: the frame's own document never sees it.
    await page.locator('.nx-embed-state[data-embed-state="frame"]').click();

    const thumbnail = page.getByRole("button", {
      name: "Use the video's thumbnail",
    });
    for (const _press of [1, 2]) {
      const answered = page.waitForResponse(
        response =>
          response.url().includes("/embed-thumbnail") && response.ok()
      );
      await thumbnail.click();
      const body = (await (await answered).json()) as {
        item: { id: string; reused: boolean };
      };
      expect(body.item).toMatchObject({ id: copyId, reused: true });
    }
    // One file of that name in the library, and the Poster names it now.
    const listed = await page.request.get(
      `/admin/api/media?search=${encodeURIComponent(name)}`
    );
    const list = (await listed.json()) as {
      items?: { id: string }[];
      data?: { id: string }[];
    };
    expect((list.items ?? list.data ?? []).map(item => item.id)).toEqual([
      copyId,
    ]);
    await expect(page.getByText(`${name}.png`)).toBeVisible();
  });
});
