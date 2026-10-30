/**
 * The SEO card and its Needs attention line against a real instance, on every
 * configured dialect, each asked through the dashboard's own route as readers
 * with different rights.
 *
 * 🔴 Through the route, as a signed-in person, and that is the point of this
 * file. The card is answered by `runWidgetLoad`, which asks the route the
 * dashboard asks; the item by the same route's attention digest. So every gate
 * is core's, and the services each read through are the ones bound to that
 * person. What only this can show: that the declarations boot, that core
 * accepts the reads the scan makes, and that two readers with different read
 * access are given different answers, where a scan reading as the system would
 * give them the same one.
 *
 * Runs against whichever dialects the integration run configures; CI covers
 * SQLite, PostgreSQL and MySQL.
 */

// Set before the harness boots (env validation reads it once): the route signs
// each person in.
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import {
  createTestNextly,
  getConfiguredTestDialects,
  runWidgetLoad,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { defineCollection, text, type FieldConfig } from "nextly";
import { buildClaims, signAccessToken } from "nextly/auth";
import { createDynamicHandlers } from "nextly/runtime";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";

import { afterAll, afterEach, describe, expect, it } from "vitest";

import { defaultSeoFields } from "../fields";
import { seoPlugin } from "../plugin";
import { seoIssuesWidget } from "../widget-card";
import { ISSUE_SCAN_PAGE_SIZE } from "../widget-source";

// Prefixed for this file: on PostgreSQL and MySQL the tables outlive a run.
const PAGES = "seoi_pages";
const POSTS = "seoi_posts";
const COLLECTIONS = [PAGES, POSTS];
/** Each collection's Needs attention line, by the id the plugin gives it. */
const PAGES_LINE = "seo/issues-seoi-pages";
const POSTS_LINE = "seo/issues-seoi-posts";
/** A collection whose `afterRead` hook rewrites the id of every row it answers. */
const HOOKED = "seoi_hooked";

/** The card, as the plugin booted below declares it. */
const card = theCard();

function theCard(): NonNullable<ReturnType<typeof seoIssuesWidget>> {
  const declared = seoIssuesWidget(COLLECTIONS, defaultSeoFields());
  if (declared === undefined) throw new Error("the SEO card was withheld");
  return declared;
}

/** One item of the attention digest, as the route answers it. */
interface DigestItem {
  id: string;
  label: string;
  count: number;
  atLeast?: true;
  link: string;
  failed?: true;
}

/**
 * A 1x1 PNG, the smallest file the media library accepts as an image.
 */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

/**
 * Where an upload lands, and the ignore file local storage writes beside it on
 * its first upload: both under the package this suite runs in. Each is taken
 * down after the suite when the suite was what made it.
 */
const UPLOADS = path.resolve("public");
const IGNORE = path.resolve(".gitignore");
const madeHere = { uploads: !existsSync(UPLOADS), ignore: !existsSync(IGNORE) };

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

afterAll(() => {
  if (madeHere.uploads) rmSync(UPLOADS, { recursive: true, force: true });
  if (madeHere.ignore) rmSync(IGNORE, { force: true });
});

describe.each(getConfiguredTestDialects())(
  "the SEO card and its Needs attention line (%s)",
  (dialect: TestDialect) => {
    /**
     * Readers by what they may read: everything (the owner, a super-admin),
     * both collections, pages alone, posts alone, neither. None but the owner
     * may read media.
     */
    interface Readers {
      owner: string;
      both: string;
      pagesOnly: string;
      postsOnly: string;
      neither: string;
    }

    /** An instance with the plugin on both collections, its `seo` fields `fields` when given. */
    async function boot(
      fields?: FieldConfig[]
    ): Promise<{ t: TestNextly; readers: Readers }> {
      const t = await createTestNextly({
        dialect,
        collections: COLLECTIONS.map(slug =>
          defineCollection({ slug, fields: [text({ name: "title" })] })
        ),
        plugins: [
          seoPlugin({
            collections: COLLECTIONS,
            sitemap: false,
            ...(fields === undefined ? {} : { fields }),
          }),
        ],
      });
      current = t;
      // The install's first account holds super-admin, so an owner is made
      // first, and each reader after it holds only what their role grants.
      const owner = await userWith(t, "owner", []);
      return {
        t,
        readers: {
          owner,
          both: await userWith(t, "both", COLLECTIONS),
          pagesOnly: await userWith(t, "pages-only", [PAGES]),
          postsOnly: await userWith(t, "posts-only", [POSTS]),
          neither: await userWith(t, "neither", []),
        },
      };
    }

    /** The id of a new account whose one role may read `collections`, or holding no role. */
    async function userWith(
      t: TestNextly,
      name: string,
      collections: readonly string[]
    ): Promise<string> {
      const roles =
        collections.length === 0
          ? []
          : [String((await roleReading(t, name, collections)).item.id)];
      const created = await t.nextly.users.create({
        email: `${name}@example.com`,
        password: "Password123!",
        data: { name, isActive: true, roles },
      });
      return String(created.item.id);
    }

    /** A role holding `read-<slug>` for each of `collections`, as stored. */
    async function roleReading(
      t: TestNextly,
      name: string,
      collections: readonly string[]
    ) {
      const permissions = await t.nextly.permissions.find({ limit: 1000 });
      const ids: string[] = [];
      for (const slug of collections) {
        const found =
          permissions.items.find(p => p.slug === `read-${slug}`) ??
          (
            await t.nextly.permissions.create({
              data: {
                action: "read",
                resource: slug,
                name: `Read ${slug}`,
                slug: `read-${slug}`,
              },
            })
          ).item;
        ids.push(String(found.id));
      }
      return t.nextly.roles.create({
        data: {
          name: `Reads ${name}`,
          slug: `reads-${name}`,
          permissionIds: ids,
        },
      });
    }

    async function write(
      t: TestNextly,
      collection: string,
      seo?: Record<string, unknown>
    ): Promise<void> {
      await t.nextly.create({
        collection,
        data: { title: "Entry", ...(seo === undefined ? {} : { seo }) },
      });
    }

    /**
     * The attention digest the dashboard's route answers `userId`: the same
     * request the Needs attention card makes, signed in as that person the way
     * `runWidgetLoad` signs them in.
     */
    async function digestFor(
      t: TestNextly,
      userId: string
    ): Promise<DigestItem[]> {
      const person = await t.nextly.users.findByID({ id: userId });
      if (person === null) throw new Error(`no user ${userId}`);
      const token = await signAccessToken(
        buildClaims({
          userId: person.id,
          email: person.email,
          name: person.name ?? "",
          image: null,
          roleIds: [],
          sessionEpoch: 0,
        }),
        process.env.NEXTLY_SECRET ?? ""
      );
      const res = await createDynamicHandlers().POST(
        new Request("http://localhost/api/dashboard/query", {
          method: "POST",
          headers: {
            cookie: `nextly_session=${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            queries: [{ source: "system:attention", op: "list", limit: 50 }],
          }),
        }),
        { params: Promise.resolve({ params: ["dashboard", "query"] }) }
      );
      if (!res.ok) throw new Error(`digest: ${res.status} ${await res.text()}`);
      const { results } = (await res.json()) as {
        results: [{ ok: boolean; result?: { items: DigestItem[] } }];
      };
      if (!results[0].ok || results[0].result === undefined) {
        throw new Error(`digest slot: ${JSON.stringify(results[0])}`);
      }
      return results[0].result.items;
    }

    /** The SEO line of `userId`'s digest, or `undefined` when they are shown none. */
    /** The SEO lines of `userId`'s digest, in the digest's order. */
    async function seoLinesFor(
      t: TestNextly,
      userId: string
    ): Promise<DigestItem[]> {
      return (await digestFor(t, userId)).filter(item =>
        item.id.startsWith("seo/issues-")
      );
    }

    it("answers the card for a reader of every collection, and to no one else", async () => {
      const { t, readers } = await boot();
      // Pages: one bare row, four gaps. Posts: one titled row, three gaps.
      await write(t, PAGES);
      await write(t, POSTS, { metaTitle: "Titled" });

      expect(
        await runWidgetLoad(t, card, { as: { id: readers.both } })
      ).toEqual({
        state: "ready",
        data: {
          buckets: [
            { value: "Missing meta title", count: 1 },
            { value: "Missing canonical URL", count: 2 },
            { value: "Missing meta description", count: 2 },
            { value: "Missing social image", count: 2 },
          ],
        },
      });
      // 🔴 The must-differ half. A card reading as the system would hand a
      // reader of pages alone the same chart, describing posts they may not
      // read; core refuses them the card before its `load` runs.
      expect(
        await runWidgetLoad(t, card, { as: { id: readers.pagesOnly } })
      ).toEqual({ state: "unavailable" });
      expect(
        await runWidgetLoad(t, card, { as: { id: readers.neither } })
      ).toEqual({ state: "unavailable" });
    });

    it("reads every row past what one read answers", async () => {
      // 🔴 Core answers a widget read with fifty rows at most. A scan whose page
      // asked for more, or that stopped at the first page core shortened, counts
      // fifty here and says nothing of the rest.
      const { t, readers } = await boot();
      const rows = ISSUE_SCAN_PAGE_SIZE * 2 + 5;
      for (let i = 0; i < rows; i++) {
        await write(t, PAGES, { metaDescription: "D", canonical: "C" });
      }

      expect(
        await runWidgetLoad(t, card, { as: { id: readers.both } })
      ).toEqual({
        state: "ready",
        data: {
          buckets: [
            { value: "Missing meta title", count: rows },
            { value: "Missing social image", count: rows },
          ],
        },
      });
    });

    it("draws the card empty, and adds no line, when there is nothing to fix", async () => {
      // Every text field filled in. The social image is an upload, which a
      // widget's read answers populated, so the fields here leave it out
      // rather than hand it a file this instance does not hold.
      const { t, readers } = await boot(
        defaultSeoFields().filter(
          field => !("name" in field) || field.name !== "ogImage"
        )
      );
      await write(t, PAGES, {
        metaTitle: "T",
        metaDescription: "D",
        canonical: "C",
      });

      // No bars. The bars view's own rule judges that answer empty where the
      // frame draws it, with the card's declared message; the browser spec
      // draws it. The route's own verdict is the declaration's `isEmpty`
      // alone, which a core view need not give, so it is not asserted here.
      expect(
        await runWidgetLoad(t, card, { as: { id: readers.both } })
      ).toMatchObject({ data: { buckets: [] } });
      // A zero adds no line: the digest leaves out what needs nobody.
      expect(await seoLinesFor(t, readers.both)).toEqual([]);
    });

    it("counts a social image by the id it stores, the same for a reader who may not read media", async () => {
      // 🔴 Read with its links expanded, a page's image comes back null to a
      // reader without read-media, and the page with an image would count as
      // missing one: 2 here for that reader. Read as stored ids, both readers
      // count the one page that has none.
      const { t, readers } = await boot();
      const image = await t.nextly.media.upload({
        file: {
          data: PNG,
          name: "seo-social.png",
          mimetype: "image/png",
          size: PNG.length,
        },
      });
      const filled = { metaTitle: "T", metaDescription: "D", canonical: "C" };
      await write(t, PAGES, { ...filled, ogImage: String(image.id) });
      await write(t, PAGES, filled);

      for (const id of [readers.owner, readers.both]) {
        expect(await runWidgetLoad(t, card, { as: { id } })).toEqual({
          state: "ready",
          data: { buckets: [{ value: "Missing social image", count: 1 }] },
        });
        expect(await seoLinesFor(t, id)).toEqual([
          expect.objectContaining({ id: PAGES_LINE, count: 1 }),
        ]);
      }
    });

    it("gives each reader a line for each collection they read, linked to that collection", async () => {
      const { t, readers } = await boot();
      // Pages: one bare row, four gaps. Posts: one titled row, three gaps.
      await write(t, PAGES);
      await write(t, POSTS, { metaTitle: "Titled" });
      const lines = async (id: string) =>
        (await seoLinesFor(t, id))
          .map(({ id: line, count, link }) => ({ line, count, link }))
          .sort((a, b) => a.line.localeCompare(b.line));

      expect(await lines(readers.both)).toEqual([
        { line: PAGES_LINE, count: 4, link: `collections/${PAGES}` },
        { line: POSTS_LINE, count: 3, link: `collections/${POSTS}` },
      ]);
      // 🔴 A reader of the second collection alone is shown its line alone,
      // linked to the list they may open, never to the first's.
      expect(await lines(readers.postsOnly)).toEqual([
        { line: POSTS_LINE, count: 3, link: `collections/${POSTS}` },
      ]);
      expect(await lines(readers.pagesOnly)).toEqual([
        { line: PAGES_LINE, count: 4, link: `collections/${PAGES}` },
      ]);
      // A reader of neither is shown no line at all, not even its label.
      expect(await lines(readers.neither)).toEqual([]);
    });

    it("says its counts are floors, never a wrong whole number, when a hook rewrites the ids it answers", async () => {
      // 🔴 The scan continues from the id a row came back with. Rewritten to
      // one past every stored id, the next page matches nothing: read as the
      // end, the first page would be reported as the whole collection.
      const hooked = defineCollection({
        slug: HOOKED,
        fields: [text({ name: "title" })],
        hooks: {
          // A list read hands the hook every row at once, and what it answers
          // replaces them; one row's read hands it that row.
          afterRead: [
            ({ data }: { data?: unknown }) => {
              const rewrite = (row: Record<string, unknown>) => ({
                ...row,
                id: `z-${String(row.id)}`,
              });
              if (Array.isArray(data)) return data.map(rewrite);
              return data === undefined || data === null
                ? data
                : rewrite(data as Record<string, unknown>);
            },
          ],
        },
      });
      const t = await createTestNextly({
        dialect,
        collections: [hooked],
        plugins: [seoPlugin({ collections: [HOOKED], sitemap: false })],
      });
      current = t;
      const owner = await userWith(t, "owner", []);
      const rows = ISSUE_SCAN_PAGE_SIZE * 2 + 5;
      for (let i = 0; i < rows; i++) {
        await write(t, HOOKED, { metaDescription: "D", canonical: "C" });
      }

      const answer = await runWidgetLoad(t, card, { as: { id: owner } });

      expect(answer).toMatchObject({ state: "ready", data: { atLeast: true } });
      const { buckets } = (
        answer as { data: { buckets: { value: string; count: number }[] } }
      ).data;
      expect(buckets.map(bucket => bucket.value)).toEqual([
        "Missing meta title",
        "Missing social image",
      ]);
      for (const bucket of buckets)
        expect(bucket.count).toBeLessThanOrEqual(rows);
    });
  }
);
