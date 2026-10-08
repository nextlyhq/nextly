/**
 * A column a schema hook contributes to an entity's table exists physically,
 * and is invisible to the entry API in both directions.
 *
 * The column is real — on the table and in the runtime Drizzle object — so a
 * read returns it and a write reaches it unless the entry boundary stops each.
 * Its contributor writes it through its own queries; a caller of the entry API can
 * neither see it nor set it, in either spelling of its name.
 *
 * Collections, Singles and field groups each have their own read and write
 * services, their own runtime-table builder and their own boot path, so each
 * is pinned here: on a fresh database, where boot creates the table, and on a
 * table an earlier boot created without the column, where it must be ADDED.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  defineCollection,
  defineFieldGroup,
  defineSingle,
  fieldGroup,
  text,
} from "../../../../config";
import { createAdapter } from "../../../../database/factory";
import type { WhereFilter } from "../../../collections/query/query-operators";
import { clearServices } from "../../../../di/register";
import { definePlugin } from "../../../../plugins/plugin-context";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import { resolveSingleTableName } from "../../../singles/services/resolve-single-table-name";
import { applyDesiredSchema } from "../../pipeline/index";
import { resolveComponentTableName } from "../../utils/resolve-table-name";
import { col } from "../dsl";

const POSTS_TABLE = "dc_posts";
const SITE_TABLE = resolveSingleTableName({ slug: "site" });
const SEO_TABLE = resolveComponentTableName("seo");

const siteFields = () => [text({ name: "tagline" })];
const seoFields = () => [text({ name: "metaTitle" })];

type SharedAdapter = Awaited<ReturnType<typeof createAdapter>>;

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/**
 * Boot with a plugin whose schema hook contributes `searchVector` to
 * `tables`, or with no plugin at all when `tables` is empty.
 */
async function boot(
  dialect: TestDialect,
  tables: readonly string[],
  adapter?: SharedAdapter
): Promise<TestNextly> {
  const contributor = definePlugin({
    name: "@test/search-index",
    version: "1.0.0",
    nextly: ">=0.0.0",
    contributes: {
      schema: {
        extend: [
          ({ schema }) => {
            for (const table of tables) {
              schema.extendTable(table, {
                columns: { searchVector: col.text({ nullable: true }) },
              });
            }
          },
        ],
      },
    },
  });
  current = await createTestNextly({
    ...(adapter ? { adapter } : { dialect }),
    fieldGroups: [defineFieldGroup({ slug: "seo", fields: seoFields() })],
    collections: [
      defineCollection({
        slug: "posts",
        fields: [
          text({ name: "title" }),
          fieldGroup({ name: "seo", component: "seo" }),
        ],
      }),
    ],
    singles: [defineSingle({ slug: "site", fields: siteFields() })],
    plugins: tables.length > 0 ? [contributor] : [],
  });
  return current;
}

/** The one stored row of `table`, read past the entry API. */
async function storedRow(
  handle: TestNextly,
  table: string
): Promise<Record<string, unknown>> {
  const row = await handle.adapter.selectOne<Record<string, unknown>>(
    table,
    {}
  );
  if (!row) throw new Error(`no row in ${table}`);
  return row;
}

/** The contributor's own write, past the entry API. */
async function contributorWrites(
  handle: TestNextly,
  table: string,
  id: string
): Promise<void> {
  await handle.adapter.update(
    table,
    { search_vector: "indexed" },
    { and: [{ column: "id", op: "=", value: id }] }
  );
}

/** Neither spelling of the contributed column is on an entry. */
function expectNoContributedColumn(entry: unknown): void {
  expect(entry).not.toHaveProperty("searchVector");
  expect(entry).not.toHaveProperty("search_vector");
}

/**
 * The Single's table holds the column, and its entry API neither sets nor
 * returns it.
 */
async function expectSingleColumnHidden(handle: TestNextly): Promise<void> {
  await handle.nextly.updateSingle({
    slug: "site",
    data: { tagline: "first", searchVector: "from-first-write" },
    overrideAccess: true,
  });
  // The column exists physically: the runtime table names it, so this read
  // fails at the database if it was not created.
  const stored = await storedRow(handle, SITE_TABLE);
  expect(stored).toHaveProperty("search_vector", null);
  await contributorWrites(handle, SITE_TABLE, String(stored.id));

  const updated = await handle.nextly.updateSingle({
    slug: "site",
    data: { tagline: "second", searchVector: "a", search_vector: "b" },
    overrideAccess: true,
  });
  expect((updated.item as { tagline?: unknown }).tagline).toBe("second");
  expectNoContributedColumn(updated.item);

  const row = await storedRow(handle, SITE_TABLE);
  expect(row.tagline).toBe("second");
  expect(row.search_vector).toBe("indexed");

  const read = await handle.nextly.findSingle({
    slug: "site",
    overrideAccess: true,
  });
  expect((read as { tagline?: unknown }).tagline).toBe("second");
  expectNoContributedColumn(read);
}

/**
 * The field group's table holds the column, and the entry API of the entity
 * embedding it neither sets nor returns it.
 */
async function expectFieldGroupColumnHidden(handle: TestNextly): Promise<void> {
  const created = await handle.nextly.create({
    collection: "posts",
    data: {
      title: "first",
      seo: { metaTitle: "Meta", searchVector: "from-create" },
    },
    overrideAccess: true,
  });
  const postId = (created.item as { id: string }).id;
  // The column exists physically, and the entry write did not reach it.
  const stored = await storedRow(handle, SEO_TABLE);
  expect(stored).toHaveProperty("search_vector", null);
  await contributorWrites(handle, SEO_TABLE, String(stored.id));

  const read = await handle.nextly.findByID({
    collection: "posts",
    id: postId,
    overrideAccess: true,
  });
  const seo = (read as { seo?: unknown }).seo;
  expect((seo as { metaTitle?: unknown }).metaTitle).toBe("Meta");
  expectNoContributedColumn(seo);
  expect((await storedRow(handle, SEO_TABLE)).search_vector).toBe("indexed");
}

describe.each(getConfiguredTestDialects())(
  "a column a schema hook contributed (%s)",
  dialect => {
    describe("to a collection", () => {
      it("is not written by a create or an update that carries it", async () => {
        const handle = await boot(dialect, [POSTS_TABLE]);

        const created = await handle.nextly.create({
          collection: "posts",
          data: { title: "first", searchVector: "from-create" },
          overrideAccess: true,
        });
        const id = (created.item as { id: string }).id;
        expect((created.item as { title?: unknown }).title).toBe("first");
        expectNoContributedColumn(created.item);
        expect((await storedRow(handle, POSTS_TABLE)).search_vector).toBeNull();

        const updated = await handle.nextly.update({
          collection: "posts",
          id,
          data: { title: "second", search_vector: "from-update" },
          overrideAccess: true,
        });
        expect((updated.item as { title?: unknown }).title).toBe("second");
        expectNoContributedColumn(updated.item);

        const row = await storedRow(handle, POSTS_TABLE);
        expect(row.title).toBe("second");
        expect(row.search_vector).toBeNull();
      });

      it("keeps a value its contributor wrote, through entry reads and writes", async () => {
        const handle = await boot(dialect, [POSTS_TABLE]);
        const created = await handle.nextly.create({
          collection: "posts",
          data: { title: "first" },
          overrideAccess: true,
        });
        const id = (created.item as { id: string }).id;
        await contributorWrites(handle, POSTS_TABLE, id);

        const read = await handle.nextly.findByID({
          collection: "posts",
          id,
          overrideAccess: true,
        });
        expect((read as { title?: unknown }).title).toBe("first");
        expectNoContributedColumn(read);

        const { items } = await handle.nextly.find({
          collection: "posts",
          overrideAccess: true,
        });
        expect(items).toHaveLength(1);
        expectNoContributedColumn(items[0]);

        const updated = await handle.nextly.update({
          collection: "posts",
          id,
          data: { title: "second", searchVector: "overwritten" },
          overrideAccess: true,
        });
        expect((updated.item as { title?: unknown }).title).toBe("second");
        expectNoContributedColumn(updated.item);
        expect((await storedRow(handle, POSTS_TABLE)).search_vector).toBe(
          "indexed"
        );
      });
    });

    describe("to a collection, through an aggregate or an ordering", () => {
      /** Two posts whose contributed values order them opposite to their ids. */
      async function seeded(): Promise<TestNextly> {
        const handle = await boot(dialect, [POSTS_TABLE]);
        for (const [title, vector] of [
          ["alpha", "zz-secret"],
          ["beta", "aa-secret"],
        ] as const) {
          const created = await handle.nextly.create({
            collection: "posts",
            data: { title },
            overrideAccess: true,
          });
          await handle.adapter.update(
            POSTS_TABLE,
            { search_vector: vector },
            {
              and: [
                {
                  column: "id",
                  op: "=",
                  value: (created.item as { id: string }).id,
                },
              ],
            }
          );
        }
        return handle;
      }

      it("is no group key, in either spelling, even for a trusted caller", async () => {
        const handle = await seeded();
        for (const groupBy of ["searchVector", "search_vector"]) {
          const refused = await handle.nextly
            .group({ collection: "posts", groupBy, overrideAccess: true })
            .then(
              () => undefined,
              (error: unknown) => error
            );
          // Refused as a column that is not there: the buckets would otherwise
          // carry every stored value as a label.
          expect(refused, groupBy).toMatchObject({
            publicData: {
              errors: [
                {
                  path: `groupBy.${groupBy}`,
                  code: "FIELD_NOT_GROUPABLE",
                },
              ],
            },
          });
        }
        // A declared field beside it still groups, so the refusal is about the
        // column and not about grouping.
        const { buckets } = await handle.nextly.group({
          collection: "posts",
          groupBy: "title",
          overrideAccess: true,
        });
        expect(buckets).toHaveLength(2);
      });

      it("orders nothing when named as a sort", async () => {
        const handle = await seeded();
        const titles = async (sort: string) =>
          (
            await handle.nextly.find({
              collection: "posts",
              sort,
              overrideAccess: true,
            })
          ).items.map(item => (item as { title?: unknown }).title);
        const unsorted = await titles("-createdAt");
        // Ordered by the hidden values this would put "beta" first in one
        // direction and "alpha" first in the other; ignored, both directions
        // read the same order back.
        expect(await titles("searchVector")).toEqual(
          await titles("-searchVector")
        );
        expect(await titles("search_vector")).toEqual(
          await titles("-search_vector")
        );
        expect(new Set(unsorted)).toEqual(new Set(["alpha", "beta"]));
      });

      it("is no filter key, in either spelling or position, on any read", async () => {
        const handle = await seeded();
        const nextly = handle.nextly;
        // Every read that takes a `where`, each asked by a trusted caller: a
        // row set, a count or a bucket set that varied with the guess would
        // answer it.
        const reads: Array<[string, (where: WhereFilter) => Promise<unknown>]> =
          [
            [
              "find",
              where =>
                nextly.find({
                  collection: "posts",
                  where,
                  overrideAccess: true,
                }),
            ],
            [
              "count",
              where =>
                nextly.count({
                  collection: "posts",
                  where,
                  overrideAccess: true,
                }),
            ],
            [
              "group",
              where =>
                nextly.group({
                  collection: "posts",
                  groupBy: "title",
                  where,
                  overrideAccess: true,
                }),
            ],
            [
              "timeseries",
              where =>
                nextly.timeseries({
                  collection: "posts",
                  dateField: "createdAt",
                  interval: "day",
                  where,
                  overrideAccess: true,
                }),
            ],
          ];
        for (const key of ["searchVector", "search_vector"]) {
          const guess = { equals: "zz-secret" };
          const wheres: WhereFilter[] = [
            { [key]: guess },
            { and: [{ title: { equals: "alpha" } }, { [key]: guess }] },
            { or: [{ [`${key}.inner`]: guess }] },
          ];
          for (const [name, read] of reads) {
            for (const where of wheres) {
              const refused = await read(where).then(
                () => undefined,
                (error: unknown) => error
              );
              expect(refused, `${name} ${JSON.stringify(where)}`).toMatchObject(
                {
                  publicData: {
                    errors: [
                      { path: `where.${key}`, code: "FIELD_NOT_FILTERABLE" },
                    ],
                  },
                }
              );
            }
          }
        }
        // A declared field beside it still filters, so the refusal is about
        // the column and not about filtering.
        const { items } = await nextly.find({
          collection: "posts",
          where: { title: { equals: "alpha" } },
          overrideAccess: true,
        });
        expect(items.map(item => (item as { title?: unknown }).title)).toEqual([
          "alpha",
        ]);
      });
    });

    describe("to a field group, through a filter on the embedding collection", () => {
      /**
       * Two posts whose `seo` rows carry different contributed values, so a
       * component filter on that column would pick out one of them.
       */
      async function seeded(): Promise<TestNextly> {
        const handle = await boot(dialect, [SEO_TABLE]);
        for (const [title, vector] of [
          ["alpha", "zz-secret"],
          ["beta", "aa-secret"],
        ] as const) {
          const created = await handle.nextly.create({
            collection: "posts",
            data: { title, seo: { metaTitle: `${title}-meta` } },
            overrideAccess: true,
          });
          await handle.adapter.update(
            SEO_TABLE,
            { search_vector: vector },
            {
              and: [
                {
                  column: "_parent_id",
                  op: "=",
                  value: (created.item as { id: string }).id,
                },
              ],
            }
          );
        }
        return handle;
      }

      it("is no filter key under the component field, in either spelling or position", async () => {
        const handle = await seeded();
        const nextly = handle.nextly;
        // A list and a count: either answers the guess, one by the rows it
        // returns and one by how many there are.
        const reads: Array<[string, (where: WhereFilter) => Promise<unknown>]> =
          [
            [
              "find",
              where =>
                nextly.find({
                  collection: "posts",
                  where,
                  overrideAccess: true,
                }),
            ],
            [
              "count",
              where =>
                nextly.count({
                  collection: "posts",
                  where,
                  overrideAccess: true,
                }),
            ],
          ];
        for (const key of ["seo.searchVector", "seo.search_vector"]) {
          const wheres: WhereFilter[] = [
            { [key]: { equals: "zz-secret" } },
            { [key]: "zz-secret" },
            {
              and: [{ title: { equals: "alpha" } }, { [key]: { like: "zz%" } }],
            },
            { or: [{ [`${key}.inner`]: { equals: "zz-secret" } }] },
          ];
          for (const [name, read] of reads) {
            for (const where of wheres) {
              const refused = await read(where).then(
                () => undefined,
                (error: unknown) => error
              );
              const path = Object.keys(
                (where.and?.[1] ?? where.or?.[0] ?? where) as object
              )[0];
              expect(refused, `${name} ${JSON.stringify(where)}`).toMatchObject(
                {
                  publicData: {
                    errors: [
                      { path: `where.${path}`, code: "FIELD_NOT_FILTERABLE" },
                    ],
                  },
                }
              );
            }
          }
        }
        // A declared component field beside it still filters, so the refusal
        // is about the column and not about component filtering.
        const { items } = await nextly.find({
          collection: "posts",
          where: { "seo.metaTitle": { equals: "alpha-meta" } },
          overrideAccess: true,
        });
        expect(items.map(item => (item as { title?: unknown }).title)).toEqual([
          "alpha",
        ]);
      });
    });

    // Nothing runs after boot here: the table boot created is the one the
    // application serves, which is the production path.
    describe("on a fresh database", () => {
      it("is created with a Single's table, and hidden from its entry API", async () => {
        const handle = await boot(dialect, [SITE_TABLE]);
        await expectSingleColumnHidden(handle);
      });

      it("is created with a field group's table, and hidden from its entry API", async () => {
        const handle = await boot(dialect, [SEO_TABLE]);
        await expectFieldGroupColumnHidden(handle);
      });
    });
  }
);

// SQLite only: a second boot has to meet the database the first one made, and
// the harness shares a database between boots only through a caller-supplied
// adapter, which it provisions for no other dialect.
describe("a column a schema hook contributed to a table an earlier boot made without it", () => {
  it("is added to a Single's and a field group's table by the pipeline", async () => {
    const adapter = await createAdapter({
      type: "sqlite",
      memory: true,
    } as Parameters<typeof createAdapter>[0]);
    // The first boot, with no contribution, creates both tables without the
    // column. Not `destroy()`d: the second boot needs its database, and
    // clearing the container is what the other two-phase suites do.
    await boot("sqlite", [], adapter);
    current = undefined;
    clearServices();

    const handle = await boot("sqlite", [SITE_TABLE, SEO_TABLE], adapter);
    // Boot leaves an existing table alone, so the column is not there yet:
    // the runtime tables name it and a read of either fails.
    await expect(handle.adapter.select(SITE_TABLE, {})).rejects.toThrow();
    await expect(handle.adapter.select(SEO_TABLE, {})).rejects.toThrow();

    // The apply a dev restart, an HMR reload and `db:sync` run.
    const result = await applyDesiredSchema(
      {
        collections: {},
        singles: {
          site: { slug: "site", tableName: SITE_TABLE, fields: siteFields() },
        },
        components: {
          seo: { slug: "seo", tableName: SEO_TABLE, fields: seoFields() },
        },
      },
      "code",
      { promptChannel: "terminal" }
    );
    expect(result.success, JSON.stringify(result)).toBe(true);

    await expectSingleColumnHidden(handle);
    await expectFieldGroupColumnHidden(handle);
  });
});
