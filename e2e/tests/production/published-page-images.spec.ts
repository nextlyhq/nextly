/**
 * A published page's images arrive at about the size they are drawn.
 *
 * The page's first section has a background image and holds an Image block,
 * both from one large upload. A phone and a desktop each open the page, and
 * the test reads every image the browser fetched: the copies the site's media
 * keeps are drawn in place of the upload, no copy is wider than twice the
 * slot, and the background copy the head preloads is the one the stylesheet
 * draws, so it is fetched once.
 *
 * @module tests/published-page-images.spec
 */
import { deflateSync } from "node:zlib";

import { expect, type Page, type Response } from "@playwright/test";

import { signIn } from "../support/production-sign-in";
import { test } from "../support/visible";

const ENTRIES = "/admin/api/collections/block-pages/entries";
const SLUG = "sized-images";

/** The upload: wide enough that every device draws a copy narrower than it. */
const UPLOAD = { width: 2400, height: 1600 };

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

/** A photo-like PNG: soft gradients broken into 8 px blocks of colour. */
function photoPng({ width, height }: typeof UPLOAD): Buffer {
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 3);
    for (let x = 0; x < width; x += 1) {
      const block = ((x >> 3) * 31 + (y >> 3) * 17) % 64;
      row[1 + x * 3] = (x * 255) / width + block;
      row[2 + x * 3] = (y * 255) / height + block;
      row[3 + x * 3] = 128 + block;
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

/** Upload the photo and publish the page; returns its path and the upload. */
async function seed(
  page: Page
): Promise<{ path: string; original: string; originalBytes: number }> {
  await signIn(page);
  const cookies = await page.context().cookies();
  const cookie = cookies.map(c => `${c.name}=${c.value}`).join("; ");
  const run = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
  const png = photoPng(UPLOAD);
  const uploaded = await page.request.post("/admin/api/media", {
    headers: { cookie },
    multipart: {
      file: { name: `sized-${run}.png`, mimeType: "image/png", buffer: png },
    },
  });
  expect(
    uploaded.ok(),
    `uploading: ${uploaded.status()} ${await uploaded.text()}`
  ).toBe(true);
  const body = (await uploaded.json()) as {
    item?: { id: string; url: string };
    id?: string;
    url?: string;
  };
  const mediaId = String(body.item?.id ?? body.id);
  const original = String(body.item?.url ?? body.url);
  const slug = `${SLUG}-${run}`;
  const created = await page.request.post(ENTRIES, {
    headers: { cookie, "content-type": "application/json" },
    data: {
      title: "Sized images",
      slug,
      status: "published",
      content: {
        formatVersion: 1,
        kind: "page",
        nodes: [
          {
            id: "hero",
            type: "core/section",
            version: 1,
            props: { as: "section" },
            styles: {
              base: {
                base: {
                  minHeight: "480px",
                  // The media route's address, which names the item, so the
                  // site's copies of it can be found.
                  background: {
                    url: `/api/media/${mediaId}/raw`,
                    size: "cover",
                  },
                },
              },
            },
            slots: {
              children: [
                {
                  id: "picture",
                  type: "core/image",
                  version: 1,
                  props: { mediaId, alt: "A view" },
                },
              ],
            },
          },
        ],
      },
    },
  });
  expect(
    created.ok(),
    `seeding: ${created.status()} ${await created.text()}`
  ).toBe(true);
  return { path: `/blocks/${slug}`, original, originalBytes: png.length };
}

/** Every image the page fetched, with its bytes, once the page is drawn. */
async function imagesFetched(
  page: Page,
  path: string
): Promise<{ url: string; bytes: number }[]> {
  const fetched: Promise<{ url: string; bytes: number }>[] = [];
  page.on("response", (response: Response) => {
    if (response.request().resourceType() !== "image") return;
    fetched.push(
      response
        .body()
        .then(body => ({ url: response.url(), bytes: body.length }))
        .catch(() => ({ url: response.url(), bytes: 0 }))
    );
  });
  const response = await page.goto(path);
  expect(response?.status()).toBe(200);
  await page.waitForLoadState("networkidle");
  await expect
    .poll(() =>
      page.locator("img").evaluate(img => (img as HTMLImageElement).complete)
    )
    .toBe(true);
  return Promise.all(fetched);
}

const DEVICES = [
  { name: "phone", viewport: { width: 390, height: 844 }, scale: 2, slot: 640 },
  {
    name: "desktop",
    viewport: { width: 1440, height: 900 },
    scale: 1,
    slot: 1920,
  },
];

test("a phone and a desktop draw copies, never the upload", async ({
  page,
  browser,
}, testInfo) => {
  const { path, original, originalBytes } = await seed(page);
  for (const device of DEVICES) {
    const context = await browser.newContext({
      viewport: device.viewport,
      deviceScaleFactor: device.scale,
    });
    const visitor = await context.newPage();
    try {
      const fetched = await imagesFetched(visitor, path);
      // The preloads the server's HTML names in its head, which the browser
      // finds before any stylesheet or script.
      const served = await (await visitor.request.get(path)).text();
      const head = served.slice(0, served.indexOf("</head>"));
      const preloads = [
        ...head.matchAll(/<link\b[^>]*rel="preload"[^>]*>/g),
      ].flatMap(([tag]) => {
        const attr = (name: string) =>
          new RegExp(`\\s${name}="([^"]*)"`)
            .exec(tag)?.[1]
            ?.replaceAll("&amp;", "&")
            .replaceAll("&lt;", "<")
            .replaceAll("&gt;", ">");
        const href = attr("href");
        return attr("as") === "image" && href !== undefined
          ? [
              {
                href: new URL(href, visitor.url()).href,
                media: attr("media") ?? "",
              },
            ]
          : [];
      });
      const total = fetched.reduce((sum, image) => sum + image.bytes, 0);
      const report = `${device.name}: ${total} bytes in ${fetched.length} images (upload ${originalBytes}): ${fetched.map(image => `${new URL(image.url).pathname} ${image.bytes}`).join(", ")}`;
      console.log(`IMAGE BYTES ${report}`);
      testInfo.annotations.push({ type: "image bytes", description: report });

      const urls = fetched.map(image => image.url);
      // The upload itself is never fetched, by either of its addresses.
      expect(urls).not.toContain(new URL(original, visitor.url()).href);
      expect(urls.some(url => url.includes("/raw"))).toBe(false);
      // Each image is fetched once: the background copy the head preloads is
      // the one the stylesheet then draws.
      expect(new Set(urls).size).toBe(urls.length);
      const preloaded = await visitor.evaluate(
        links =>
          links.filter(
            link => link.media === "" || matchMedia(link.media).matches
          ),
        preloads
      );
      expect(preloaded).toHaveLength(1);
      expect(urls).toContain(preloaded[0]?.href);
      // The Image block's copy is no wider than twice its slot.
      const drawn = await visitor
        .locator("img")
        .evaluate(img => (img as HTMLImageElement).naturalWidth);
      expect(drawn).toBeGreaterThan(0);
      expect(drawn).toBeLessThanOrEqual(device.slot * 2);
      expect(drawn).toBeLessThan(UPLOAD.width);
      // Both drawn from copies, together still smaller than the one upload.
      expect(total).toBeLessThan(originalBytes);
    } finally {
      await context.close();
    }
  }
});
