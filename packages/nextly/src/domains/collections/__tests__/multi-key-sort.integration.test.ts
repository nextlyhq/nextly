/**
 * A collection read sorts by several keys in turn, breaks every tie left by the
 * id, puts empty values last in both directions, and starts at any offset, the
 * same on every dialect.
 *
 * The expected order is computed here in JavaScript from the rows as created,
 * independently of the database, so one expectation holds every dialect to the
 * same answer. The values are numbers and same-case text: how mixed-case text
 * compares follows each database's collation, which is a known limit.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  defineCollection,
  group,
  number,
  password,
  text,
} from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";

const SLUG = "mks_items";
const LOCALIZED = "mks_titles";
const RULED = "mks_ruled";
const HOOKED = "mks_hooked";
const SECRETS = "mks_secrets";

/** Every read hook call on the hooked collection, by phase. */
const hookCalls: string[] = [];

interface Row {
  id: string;
  grp: number;
  rank: number | null;
}

/**
 * 20 rows over two groups and three ranks (one of them empty), so about three
 * rows tie on both keys and only the id can order them. Ids are random, so
 * the order rows were written in, which a database left to break ties itself
 * tends to return, is not their id order; `beforeAll` checks that it is not.
 */
const SEED = Array.from({ length: 20 }, (_, i) => ({
  grp: i % 2,
  rank: i % 3 === 0 ? null : i % 3,
}));

/** Ascending compare that puts null after every value. */
function nullsLast(a: number | null, b: number | null, desc: boolean): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return desc ? b - a : a - b;
}

const byId = (a: Row, b: Row): number =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

describe.each(getConfiguredTestDialects())(
  "a collection read sorted by several keys (%s)",
  dialect => {
    let t: TestNextly;
    let rows: Row[];
    const ids = <T extends { id?: unknown }>(items: readonly T[]): string[] =>
      items.map(item => String(item.id));

    beforeAll(async () => {
      t = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        seedPublic: true,
        localization: { locales: ["en", "fr"], defaultLocale: "en" },
        collections: [
          defineCollection({
            slug: SLUG,
            fields: [number({ name: "grp" }), number({ name: "rank" })],
          }),
          defineCollection({
            slug: LOCALIZED,
            localized: true,
            fields: [text({ name: "title", localized: true })],
          }),
          defineCollection({
            slug: SECRETS,
            access: { read: () => true },
            fields: [
              text({ name: "title" }),
              password({ name: "pin" }),
              group({ name: "account", fields: [password({ name: "code" })] }),
            ],
          }),
          defineCollection({
            slug: HOOKED,
            fields: [number({ name: "grp" })],
            hooks: {
              beforeOperation: [
                ({ operation, args }) => {
                  if (operation === "read") hookCalls.push("beforeOperation");
                  return args;
                },
              ],
              beforeRead: [
                () => {
                  hookCalls.push("beforeRead");
                },
              ],
            },
          }),
          defineCollection({
            slug: RULED,
            access: { read: () => true },
            fields: [
              text({ name: "title" }),
              text({ name: "secret", access: { read: () => false } }),
            ],
          }),
        ],
      });
      rows = [];
      for (const data of SEED) {
        const created = await t.nextly.create({ collection: SLUG, data });
        rows.push({ id: String(created.item.id), ...data });
      }
      // The fixture can only show the id breaking ties if, in some tie, the
      // order rows were written in is not their id order.
      const ties = new Map<string, string[]>();
      for (const row of rows) {
        const key = `${row.grp}:${row.rank}`;
        ties.set(key, [...(ties.get(key) ?? []), row.id]);
      }
      expect(
        [...ties.values()].some(
          written => written.join() !== [...written].sort().join()
        )
      ).toBe(true);
    });

    afterAll(async () => {
      await t?.destroy();
    });

    const expected = (): Row[] =>
      [...rows].sort(
        (a, b) => a.grp - b.grp || nullsLast(a.rank, b.rank, true) || byId(a, b)
      );

    it("orders by each key in turn and breaks ties by the id, the same on a repeated read", async () => {
      const read = () =>
        t.nextly.find({ collection: SLUG, sort: ["grp", "-rank"], limit: 50 });
      const first = await read();
      expect(ids(first.items)).toEqual(ids(expected()));
      expect(ids((await read()).items)).toEqual(ids(first.items));
    });

    it("reads the same keys from a comma string, as REST sends them", async () => {
      const read = await t.nextly.find({
        collection: SLUG,
        sort: "grp,-rank",
        limit: 50,
      });
      expect(ids(read.items)).toEqual(ids(expected()));
    });

    it.each([0, 5, 7])(
      "starts at offset %s with limit 6, wherever that falls, and reports the full total",
      async offset => {
        const read = await t.nextly.find({
          collection: SLUG,
          sort: ["grp", "-rank"],
          offset,
          limit: 6,
        });
        expect(ids(read.items)).toEqual(
          ids(expected().slice(offset, offset + 6))
        );
        expect(read.meta.total).toBe(20);
        expect(read.meta.hasPrev).toBe(offset > 0);
        expect(read.meta.hasNext).toBe(true);
      }
    );

    it("puts empty values last whichever the direction", async () => {
      for (const desc of [false, true]) {
        const read = await t.nextly.find({
          collection: SLUG,
          sort: desc ? "-rank" : "rank",
          limit: 50,
        });
        const want = [...rows].sort(
          (a, b) => nullsLast(a.rank, b.rank, desc) || byId(a, b)
        );
        expect(ids(read.items)).toEqual(ids(want));
        const ranks = read.items.map(item => item.rank ?? null);
        expect(ranks.slice(-5)).toEqual([null, null, null, null, null]);
      }
    });

    it("puts an entry with no translation last, in both directions", async () => {
      const titled: { id: string; fr: string | null }[] = [];
      for (const [en, fr] of [
        ["b", "b"],
        ["a", null],
        ["c", "a"],
        ["d", null],
        ["e", "c"],
      ] as const) {
        const created = await t.nextly.create({
          collection: LOCALIZED,
          data: { title: en },
        });
        const id = String(created.item.id);
        if (fr !== null) {
          await t.nextly.update({
            collection: LOCALIZED,
            id,
            data: { title: fr, _overwrite: true },
            locale: "fr",
          });
        }
        titled.push({ id, fr });
      }
      for (const desc of [false, true]) {
        const read = await t.nextly.find({
          collection: LOCALIZED,
          locale: "fr",
          fallbackLocale: false,
          sort: desc ? "-title" : "title",
          limit: 50,
        });
        const want = [...titled].sort((a, b) => {
          if (a.fr === null && b.fr === null) return a.id < b.id ? -1 : 1;
          if (a.fr === null) return 1;
          if (b.fr === null) return -1;
          return desc ? b.fr.localeCompare(a.fr) : a.fr.localeCompare(b.fr);
        });
        expect(ids(read.items)).toEqual(want.map(row => row.id));
      }
    });

    it("refuses an untrusted sort on a field the reader may not read, in second position", async () => {
      await t.nextly.create({
        collection: RULED,
        data: { title: "x", secret: "s" },
      });
      // The refusal's public message is generic; the refused field is named
      // in its data.
      const refusal = await t.nextly
        .find({
          collection: RULED,
          sort: ["title", "-secret"],
          overrideAccess: false,
        })
        .then(
          () => undefined,
          (error: unknown) => JSON.stringify(error)
        );
      expect(refusal).toContain("sort.secret");
      expect(refusal).not.toContain("sort.title");
      // The control: the same read without the ruled key is allowed.
      await expect(
        t.nextly.find({
          collection: RULED,
          sort: ["title"],
          overrideAccess: false,
        })
      ).resolves.toBeDefined();
    });

    it("judges and sorts by one reading of the sort, however the array answers later", async () => {
      // An array that answers "title" when first read and "-secret" after:
      // judged on one reading and sorted on another, the order of the rows
      // would compare a field the caller may not read.
      // Descending by secret puts "b" first; ascending by title puts "a" first.
      await t.nextly.create({
        collection: RULED,
        data: { title: "a", secret: "a" },
      });
      await t.nextly.create({
        collection: RULED,
        data: { title: "b", secret: "z" },
      });
      let reads = 0;
      const shifting = new Proxy(["title"], {
        get(target, prop, receiver) {
          if (prop === "0") return reads++ === 0 ? "title" : "-secret";
          return Reflect.get(target, prop, receiver) as unknown;
        },
      });
      // Straight to the handler: the Direct API copies its arguments first,
      // and the read must hold whoever calls it.
      const handler = t.getService("collectionsHandler") as unknown as {
        listEntries(params: Record<string, unknown>): Promise<{
          success: boolean;
          data?: { docs: Record<string, unknown>[] };
        }>;
      };
      const read = await handler.listEntries({
        collectionName: RULED,
        sort: shifting,
        overrideAccess: false,
        limit: 50,
      });
      expect(read.success).toBe(true);
      const titles = (read.data?.docs ?? []).map(item => String(item.title));
      expect(titles).toEqual([...titles].sort());
    });

    it("refuses unknown sort keys, naming each, when the read asks to", async () => {
      const refusal = await t.nextly
        .find({
          collection: SLUG,
          sort: ["grp", "nope", "createdBy"],
          unknownSort: "refuse",
        })
        .then(
          () => undefined,
          (error: unknown) => JSON.stringify(error)
        );
      expect(refusal).toContain("sort.nope");
      // The owner column is named as unknown too, not as forbidden.
      expect(refusal).toContain("sort.createdBy");
      expect(refusal).not.toContain("sort.grp");
      // The control: by default the same keys are dropped and the read runs.
      await expect(
        t.nextly.find({ collection: SLUG, sort: ["grp", "nope"] })
      ).resolves.toBeDefined();
    });

    it("refuses an unknown sort key before any read hook runs", async () => {
      // The control: a read the hooks do see.
      hookCalls.length = 0;
      await t.nextly.find({
        collection: HOOKED,
        sort: ["grp"],
        unknownSort: "refuse",
      });
      expect(hookCalls.length).toBeGreaterThan(0);
      hookCalls.length = 0;
      await expect(
        t.nextly.find({
          collection: HOOKED,
          sort: ["grp", "nope"],
          unknownSort: "refuse",
        })
      ).rejects.toThrow();
      expect(hookCalls).toEqual([]);
    });

    it("names a key every object inherits as unknown, not as a column", async () => {
      const refusal = await t.nextly
        .find({
          collection: SLUG,
          sort: ["constructor", "-toString", "grp"],
          unknownSort: "refuse",
        })
        .then(
          () => "read",
          (error: unknown) => JSON.stringify(error)
        );
      expect(refusal).toContain("FIELD_NOT_SORTABLE");
      expect(refusal).toContain("sort.constructor");
      expect(refusal).toContain("sort.toString");
      expect(refusal).not.toContain("sort.grp");
    });

    it("refuses an untrusted filter or sort on a password, or a group holding one", async () => {
      const refused = (args: Record<string, unknown>) =>
        t.nextly
          .find({ collection: SECRETS, overrideAccess: false, ...args })
          .then(
            () => "read",
            (error: unknown) => JSON.stringify(error)
          );
      expect(await refused({ where: { pin: { exists: true } } })).toContain(
        "where.pin"
      );
      expect(
        await refused({ where: { account: { contains: "$2" } } })
      ).toContain("where.account");
      expect(await refused({ sort: ["-pin"] })).toContain("sort.pin");
      // The control: the same visitor may filter and sort on a plain field,
      // and trusted server code may still filter on the password.
      expect(
        await refused({ where: { title: { exists: true } }, sort: ["title"] })
      ).toBe("read");
      await expect(
        t.nextly.find({ collection: SECRETS, where: { pin: { exists: true } } })
      ).resolves.toBeDefined();
    });

    it("refuses an offset given together with a page", async () => {
      await expect(
        t.nextly.find({ collection: SLUG, offset: 5, page: 2 })
      ).rejects.toThrow(/offset/i);
    });

    it("keeps a single-key string and page-based reads as they were", async () => {
      const read = await t.nextly.find({
        collection: SLUG,
        sort: "-grp",
        page: 2,
        limit: 6,
      });
      const want = [...rows].sort((a, b) => b.grp - a.grp || byId(a, b));
      expect(ids(read.items)).toEqual(ids(want.slice(6, 12)));
      expect(read.meta.page).toBe(2);
    });
  }
);
