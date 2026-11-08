/**
 * A list read expands a related row exactly as reading that document by id
 * does, at every depth.
 *
 * The blog's case: a post's `byline` points at an author, whose `avatar` is an
 * upload. Read by id at depth 2 the post's `byline.avatar` is the media item;
 * read in a list at the same depth it stayed the bare media id, because the
 * list's batched expansion fetched the related rows and never expanded their
 * own uploads or relationships for the depth remaining.
 *
 * The read by id is the oracle: for each depth, each post a list returns is
 * compared with the same post read by id, through the Direct API and through
 * the REST routes, for a to-one relationship, a to-many, a polymorphic pair and
 * a relationship inside a repeater. Access is pinned the same way: a visitor
 * the author's collection refuses, or a field rule hiding the avatar, gets no
 * avatar from the list where the read by id gives none, beside a control that
 * shows the fixture holds one. Last, the list stays batched: ten posts cost the
 * reads one post costs.
 *
 * Each boot gets a database of its own (in-memory SQLite, or one created and
 * dropped on the configured PostgreSQL or MySQL server), with tables made by
 * the production schema sync, so no table name is shared with another file.
 * Run on every configured dialect.
 */
import { getTableName, isTable } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  defineCollection,
  relationship,
  repeater,
  text,
  upload,
} from "../../../config";
import { getDialectTables } from "../../../database/index";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { createDynamicHandlers } from "../../../routeHandler";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

type Doc = Record<string, unknown>;

const ORIGIN = "http://localhost";
const ORG_LOGO = "media-org";
/** Every relationship shape a post holds, the fields compared across reads. */
const RELATION_FIELDS = ["byline", "contributors", "featured", "credits"];

interface BootOptions {
  /** How many posts, each with authors and media of its own. */
  count: number;
  /** Whether the authors' read rule admits the caller. */
  authorsReadable?: boolean;
  /** Whether the field rule on the author's avatar admits the caller. */
  avatarReadable?: boolean;
  /** Run the boot's seeding, so a visitor reads by the Public role. */
  seedPublic?: boolean;
  /** Add one more post whose to-many `contributors` is never set. */
  bare?: boolean;
}

interface Fixture {
  t: TestNextly;
  /** One per post, in creation order. */
  posts: Array<{ id: string; author: string; credit: string }>;
  /** The post with no `contributors`, when `bare` asked for one. */
  bare?: string;
}

/** The media id an author's avatar points at. */
const avatarOf = (authorName: string): string => `media-${authorName}`;

async function boot(
  dialect: TestDialect,
  options: BootOptions
): Promise<Fixture> {
  const authorsReadable = options.authorsReadable ?? true;
  const avatarReadable = options.avatarReadable ?? true;
  current = await createTestNextly({
    ...(dialect === "sqlite" ? {} : { dialect }),
    seedPublic: options.seedPublic === true,
    collections: [
      defineCollection({
        slug: "orgs",
        access: { read: () => true },
        fields: [
          text({ name: "name" }),
          upload({ name: "logo", relationTo: "media" }),
        ],
      }),
      defineCollection({
        slug: "authors",
        access: { read: () => authorsReadable },
        fields: [
          text({ name: "name" }),
          upload({
            name: "avatar",
            relationTo: "media",
            access: { read: () => avatarReadable },
          }),
          relationship({ name: "org", relationTo: "orgs" }),
          // Never set: an unset to-many value on a related row.
          relationship({
            name: "mentors",
            relationTo: "authors",
            hasMany: true,
          }),
        ],
      }),
      defineCollection({
        slug: "posts",
        access: { read: () => true },
        fields: [
          text({ name: "title" }),
          relationship({ name: "byline", relationTo: "authors" }),
          relationship({
            name: "contributors",
            relationTo: "authors",
            hasMany: true,
          }),
          relationship({ name: "featured", relationTo: ["authors", "orgs"] }),
          repeater({
            name: "credits",
            fields: [
              text({ name: "role" }),
              relationship({ name: "person", relationTo: "authors" }),
              // Never set: an unset to-many value inside a repeater row.
              relationship({
                name: "also",
                relationTo: "authors",
                hasMany: true,
              }),
            ],
          }),
        ],
      }),
    ],
  });
  const t = current;

  const tables = getDialectTables();
  const db = t.adapter.getDrizzle() as unknown as {
    insert: (table: unknown) => { values: (row: unknown) => Promise<unknown> };
  };
  const insertMedia = (id: string) =>
    db.insert(tables.media).values({
      id,
      filename: `${id}.png`,
      originalFilename: `${id}.png`,
      mimeType: "image/png",
      size: 1,
      url: `/uploads/${id}.png`,
      uploadedAt: new Date(),
      updatedAt: new Date(),
    });
  const make = async (collection: string, data: Doc): Promise<string> => {
    const { item } = await t.nextly.create({
      collection,
      data,
      overrideAccess: true,
    });
    return String((item as Doc).id);
  };

  await insertMedia(ORG_LOGO);
  const org = await make("orgs", { name: "Acme", logo: ORG_LOGO });
  const posts: Fixture["posts"] = [];
  for (let i = 1; i <= options.count; i++) {
    // Each post has authors and media of its own, so a read made per row
    // would grow with the page rather than hide behind a shared id.
    const author = `author-${i}`;
    const credit = `credit-${i}`;
    await insertMedia(avatarOf(author));
    await insertMedia(avatarOf(credit));
    const authorId = await make("authors", {
      name: author,
      avatar: avatarOf(author),
      org,
    });
    const creditId = await make("authors", {
      name: credit,
      avatar: avatarOf(credit),
      org,
    });
    const id = await make("posts", {
      title: `Post ${i}`,
      byline: authorId,
      contributors: [authorId, creditId],
      featured: { relationTo: "authors", value: authorId },
      credits: [{ role: "editor", person: creditId }],
    });
    posts.push({ id, author: authorId, credit: creditId });
  }
  if (!options.bare || posts.length === 0) return { t, posts };
  // Kept out of `posts`: its reads differ in the one way pinned below.
  const bare = await make("posts", {
    title: "Bare post",
    byline: posts[0].author,
    featured: { relationTo: "authors", value: posts[0].author },
    credits: [{ role: "editor", person: posts[0].credit }],
  });
  return { t, posts, bare };
}

/** The relationship fields of a document, the part the reads must agree on. */
function relationsOf(doc: Doc | undefined): Doc {
  return Object.fromEntries(
    RELATION_FIELDS.map(field => [field, doc?.[field]])
  );
}

/** Every post, through the Direct API's list read. */
async function listed(
  t: TestNextly,
  depth: number,
  limit = 100
): Promise<Doc[]> {
  const { items } = await t.nextly.find({ collection: "posts", depth, limit });
  return items as unknown as Doc[];
}

/** One post, through the Direct API's read by id. */
async function byId(t: TestNextly, id: string, depth: number): Promise<Doc> {
  return (await t.nextly.findByID({
    collection: "posts",
    id,
    depth,
  })) as unknown as Doc;
}

/** A GET through the REST catch-all, as a visitor: no session, no key. */
async function restGet(
  path: string[],
  query: string
): Promise<{ status: number; body: unknown }> {
  const res = await createDynamicHandlers().GET(
    new Request(`${ORIGIN}/api/${path.join("/")}?${query}`, {
      headers: { origin: ORIGIN },
    }),
    { params: Promise.resolve({ params: path }) }
  );
  return { status: res.status, body: await res.json() };
}

/** Each post a visitor's REST list returns, beside their REST read of it. */
async function visitorReads(
  fx: Fixture,
  depth: number
): Promise<Array<{ listed: Doc | undefined; single: Doc }>> {
  const list = await restGet(
    ["collections", "posts", "entries"],
    `depth=${depth}&limit=100`
  );
  expect(list.status).toBe(200);
  const items = (list.body as { items: Doc[] }).items;
  return Promise.all(
    fx.posts.map(async post => {
      const single = await restGet(
        ["collections", "posts", "entries", post.id],
        `depth=${depth}`
      );
      expect(single.status).toBe(200);
      return {
        listed: items.find(item => item.id === post.id),
        single: single.body as Doc,
      };
    })
  );
}

/** Whether anything in `value` names the media item. */
const mentions = (value: unknown, mediaId: string): boolean =>
  JSON.stringify(value ?? null).includes(`${mediaId}.png`);

/**
 * The table of every statement read through the instance's Drizzle handles
 * while `work` runs, the handle each service takes included: the handle is
 * asked for per read, so each one it hands out is watched.
 */
async function tablesReadBy(
  t: TestNextly,
  work: () => Promise<unknown>
): Promise<string[]> {
  type Select = (...args: unknown[]) => {
    from: (...args: unknown[]) => unknown;
  };
  const tables: string[] = [];
  const handOut = t.adapter.getDrizzle.bind(t.adapter);
  const watched = new Map<object, object>();
  const spy = vi
    .spyOn(t.adapter, "getDrizzle")
    .mockImplementation(relations => {
      const db = handOut(relations) as object;
      const known = watched.get(db);
      if (known) return known;
      const proxy = new Proxy(db, {
        get(target, property) {
          const value = Reflect.get(target, property) as unknown;
          if (typeof value !== "function") return value;
          if (property !== "select") return value.bind(target);
          return (...args: unknown[]) => {
            const builder = (value as Select).apply(target, args);
            const from = builder.from.bind(builder);
            builder.from = (table: unknown, ...rest: unknown[]) => {
              if (isTable(table)) tables.push(getTableName(table));
              return from(table, ...rest);
            };
            return builder;
          };
        },
      });
      watched.set(db, proxy);
      return proxy;
    });
  try {
    await work();
  } finally {
    spy.mockRestore();
  }
  return tables;
}

describe.each(getConfiguredTestDialects())(
  "a list expands a related row as the read by id does (%s)",
  (dialect: TestDialect) => {
    it("gives every listed post what its read by id gives, at each depth", async () => {
      const fx = await boot(dialect, { count: 3 });
      for (const depth of [0, 1, 2, 3]) {
        const items = await listed(fx.t, depth);
        for (const post of fx.posts) {
          const item = items.find(entry => entry.id === post.id);
          expect(relationsOf(item)).toEqual(
            relationsOf(await byId(fx.t, post.id, depth))
          );
        }
      }
    });

    it("expands the author's own upload from depth 2, and stops where the depth stops", async () => {
      // The parity above, stated as the values it compares, so a parity reached
      // by both reads leaving everything as ids cannot pass for it.
      const fx = await boot(dialect, { count: 1 });
      const [post] = fx.posts;
      const avatar = avatarOf("author-1");
      const first = async (depth: number) =>
        (await listed(fx.t, depth)).find(item => item.id === post.id) ?? {};

      // Depth 0 gives the reference as stored.
      expect((await first(0)).byline).toBe(post.author);
      // Depth 1 populates the author, and leaves its own upload an id, as the
      // read by id does.
      const one = (await first(1)).byline as Doc;
      expect(one).toMatchObject({ name: "author-1" });
      expect(one.avatar).toBe(avatar);
      expect((await byId(fx.t, post.id, 1)).byline).toMatchObject({
        avatar,
      });

      // Depth 2 reaches the author's upload and relationship; the org's own
      // upload is one hop further and stays an id.
      const two = await first(2);
      const byline = two.byline as Doc;
      expect(byline.avatar).toMatchObject({ id: avatar });
      expect(byline.org).toMatchObject({ name: "Acme", logo: ORG_LOGO });
      // The read by id says the same.
      expect((await byId(fx.t, post.id, 2)).byline).toMatchObject({
        avatar: { id: avatar },
      });
      // Every other shape goes as deep: a to-many, a polymorphic pair, and a
      // relationship inside a repeater.
      const creditAvatar = avatarOf("credit-1");
      expect((two.contributors as Doc[])[1]).toMatchObject({
        avatar: { id: creditAvatar },
      });
      expect(two.featured).toMatchObject({
        relationTo: "authors",
        value: { avatar: { id: avatar } },
      });
      expect((two.credits as Doc[])[0]).toMatchObject({
        person: { avatar: { id: creditAvatar } },
      });

      // Depth 3 reaches the org's upload.
      expect(((await first(3)).byline as Doc).org).toMatchObject({
        logo: { id: ORG_LOGO },
      });
    });

    it("gives a visitor's REST list what their REST read by id gives", async () => {
      const fx = await boot(dialect, { count: 2, seedPublic: true });
      for (const depth of [0, 1, 2, 3]) {
        for (const { listed: item, single } of await visitorReads(fx, depth)) {
          expect(relationsOf(item)).toEqual(relationsOf(single));
        }
      }
      // And it is the expanded avatar both give: a visitor keeps media.
      const [{ listed: item }] = await visitorReads(fx, 2);
      expect((item?.byline as Doc | undefined)?.avatar).toMatchObject({
        id: avatarOf("author-1"),
      });
    });

    it("gives a post's own unset to-many value as an empty list in a list, and null by id", async () => {
      // The one known difference, kept on purpose: a list has always given a
      // document's own unset to-many field as `[]`, and list callers map over
      // it, so the list keeps that shape while the read by id gives the
      // stored null. Everything else about the post still matches.
      const fx = await boot(dialect, {
        count: 1,
        bare: true,
        seedPublic: true,
      });
      const bare = fx.bare ?? "";
      expect(bare).not.toBe("");
      const sameOtherwise = (item: Doc | undefined, single: Doc) =>
        expect({ ...relationsOf(item), contributors: null }).toEqual(
          relationsOf(single)
        );

      for (const depth of [1, 2, 3]) {
        // The Direct API.
        const item = (await listed(fx.t, depth)).find(i => i.id === bare);
        const single = await byId(fx.t, bare, depth);
        expect(item?.contributors).toEqual([]);
        expect(single.contributors).toBeNull();
        sameOtherwise(item, single);

        // The REST routes, as a visitor.
        const list = await restGet(
          ["collections", "posts", "entries"],
          `depth=${depth}&limit=100`
        );
        const restItem = (list.body as { items: Doc[] }).items.find(
          i => i.id === bare
        );
        const restSingle = (
          await restGet(
            ["collections", "posts", "entries", bare],
            `depth=${depth}`
          )
        ).body as Doc;
        expect(restItem?.contributors).toEqual([]);
        expect(restSingle.contributors).toBeNull();
        sameOtherwise(restItem, restSingle);
      }

      // Below the post itself an unset to-many value stays as stored in the
      // list too: on the related author, and inside the repeater row.
      const two = (await listed(fx.t, 2)).find(i => i.id === bare);
      expect((two?.byline as Doc | undefined)?.mentors).toBeNull();
      expect(((two?.credits as Doc[] | undefined) ?? [])[0]?.also).toBeNull();
      // At depth 0 nothing is populated, and the list gives it as stored.
      const zero = (await listed(fx.t, 0)).find(i => i.id === bare);
      expect(zero?.contributors).toBeNull();
    });

    it("gives a visitor no avatar through an author their read is refused", async () => {
      const fx = await boot(dialect, {
        count: 1,
        seedPublic: true,
        authorsReadable: false,
      });
      const [post] = fx.posts;
      const avatar = avatarOf("author-1");
      // The control: the fixture holds the avatar, and a trusted read reaches it.
      expect(
        mentions(
          (await listed(fx.t, 2)).find(i => i.id === post.id),
          avatar
        )
      ).toBe(true);
      // The visitor's direct read of the author is refused.
      const direct = await restGet(
        ["collections", "authors", "entries", post.author],
        "depth=1"
      );
      expect(direct.status).not.toBe(200);

      for (const depth of [1, 2, 3]) {
        const [{ listed: item, single }] = await visitorReads(fx, depth);
        expect(relationsOf(item)).toEqual(relationsOf(single));
        // Withheld as the read by id withholds it: the reference, unpopulated.
        expect(item?.byline).toBe(post.author);
        expect(mentions(item, avatar)).toBe(false);
      }
    });

    it("gives a visitor no avatar a field rule hides", async () => {
      const fx = await boot(dialect, {
        count: 1,
        seedPublic: true,
        avatarReadable: false,
      });
      const [post] = fx.posts;
      const avatar = avatarOf("author-1");
      // The control: the fixture holds the avatar, and a trusted read reaches it.
      expect(
        mentions(
          (await listed(fx.t, 2)).find(i => i.id === post.id),
          avatar
        )
      ).toBe(true);

      for (const depth of [1, 2, 3]) {
        const [{ listed: item, single }] = await visitorReads(fx, depth);
        expect(relationsOf(item)).toEqual(relationsOf(single));
        // The author itself is shown, so the rule, not the row, hides the avatar.
        expect(item?.byline).toMatchObject({ name: "author-1" });
        expect(item?.byline).not.toHaveProperty("avatar");
        expect(mentions(item, avatar)).toBe(false);
      }
    });

    it("reads as often for a page of ten posts as for one, at depth 3", async () => {
      const fx = await boot(dialect, { count: 10 });
      // The reads of the related rows and media, by table. The posts' own read
      // and any metadata read are left out: neither is the expansion's.
      const expansionReads = async (limit: number) => {
        const counts: Record<string, number> = {};
        const tables = await tablesReadBy(fx.t, () => listed(fx.t, 3, limit));
        for (const table of tables) {
          if (
            table === "media" ||
            table.includes("authors") ||
            table.includes("orgs")
          ) {
            counts[table] = (counts[table] ?? 0) + 1;
          }
        }
        return counts;
      };

      // Once first, so nothing either count makes is a first-read cost.
      await listed(fx.t, 3, 10);
      const one = await expansionReads(1);
      const ten = await expansionReads(10);
      expect(ten).toEqual(one);
      // The instrument sees the reads it counts: each target is read at all.
      const tablesSeen = Object.keys(ten);
      expect(tablesSeen).toContain("media");
      expect(tablesSeen.some(table => table.includes("authors"))).toBe(true);
      expect(tablesSeen.some(table => table.includes("orgs"))).toBe(true);
    });
  }
);
