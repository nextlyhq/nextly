/**
 * What a plugin contributes to a collection's, a Single's and a component's
 * table — a hidden column and an index over it — is created on each of the
 * three, and kept, with the column's values, when the table's owner changes
 * its own fields and the change is pushed. On every configured dialect.
 *
 * The owner's change makes a required field optional and adds a field. On
 * SQLite a column's nullability cannot be altered in place, so the push
 * rebuilds each table: a rebuild planned without the contribution would copy
 * the rows into a table that has neither the column nor its index. On
 * PostgreSQL and MySQL the same change is altered in place, and a push that
 * planned from the owner's fields alone would drop the column and the index
 * as drift.
 */
import { afterEach, expect, it } from "vitest";

import {
  defineCollection,
  defineFieldGroup,
  defineSingle,
  fieldGroup,
  text,
} from "../../../config";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import { definePlugin } from "../../../plugins/plugin-context";
import {
  createTestNextly,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { resolveSingleTableName } from "../../singles/services/resolve-single-table-name";
import { introspectLiveSnapshot } from "../pipeline/diff/introspect-live";
import type { TableSpec } from "../pipeline/diff/types";
import { applyDesiredSchema } from "../pipeline/index";
import { resolveComponentTableName } from "../utils/resolve-table-name";

import { col } from "./dsl";

const POSTS_TABLE = "dc_ek_posts";
const SITE_TABLE = resolveSingleTableName({ slug: "ek_site" });
const SEO_TABLE = resolveComponentTableName("ek_seo");
const TABLES = [POSTS_TABLE, SITE_TABLE, SEO_TABLE] as const;

/** Each entity's own field, required at the first boot and optional after. */
const OWN_FIELD: Record<(typeof TABLES)[number], string> = {
  [POSTS_TABLE]: "headline",
  [SITE_TABLE]: "tagline",
  [SEO_TABLE]: "meta_title",
};

const postsFields = (required: boolean, added: boolean) => [
  text({ name: "headline", required }),
  fieldGroup({ name: "seo", component: "ek_seo" }),
  ...(added ? [text({ name: "subtitle" })] : []),
];
const siteFields = (required: boolean, added: boolean) => [
  text({ name: "tagline", required }),
  ...(added ? [text({ name: "motto" })] : []),
];
const seoFields = (required: boolean, added: boolean) => [
  text({ name: "metaTitle", required }),
  ...(added ? [text({ name: "metaDescription" })] : []),
];

/**
 * The contributor: a nullable column and an index over it, on each of the
 * three tables.
 */
const contributor = definePlugin({
  name: "@test/entity-keeper",
  version: "1.0.0",
  nextly: ">=0.0.0",
  contributes: {
    schema: {
      extend: [
        ({ schema }) => {
          for (const table of TABLES) {
            schema.extendTable(table, {
              columns: { searchKey: col.shortText({ nullable: true }) },
              indexes: [{ columns: ["searchKey"] }],
            });
          }
        },
      ],
    },
  },
});

let handle: TestNextly | undefined;

afterEach(async () => {
  await handle?.destroy();
  handle = undefined;
});

const q = (dialect: TestDialect, name: string): string =>
  dialect === "mysql" ? `\`${name}\`` : `"${name}"`;

/** The three tables as the database has them, read by the diff's own introspection. */
async function live(
  instance: TestNextly,
  dialect: TestDialect
): Promise<Map<string, TableSpec>> {
  const snapshot = await introspectLiveSnapshot(
    instance.adapter.getDrizzle(),
    dialect,
    [...TABLES]
  );
  return new Map(snapshot.tables.map(table => [table.name, table]));
}

/** The index the contribution asks for: one over `search_key` alone. */
function contributedIndex(table: TableSpec) {
  return (table.indexes ?? []).find(
    index =>
      index.columns.length === 1 &&
      index.columns[0] === "search_key" &&
      !index.unique
  );
}

/** One row in each table, through the entry API, and the contributor's value on it. */
async function seedRows(
  instance: TestNextly,
  dialect: TestDialect
): Promise<void> {
  await instance.nextly.create({
    collection: "ek_posts",
    data: { headline: "kept", seo: { metaTitle: "Meta" } },
    overrideAccess: true,
  });
  await instance.nextly.updateSingle({
    slug: "ek_site",
    data: { tagline: "kept", _overwrite: true },
    overrideAccess: true,
  });
  // Past the entry API, which drops a value for a hidden column: the
  // contributor's own write, as `ctx.db.contributed` makes it.
  for (const table of TABLES) {
    await instance.adapter.executeQuery(
      `UPDATE ${q(dialect, table)} SET ${q(dialect, "search_key")} = 'key-${table}'`
    );
  }
}

/** Each table's contributed values, by table. */
async function contributedValues(
  instance: TestNextly,
  dialect: TestDialect
): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {};
  for (const table of TABLES) {
    const rows = await instance.adapter.executeQuery<Record<string, unknown>>(
      `SELECT ${q(dialect, "search_key")} AS v FROM ${q(dialect, table)}`
    );
    out[table] = rows.map(row => row.v ?? row.V);
  }
  return out;
}

describeEachDialect(
  "a plugin's column and index on a collection, a Single and a component",
  dialect => {
    it("is created on each table, and kept with its values when the owner's own fields change", async () => {
      handle = await createTestNextly({
        dialect,
        fieldGroups: [
          defineFieldGroup({ slug: "ek_seo", fields: seoFields(true, false) }),
        ],
        collections: [
          defineCollection({
            slug: "ek_posts",
            fields: postsFields(true, false),
          }),
        ],
        singles: [
          defineSingle({ slug: "ek_site", fields: siteFields(true, false) }),
        ],
        plugins: [contributor],
      });

      // Created on each kind of table, column and index alike.
      const before = await live(handle, dialect);
      for (const table of TABLES) {
        const spec = before.get(table);
        expect(spec, `${table} exists`).toBeDefined();
        expect(spec!.columns.map(c => c.name)).toContain("search_key");
        expect(contributedIndex(spec!), `${table}'s index`).toBeDefined();
        // The premise of the owner's change: its field starts NOT NULL.
        expect(
          spec!.columns.find(c => c.name === OWN_FIELD[table])?.nullable,
          `${table}.${OWN_FIELD[table]} starts required`
        ).toBe(false);
      }

      await seedRows(handle, dialect);
      const expected = Object.fromEntries(
        TABLES.map(table => [table, [`key-${table}`]])
      );
      expect(await contributedValues(handle, dialect)).toEqual(expected);

      // The owner's change, pushed as a restart, an HMR reload and
      // `db:sync` push it, with the contributor still configured.
      const pushed = await applyDesiredSchema(
        {
          collections: {
            ek_posts: {
              slug: "ek_posts",
              tableName: POSTS_TABLE,
              fields: postsFields(false, true),
            },
          },
          singles: {
            ek_site: {
              slug: "ek_site",
              tableName: SITE_TABLE,
              fields: siteFields(false, true),
            },
          },
          components: {
            ek_seo: {
              slug: "ek_seo",
              tableName: SEO_TABLE,
              fields: seoFields(false, true),
            },
          },
        },
        "code",
        { promptChannel: "terminal" }
      );
      expect(pushed.success, JSON.stringify(pushed)).toBe(true);

      const after = await live(handle, dialect);
      for (const table of TABLES) {
        const spec = after.get(table)!;
        const names = spec.columns.map(c => c.name);
        // The owner's change landed: its field is optional now, so on
        // SQLite the table was rebuilt, and its new field was added.
        expect(
          spec.columns.find(c => c.name === OWN_FIELD[table])?.nullable,
          `${table}.${OWN_FIELD[table]} is optional after the push`
        ).toBe(true);
        expect(names.length).toBe(
          before.get(table)!.columns.length + 1
        );
        // And the contribution is still there, index included.
        expect(names).toContain("search_key");
        expect(contributedIndex(spec), `${table}'s index`).toBeDefined();
      }
      expect(await contributedValues(handle, dialect)).toEqual(expected);
    });
  }
);
