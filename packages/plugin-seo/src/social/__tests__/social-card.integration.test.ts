/**
 * A page's social card, as the route helpers serve it, and the action that
 * makes a share image, through Nextly's own request handler, on every
 * configured dialect.
 *
 * The card states the site's name, the page's language, and the image the
 * page's cover holds at its full address, with its size and alt text, though
 * the media library stores it with a path from the root.
 *
 * The action makes a 1200 × 630 JPEG under 600 KB from an undersized picture,
 * adds it to the media library beside the picture, and leaves the picture as
 * it was; a person who may not add to the library is refused. The picture is
 * read from where the site serves its uploads, which a test has no server
 * for, so that one read is answered from the stored file itself.
 */
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { readFile, rmdir } from "node:fs/promises";
import path from "node:path";

import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { ServiceContainer } from "nextly";
import { buildClaims, signAccessToken } from "nextly/auth";
import { defineCollection, text, upload } from "nextly/config";
import {
  createDynamicHandlers,
  createPublicContentRoute,
  type ContentEntry,
} from "nextly/runtime";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";

import { seoPlugin } from "../../plugin";

const ORIGIN = "http://localhost";
const CSRF = "c".repeat(64);
const PLUGIN = "@nextlyhq/plugin-seo";

/**
 * Where the media library keeps uploads in a test, as it serves them: the
 * `public` folder below the instance's base path, the default local storage.
 */
function uploadsDir(): string {
  if (current === undefined) throw new Error("no instance is running");
  return path.join(current.basePath, "public");
}

let current: TestNextly | undefined;
/** The media items a test added, deleted with every file made for them. */
const stored: string[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  for (const id of stored.splice(0)) {
    await current?.nextly.media.delete({ id });
  }
  const uploads = current === undefined ? undefined : uploadsDir();
  await current?.destroy();
  current = undefined;
  if (uploads === undefined) return;
  // The folders the uploads were put in, where nothing else is left in them.
  const month = new Date();
  for (const folder of [
    `uploads/${String(month.getFullYear())}/${String(month.getMonth() + 1).padStart(2, "0")}`,
    `uploads/${String(month.getFullYear())}`,
    "uploads",
    "",
  ]) {
    await rmdir(path.join(uploads, folder)).catch(() => undefined);
  }
});

async function boot(dialect: TestDialect) {
  current = await createTestNextly({
    dialect,
    seedPublic: true,
    plugins: [
      seoPlugin({
        collections: ["posts"],
        baseUrl: "https://example.com",
        socialCard: { siteName: "Acme", language: "en-GB" },
      }),
    ],
    collections: [
      defineCollection({
        slug: "posts",
        status: true,
        access: { read: () => true },
        fields: [
          text({ name: "title" }),
          text({ name: "slug" }),
          upload({ name: "cover", relationTo: "media" }),
        ],
        publicAddress: "/blog/{slug}",
      }),
    ],
  });
  // The site's first person is its owner, who may do anything, so the
  // people below are judged by their roles alone.
  await person(current);
  return current;
}

/** A person with no role yet. */
async function person(t: TestNextly): Promise<string> {
  const created = await t.nextly.users.create({
    email: `person-${String(Date.now())}-${String(Math.random()).slice(2)}@example.com`,
    password: "Password123!",
    data: { name: "Person", isActive: true },
  });
  return created.item.id;
}

/** An 800 × 600 picture, as the media library stores it. */
async function undersized(t: TestNextly) {
  const data = await sharp({
    create: {
      width: 800,
      height: 600,
      channels: 3,
      background: { r: 15, g: 61, b: 42 },
    },
  })
    .png()
    .toBuffer();
  const image = await t.nextly.media.upload({
    file: {
      data,
      name: "harbour.png",
      mimetype: "image/png",
      size: data.length,
    },
    altText: "A harbour at dawn",
  });
  stored.push(image.id);
  return image;
}

/** The head of the post at `slug`, as a public route serves it. */
async function headOf(t: TestNextly, slug: string) {
  const route = createPublicContentRoute({
    collections: ["posts"],
    nextly: t.nextly,
    render: (entry: ContentEntry) => entry.title,
  });
  return route.generateMetadata({ params: { slug: [slug] } });
}

/** A signed-in person holding exactly `slugs`, as a session cookie. */
async function holding(t: TestNextly, slugs: readonly string[]) {
  const userId = await person(t);
  const permissions = await t.nextly.permissions.find({ limit: 500 });
  const ids = slugs.map(slug => {
    const found = permissions.items.find(item => item.slug === slug);
    if (found === undefined) throw new Error(`${slug} is not seeded`);
    return found.id;
  });
  const role = `role-${String(Date.now())}-${String(Math.random()).slice(2)}`;
  const made = await t.nextly.roles.create({
    data: { name: role, slug: role, permissionIds: ids },
  });
  await new ServiceContainer(t.adapter).userRoles.assignRoleToUser(
    userId,
    made.item.id
  );
  const user = await t.nextly.users.findByID({ id: userId });
  const token = await signAccessToken(
    buildClaims({
      userId,
      email: user?.email ?? "",
      name: user?.name ?? "",
      image: null,
      roleIds: [],
      sessionEpoch: 0,
    }),
    process.env.NEXTLY_SECRET ?? ""
  );
  return `nextly_session=${token}`;
}

/** Asks the plugin to make a share image from `media`, as `cookie`. */
async function makeShareImage(cookie: string, media: string) {
  const route = ["share-image"];
  const response = await createDynamicHandlers().POST(
    new Request(`${ORIGIN}/api/plugins/${PLUGIN}/${route.join("/")}`, {
      method: "POST",
      headers: {
        cookie: `${cookie}; nextly_csrf=${CSRF}`,
        "x-csrf-token": CSRF,
        origin: ORIGIN,
        "content-type": "application/json",
      },
      body: JSON.stringify({ media }),
    }),
    {
      params: Promise.resolve({
        params: ["plugins", ...PLUGIN.split("/"), ...route],
      }),
    }
  );
  const body = (await response.json()) as Record<string, unknown>;
  // Deleted after the test whatever it asserts, with its files.
  const made = body.item as { id?: unknown } | undefined;
  if (typeof made?.id === "string") stored.push(made.id);
  return { status: response.status, body };
}

/**
 * The site serving its uploads: a read of a path the media library stored
 * under `https://example.com` is answered from the stored file. Every other
 * address is refused, so a read from anywhere else fails the test.
 */
function serveUploads(status = 200) {
  const reads: string[] = [];
  vi.stubGlobal("fetch", async (input: URL | string) => {
    const address = new URL(String(input));
    reads.push(address.href);
    if (address.origin !== "https://example.com") {
      return new Response(null, { status: 404 });
    }
    if (status !== 200) return new Response(null, { status });
    return new Response(
      await readFile(
        path.join(uploadsDir(), decodeURIComponent(address.pathname))
      )
    );
  });
  return reads;
}

describe.each(getConfiguredTestDialects())("social cards (%s)", dialect => {
  it("states the site's name, the language and the cover at its full address, with its size and alt text", async () => {
    const t = await boot(dialect);
    const cover = await undersized(t);
    expect(cover.url).toMatch(/^\/uploads\//);
    await t.nextly.create({
      collection: "posts",
      data: {
        title: "Harbour",
        slug: "harbour",
        cover: cover.id,
        status: "published",
      },
    });

    const head = await headOf(t, "harbour");

    const image = {
      url: `https://example.com${cover.url}`,
      width: 800,
      height: 600,
      alt: "A harbour at dawn",
    };
    expect(head.openGraph).toMatchObject({
      siteName: "Acme",
      locale: "en_GB",
      images: [image],
    });
    expect(head.twitter).toMatchObject({
      card: "summary_large_image",
      images: [{ url: image.url, alt: image.alt }],
    });
  });

  it("makes a 1200 × 630 JPEG under 600 KB from an undersized picture, leaving the picture as it was", async () => {
    const t = await boot(dialect);
    const picture = await undersized(t);
    const reads = serveUploads();
    const editor = await holding(t, ["create-media", "read-media"]);

    const made = await makeShareImage(editor, picture.id);

    expect(made.status).toBe(201);
    expect(reads).toEqual([`https://example.com${picture.url}`]);
    // The mutation envelope: what was done, and the item it made.
    expect(made.body).toMatchObject({
      message: expect.any(String),
      item: {
        filename: expect.stringMatching(/\.jpg$/),
        mimeType: "image/jpeg",
        width: 1200,
        height: 630,
        altText: "A harbour at dawn",
      },
    });
    const item = made.body.item as { id: string };

    // The file the library holds is the card: read back from where it was
    // stored, not from what the action said of it.
    const copy = await t.nextly.media.findByID({ id: item.id });
    const bytes = await readFile(path.join(uploadsDir(), copy.url));
    const file = await sharp(bytes).metadata();
    expect(file.format).toBe("jpeg");
    expect([file.width, file.height]).toEqual([1200, 630]);
    expect(bytes.length).toBeLessThan(600_000);

    const unchanged = await t.nextly.media.findByID({ id: picture.id });
    expect(unchanged).toMatchObject({
      url: picture.url,
      width: 800,
      height: 600,
      mimeType: "image/png",
    });
  });

  it("refuses a picture its storage will not serve publicly, which no network could load", async () => {
    const t = await boot(dialect);
    const picture = await undersized(t);
    serveUploads(403);
    const editor = await holding(t, ["create-media", "read-media"]);

    const made = await makeShareImage(editor, picture.id);

    expect(made.status).toBe(400);
    expect(JSON.stringify(made.body)).toMatch(/not public/);
  });

  it("refuses a person who may read the library but not add to it", async () => {
    const t = await boot(dialect);
    const picture = await undersized(t);
    const reads = serveUploads();
    const reader = await holding(t, ["read-media"]);

    const made = await makeShareImage(reader, picture.id);

    expect(made.status).toBe(403);
    expect(reads).toEqual([]);
  });
});
