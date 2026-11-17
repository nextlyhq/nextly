/**
 * A published page's content is in its first HTML, so a visitor or crawler
 * without JavaScript sees it, in a PRODUCTION build with Cache Components on.
 *
 * React can send part of a page in a `<div hidden id="S:…">` that only its
 * inline `$RC` script moves into place, and it does so for a finished
 * Suspense boundary that holds an eager image or follows more than a chunk of
 * the page. Without JavaScript that part stays hidden. So each case is asked
 * twice: as raw HTML, which must hold the content outside any hidden part, and
 * in a browser with JavaScript off, which must show it.
 *
 * - `/welcome`, the seed's page, built ahead of time;
 * - a page published after the build, holding an Image, on its first request
 *   and on a repeat request answered from the cache, through both of the
 *   playground's cached routes (`[...slug]`, `createPublicContentPage`, and
 *   `/site`, `createPublicBlocksPage`);
 * - a path no page holds, still answered not found. The playground's route
 *   answers a miss with the SEO plugin's `notFoundLogged`, which reads the
 *   request to log it, so that answer alone is made beneath a boundary, per
 *   request: a 200 marked `noindex` (`answeredNotFound`).
 *
 * Black box like the rest of `e2e/`: no product code is imported.
 *
 * @module tests/production/published-pages-without-javascript
 */
import { deflateSync } from "node:zlib";

import {
  expect,
  type APIRequestContext,
  type Browser,
  type Page,
} from "@playwright/test";

import { answeredNotFound } from "../support/not-found";
import { signIn } from "../support/production-sign-in";
import { test } from "../support/visible";

const API = "/admin/api";
/** Distinctive per run, so finding a text cannot be a coincidence. */
const STAMP = `${Date.now().toString(36)}-${Math.round(Math.random() * 1e6)}`;
const SLUG = `no-js-${STAMP}`;
const HEADING = `Seen without JavaScript ${STAMP}`;
const CAPTION = `The picture's words ${STAMP}`;
const ALT = `A picture for ${STAMP}`;

/** What React writes where it sends part of a page for its script to reveal. */
const HIDDEN_PART = /<div hidden id="S:\d+">/;

/** CRC-32 of a PNG chunk's type and data. */
function crc32(bytes: Buffer): number {
  let crc = ~0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return ~crc >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** A small gradient PNG, for the Image block to draw. */
function png(width = 320, height = 200): Buffer {
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 3);
    for (let x = 0; x < width; x += 1) {
      row[1 + x * 3] = (x * 255) / width;
      row[2 + x * 3] = (y * 255) / height;
      row[3 + x * 3] = 160;
    }
    rows.push(row);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Upload a picture and publish a page holding it, after the build. */
async function publishPage(api: APIRequestContext): Promise<void> {
  const uploaded = await api.post(`${API}/media`, {
    multipart: {
      file: { name: `${SLUG}.png`, mimeType: "image/png", buffer: png() },
    },
  });
  expect(
    uploaded.ok(),
    `uploading: ${uploaded.status()} ${await uploaded.text()}`
  ).toBe(true);
  const body = (await uploaded.json()) as { item?: { id?: unknown } };
  const mediaId = String(body.item?.id);
  const created = await api.post(`${API}/collections/pages/entries`, {
    data: {
      title: `No JavaScript ${STAMP}`,
      slug: SLUG,
      status: "published",
      content: {
        formatVersion: 1,
        kind: "page",
        nodes: [
          {
            id: "heading",
            type: "core/heading",
            version: 1,
            props: { text: HEADING, level: "h1" },
          },
          {
            id: "picture",
            type: "core/image",
            version: 1,
            props: { mediaId, alt: ALT },
          },
          {
            id: "words",
            type: "core/text",
            version: 1,
            props: { text: CAPTION },
          },
        ],
      },
    },
  });
  expect(
    created.ok(),
    `publishing: ${created.status()} ${await created.text()}`
  ).toBe(true);
}

/** A path as an anonymous visitor's plain request gets it. */
async function fetched(
  visitor: APIRequestContext,
  path: string
): Promise<{ status: number; cache: string; html: string }> {
  const response = await visitor.get(path, { headers: { cookie: "" } });
  return {
    status: response.status(),
    cache: response.headers()["x-nextjs-cache"] ?? "-",
    html: await response.text(),
  };
}

/** The HTML with every hidden part React sends for its script taken out. */
function withoutHiddenParts(html: string): string {
  return html.replace(/<div hidden id="S:\d+">[\s\S]*?<\/div>(?=<script)/g, "");
}

/** The HTML holds each text outside any part React reveals by script. */
function expectInline(html: string, texts: readonly string[]): void {
  expect(html, "a part of the page is sent hidden").not.toMatch(HIDDEN_PART);
  const shown = withoutHiddenParts(html);
  for (const text of texts) expect(shown).toContain(text);
}

/** A visitor's browser with JavaScript off, signed in to nothing. */
async function noScriptPage(
  browser: Browser,
  baseURL: string
): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({
    baseURL,
    javaScriptEnabled: false,
    storageState: { cookies: [], origins: [] },
  });
  const page = await context.newPage();
  return { page, close: () => context.close() };
}

test.describe("a published page without JavaScript", () => {
  test("the page built ahead of time shows its content", async ({
    browser,
    playwright,
  }, testInfo) => {
    const baseURL = testInfo.project.use.baseURL;
    if (baseURL === undefined) throw new Error("[e2e] No baseURL configured.");
    const visitor = await playwright.request.newContext({ baseURL });
    try {
      const welcome = await fetched(visitor, "/welcome");
      expect(welcome.status).toBe(200);
      // The seed's page: its hero heading and its hero image.
      expectInline(welcome.html, ["Build pages, not pipelines", "<img "]);

      const { page, close } = await noScriptPage(browser, baseURL);
      try {
        await page.goto("/welcome");
        await expect(
          page.getByRole("heading", {
            level: 1,
            name: "Build pages, not pipelines",
          })
        ).toBeVisible();
        await expect(page.locator("img").first()).toBeVisible();
      } finally {
        await close();
      }
    } finally {
      await visitor.dispose();
    }
  });

  test("a page published after the build shows its content and its image, first and from the cache", async ({
    browser,
    page,
    playwright,
  }, testInfo) => {
    const baseURL = testInfo.project.use.baseURL;
    if (baseURL === undefined) throw new Error("[e2e] No baseURL configured.");
    // Two paths, each of which may wait out the fill window for its cached
    // repeat (below).
    test.setTimeout(240_000);
    await publishPage(await signIn(page));
    const visitor = await playwright.request.newContext({ baseURL });
    try {
      for (const path of [`/${SLUG}`, `/site/${SLUG}`]) {
        const first = await fetched(visitor, path);
        expect(first.status, path).toBe(200);
        expectInline(first.html, [HEADING, CAPTION, `alt="${ALT}"`]);

        // Once the first render is stored, a repeat is answered from the
        // cache: the stored page holds its content inline too. Next.js stores
        // this path's page from a background render that read no cache entry
        // first, and the cache keeps such a render only once no write to its
        // tags falls within the 60 s fill window. The publish above is one, so
        // the wait covers that window.
        await expect
          .poll(async () => (await fetched(visitor, path)).cache, {
            timeout: 80_000,
          })
          .toBe("HIT");
        const repeat = await fetched(visitor, path);
        expect(repeat.cache).toBe("HIT");
        expectInline(repeat.html, [HEADING, CAPTION, `alt="${ALT}"`]);
      }

      const { page: noScript, close } = await noScriptPage(browser, baseURL);
      try {
        await noScript.goto(`/${SLUG}`);
        await expect(
          noScript.getByRole("heading", { level: 1, name: HEADING })
        ).toBeVisible();
        await expect(noScript.getByRole("img", { name: ALT })).toBeVisible();
        await expect(noScript.getByText(CAPTION)).toBeVisible();
      } finally {
        await close();
      }
    } finally {
      await visitor.dispose();
    }
  });

  test("a path no page holds is still answered not found, on every request", async ({
    playwright,
  }, testInfo) => {
    const baseURL = testInfo.project.use.baseURL;
    if (baseURL === undefined) throw new Error("[e2e] No baseURL configured.");
    const visitor = await playwright.request.newContext({ baseURL });
    try {
      for (const request of ["first", "second"]) {
        const missing = await fetched(visitor, `/nothing-here-${STAMP}`);
        expect(answeredNotFound(missing), `${request} request`).toBe(true);
        expect(missing.html, `${request} request`).not.toContain(HEADING);
      }
    } finally {
      await visitor.dispose();
    }
  });
});
