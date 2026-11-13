/**
 * The app's override of a generated column's storage, applied, on every
 * configured dialect.
 *
 * The app's schema hook narrows a collection's, a Single's and a component's
 * text field to `varchar(10)` and widens a collection's whole-number field to
 * `bigint`. Pinned here, through boot, the entry API and the push a restart,
 * an HMR reload and `db:sync` make:
 *
 * - the columns are created with that storage, which PostgreSQL and MySQL
 *   enforce (a longer string is refused, a number past 2^31 is kept) and
 *   SQLite, which stores no width, does not;
 * - the owner's next push keeps it, a change that rebuilds the table on
 *   SQLite included, rather than planning the field's own storage back;
 * - a narrower override over stored values longer than it is refused before
 *   any DDL, naming the column, and the values stay.
 */
import { afterEach, expect, it } from "vitest";

import {
  defineCollection,
  defineFieldGroup,
  defineSingle,
  fieldGroup,
  number,
  text,
} from "../../../config";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { resolveSingleTableName } from "../../singles/services/resolve-single-table-name";
import { declaredSize } from "../pipeline/diff/declared-size";
import { introspectLiveSnapshot } from "../pipeline/diff/introspect-live";
import { normalizeType } from "../pipeline/diff/normalize-type";
import type { ColumnSpec } from "../pipeline/diff/types";
import { applyDesiredSchema } from "../pipeline/index";
import { resolveComponentTableName } from "../utils/resolve-table-name";

import type { SchemaHook } from "./draft";
import { col } from "./dsl";
import { compileAndPublishExtensionSchema } from "./publish";

const POSTS_TABLE = "dc_co_posts";
const SITE_TABLE = resolveSingleTableName({ slug: "co_site" });
const SEO_TABLE = resolveComponentTableName("co_seo");

const SHORT = "0123456789";
const LONG = "0123456789X";
/** Past what a 32-bit integer holds. */
const BIG = 2 ** 31 + 5;

const seoFields = [text({ name: "metaTitle" })];
const siteFields = [text({ name: "tagline" })];
const postsFields = (headlineRequired: boolean) => [
  text({ name: "headline", required: headlineRequired }),
  text({ name: "city" }),
  number({ name: "views" }),
  fieldGroup({ name: "seo", component: "co_seo" }),
];

/** The app's hook: each text column to `width` characters, `views` to bigint. */
const overrides =
  (width: number): SchemaHook =>
  ({ schema }) => {
    schema.overrideColumn(POSTS_TABLE, "city", col.varchar(width));
    schema.overrideColumn(POSTS_TABLE, "views", col.bigint());
    schema.overrideColumn(SITE_TABLE, "tagline", col.varchar(width));
    schema.overrideColumn(SEO_TABLE, "metaTitle", col.varchar(width));
  };

/** The config's entities, as boot and a push are handed them. */
const entities = (headlineRequired: boolean) => ({
  fieldGroups: [defineFieldGroup({ slug: "co_seo", fields: seoFields })],
  collections: [
    defineCollection({
      slug: "co_posts",
      fields: postsFields(headlineRequired),
    }),
  ],
  singles: [defineSingle({ slug: "co_site", fields: siteFields })],
});

let handle: TestNextly | undefined;

afterEach(async () => {
  await handle?.destroy();
  handle = undefined;
});

/** One column as the database has it, read by the diff's own introspection. */
async function liveColumn(
  dialect: TestDialect,
  table: string,
  column: string
): Promise<ColumnSpec> {
  const snapshot = await introspectLiveSnapshot(
    handle!.adapter.getDrizzle(),
    dialect,
    [table]
  );
  const found = snapshot.tables[0]?.columns.find(c => c.name === column);
  if (found === undefined) throw new Error(`${table}.${column} is missing`);
  return found;
}

/** Whether `column` is a string of at most `width` characters, as stored. */
async function expectWidth(
  dialect: TestDialect,
  table: string,
  column: string,
  width: number
): Promise<void> {
  const live = await liveColumn(dialect, table, column);
  if (dialect === "sqlite") {
    // SQLite has one string type and keeps no width.
    expect(normalizeType(live.type), `${table}.${column}`).toBe("text");
    return;
  }
  expect(normalizeType(live.type), `${table}.${column}`).toBe("varchar");
  expect(declaredSize(live), `${table}.${column}`).toBe(String(width));
}

/** A push of the configuration's entities, as a restart and `db:sync` push them. */
function push(headlineRequired: boolean) {
  const { collections, singles, fieldGroups } = entities(headlineRequired);
  return applyDesiredSchema(
    {
      collections: {
        co_posts: {
          slug: "co_posts",
          tableName: POSTS_TABLE,
          fields: collections[0]!.fields,
        },
      },
      singles: {
        co_site: {
          slug: "co_site",
          tableName: SITE_TABLE,
          fields: singles[0]!.fields,
        },
      },
      components: {
        co_seo: {
          slug: "co_seo",
          tableName: SEO_TABLE,
          fields: fieldGroups[0]!.fields,
        },
      },
    },
    "code",
    { promptChannel: "terminal" }
  );
}

describeEachDialect("the app's override of a generated column", dialect => {
  it("stores the field within its family, and every push keeps it", async () => {
    handle = await createTestNextly({
      dialect,
      ...entities(true),
      db: {
        migrationsDir: "./migrations",
        uiSchemaFile: "./ui-schema.json",
        schema: { extend: [overrides(10)] },
      },
    });
    const { nextly } = handle;

    for (const [table, column] of [
      [POSTS_TABLE, "city"],
      [SITE_TABLE, "tagline"],
      [SEO_TABLE, "meta_title"],
    ] as const) {
      await expectWidth(dialect, table, column, 10);
    }
    expect(
      normalizeType((await liveColumn(dialect, POSTS_TABLE, "views")).type)
    ).toBe(dialect === "sqlite" ? "int4" : "int8");

    // Within the width, and a number a 32-bit integer cannot hold.
    const created = await nextly.create({
      collection: "co_posts",
      data: {
        headline: "kept",
        city: SHORT,
        views: BIG,
        seo: { metaTitle: SHORT },
      },
      overrideAccess: true,
    });
    const id = (created.item as { id: string }).id;
    const read = (await nextly.findByID({
      collection: "co_posts",
      id,
      overrideAccess: true,
    })) as { city?: unknown; views?: unknown };
    expect(read.city).toBe(SHORT);
    expect(Number(read.views)).toBe(BIG);
    await nextly.updateSingle({
      slug: "co_site",
      data: { tagline: SHORT, _overwrite: true },
      overrideAccess: true,
    });

    // Past the width: refused where the dialect enforces one.
    const tooLong = [
      () =>
        nextly.create({
          collection: "co_posts",
          data: { headline: "long", city: LONG },
          overrideAccess: true,
        }),
      () =>
        nextly.create({
          collection: "co_posts",
          data: { headline: "long", seo: { metaTitle: LONG } },
          overrideAccess: true,
        }),
      () =>
        nextly.updateSingle({
          slug: "co_site",
          data: { tagline: LONG, _overwrite: true },
          overrideAccess: true,
        }),
    ];
    for (const write of tooLong) {
      if (dialect === "sqlite") await expect(write()).resolves.toBeDefined();
      else await expect(write()).rejects.toThrow();
    }

    // The owner's own change, pushed. On SQLite making a column optional
    // rebuilds its table, and the rebuild keeps the override too.
    const pushed = await push(false);
    expect(pushed.success, JSON.stringify(pushed)).toBe(true);
    expect((await liveColumn(dialect, POSTS_TABLE, "headline")).nullable).toBe(
      true
    );
    for (const [table, column] of [
      [POSTS_TABLE, "city"],
      [SITE_TABLE, "tagline"],
      [SEO_TABLE, "meta_title"],
    ] as const) {
      await expectWidth(dialect, table, column, 10);
    }
    expect(
      normalizeType((await liveColumn(dialect, POSTS_TABLE, "views")).type)
    ).toBe(dialect === "sqlite" ? "int4" : "int8");
    const after = (await nextly.findByID({
      collection: "co_posts",
      id,
      overrideAccess: true,
    })) as { city?: unknown; views?: unknown };
    expect(after.city).toBe(SHORT);
    expect(Number(after.views)).toBe(BIG);

    // A narrower override over values longer than it: judged by the data,
    // and refused before any DDL on the dialects that enforce a width.
    await compileAndPublishExtensionSchema({
      dialect,
      plugins: [],
      config: {
        ...entities(false),
        db: { schema: { extend: [overrides(5)] } },
      },
      logger: { warn: () => {} },
    });
    const narrowed = await push(false);
    if (dialect === "sqlite") {
      expect(narrowed.success, JSON.stringify(narrowed)).toBe(true);
    } else {
      expect(narrowed.success).toBe(false);
      expect(JSON.stringify(narrowed)).toContain("NARROWING_WOULD_TRUNCATE");
      await expectWidth(dialect, POSTS_TABLE, "city", 10);
      const kept = (await nextly.findByID({
        collection: "co_posts",
        id,
        overrideAccess: true,
      })) as { city?: unknown };
      expect(kept.city).toBe(SHORT);
    }
  });
});
