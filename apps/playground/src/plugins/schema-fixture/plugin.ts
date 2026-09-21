/**
 * A fixture plugin that exercises the schema-extension surface end to end.
 *
 * It declares two tables with the DSL, adds an index to a collection through a
 * hook, and reads and writes through `ctx.db` — which is the whole of P2-A
 * from a plugin author's side. Kept in the playground because a surface nobody
 * uses is a surface nobody notices breaking.
 *
 * Registered behind `NEXTLY_SCHEMA_FIXTURE=1` so the default `pnpm dev:app`
 * stays exactly as it was: this creates real tables, and a contributor running
 * the harness to look at something else should not find them.
 */
import { definePlugin } from "@nextlyhq/plugin-sdk";
import { col, defineTable } from "@nextlyhq/plugin-sdk/schema";

/** Notes, with a unique title per author and a compound lookup index. */
export const notes = defineTable(
  "notes",
  {
    id: col.id(),
    authorId: col.ref("users"),
    title: col.shortText(),
    body: col.longText({ nullable: true }),
    pinned: col.boolean({ default: false }),
    rank: col.integer({ default: 0 }),
    score: col.decimal(10, 2, { nullable: true }),
    metadata: col.json<{ source?: string }>({ nullable: true }),
    ...col.timestamps(),
  },
  {
    indexes: [
      // Compound and unique: exercises the ordered-column naming and the
      // MySQL key-width rule at once.
      { columns: ["authorId", "title"], unique: true },
      { columns: ["pinned"] },
    ],
  }
);

/** Tags, to prove two tables from one plugin both reach the database. */
export const tags = defineTable(
  "tags",
  {
    id: col.id(),
    label: col.varchar(64),
    ...col.timestamps(),
  },
  { indexes: [{ columns: ["label"], unique: true }] }
);

export const schemaFixturePlugin = definePlugin({
  name: "schema-fixture",
  version: "0.0.0",
  nextly: "*",
  contributes: {
    schema: {
      prefix: "fx",
      tables: [notes, tags],
      extend: [
        ({ schema }) => {
          // An index on a table this plugin does not own. Allowed for entity
          // tables, and carried by the APP's migrations — which is the case
          // worth having a fixture for, because nothing else exercises it.
          const posts = schema.getTable("dc_posts");
          if (posts) {
            schema.extendTable("dc_posts", {
              indexes: [{ columns: ["created_at"] }],
            });
          }
        },
      ],
    },
  },
});
