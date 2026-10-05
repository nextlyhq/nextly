/**
 * A column a schema hook contributes to an entity's table exists physically,
 * and is invisible to the entry API in both directions.
 *
 * The column is real — on the table and in the runtime Drizzle object — so a
 * read returns it and a write reaches it unless the entry boundary stops each.
 * Its contributor writes it through `ctx.db`; a caller of the entry API can
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
