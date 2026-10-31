/**
 * The schema the collection-delete refusals are tested against: a collection
 * something depends on in each of the three ways, and the plugins that do
 * the depending.
 *
 * Shared by the suites for the runtime delete paths and for `migrate:create`,
 * so both refuse over exactly the same dependents.
 */
import {
  defineCollection,
  defineFieldGroup,
  defineSingle,
  fieldGroup,
  group,
  relationship,
  repeater,
  text,
} from "../../../../config";
import { col, defineTable } from "../../../schema/extension/dsl";
import { readIndexNames } from "../../../schema/pipeline/live-table-facts";
import { definePlugin } from "../../../../plugins/plugin-context";
import type { TestDialect, TestNextly } from "../../../../plugins/test-nextly";

/** The collection every suite tries to delete. */
export const TAGS = "dep_tags";
export const TAGS_TABLE = `dc_${TAGS}`;

/** A collection pointing at TAGS from inside a repeater and a group. */
export const POSTS = "dep_posts";
export const SETTINGS = "dep_settings";
export const CARDS = "dep_cards";
export const META = "dep_meta";

/** The field group TAGS stores values in, so a teardown would remove them. */
export const metaGroup = defineFieldGroup({
  slug: META,
  fields: [text({ name: "note" })],
});

/** TAGS: translated, with a field group, so a teardown has something to remove. */
export const tags = defineCollection({
  slug: TAGS,
  localized: true,
  fields: [
    text({ name: "label" }),
    fieldGroup({ name: "meta", component: META }),
  ],
});

/** TAGS without translation or field group, for the suites that need neither. */
export const plainTags = defineCollection({
  slug: TAGS,
  fields: [text({ name: "label" })],
});

export const posts = defineCollection({
  slug: POSTS,
  fields: [
    text({ name: "title" }),
    repeater({
      name: "sections",
      fields: [
        group({
          name: "meta",
          fields: [relationship({ name: "tag", relationTo: TAGS })],
        }),
      ],
    }),
  ],
});

export const settings = defineSingle({
  slug: SETTINGS,
  fields: [relationship({ name: "featured", relationTo: TAGS })],
});

export const cards = defineFieldGroup({
  slug: CARDS,
  fields: [relationship({ name: "topic", relationTo: TAGS })],
});

/** The plugin whose own table has a declared foreign key to TAGS's table. */
export const LINKS_PLUGIN = "@t/dep-links";
export const LINKS_TABLE = "deplinks__links";

export const linksPlugin = definePlugin({
  name: LINKS_PLUGIN,
  version: "1.0.0",
  nextly: ">=0.0.0",
  contributes: {
    schema: {
      prefix: "deplinks",
      tables: [
        defineTable(
          "links",
          { id: col.id(), tagId: col.shortText({ nullable: true }) },
          {
            foreignKeys: [
              {
                columns: ["tagId"],
                references: { table: TAGS_TABLE, columns: ["id"] },
              },
            ],
          }
        ),
      ],
    },
  },
});

/** The plugin that adds a hidden column and an index on it to TAGS's table. */
export const MARKER_PLUGIN = "@t/dep-marker";
export const MARKER_COLUMN = "marker";

export const markerPlugin = definePlugin({
  name: MARKER_PLUGIN,
  version: "1.0.0",
  nextly: ">=0.0.0",
  contributes: {
    schema: {
      extend: [
        ({ schema }) => {
          schema.extendTable(TAGS_TABLE, {
            columns: { [MARKER_COLUMN]: col.shortText({ nullable: true }) },
            indexes: [{ columns: [MARKER_COLUMN] }],
          });
        },
      ],
    },
  },
});

/** The foreign keys on `table` as the database's own catalog lists them, `name->target`. */
export async function liveForeignKeys(
  adapter: TestNextly["adapter"],
  dialect: TestDialect,
  table: string
): Promise<string[]> {
  if (dialect === "sqlite") {
    // SQLite keeps no constraint names, so the target is what identifies a key.
    const rows = await adapter.executeQuery<Record<string, unknown>>(
      `SELECT "table" AS tgt FROM pragma_foreign_key_list('${table}')`
    );
    return rows.map(row => `->${String(row.tgt)}`).sort();
  }
  const rows =
    dialect === "postgresql"
      ? await adapter.executeQuery<Record<string, unknown>>(
          `SELECT c.conname AS name, t.relname AS tgt
             FROM pg_constraint c
             JOIN pg_class s ON s.oid = c.conrelid
             JOIN pg_class t ON t.oid = c.confrelid
            WHERE c.contype = 'f' AND s.relname = '${table}'`
        )
      : await adapter.executeQuery<Record<string, unknown>>(
          `SELECT CONSTRAINT_NAME AS name, REFERENCED_TABLE_NAME AS tgt
             FROM information_schema.REFERENTIAL_CONSTRAINTS
            WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = '${table}'`
        );
  return rows.map(row => `${String(row.name)}->${String(row.tgt)}`).sort();
}

/** The index names `table` carries, read from the live database. */
export async function liveIndexes(
  adapter: TestNextly["adapter"],
  table: string
): Promise<string[]> {
  return [
    ...(await readIndexNames(adapter.getDrizzle(), adapter.dialect, table)),
  ].sort();
}

/** One column's values in `table`, read past every API. */
export async function columnValues(
  adapter: TestNextly["adapter"],
  table: string,
  column: string
): Promise<unknown[]> {
  const rows = await adapter.executeQuery<Record<string, unknown>>(
    `SELECT ${adapter.dialect === "mysql" ? `\`${column}\`` : `"${column}"`} AS v FROM ${adapter.dialect === "mysql" ? `\`${table}\`` : `"${table}"`}`
  );
  return rows.map(row => row.v);
}
