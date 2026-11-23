/**
 * A schema push that removes a field of an entity declared in code never takes with it an index a
 * plugin built on the field's column. The push is refused before anything runs, naming the field,
 * the plugin, the element, its kind and its table, and the column, the index and their values are
 * left as they were. A field whose column nothing else stands on is still removed.
 *
 * As it happens: the app declares a collection in code, a plugin's schema hook indexes one of its
 * columns, and the app then removes that field and the change is pushed, as a restart, an HMR
 * reload and `db:sync` push it. On SQLite, PostgreSQL and MySQL, because what a drop takes with it
 * differs between them: PostgreSQL drops the index silently, MySQL drops or narrows it, SQLite
 * rebuilds the table without it.
 */
import { afterEach, expect, it, vi } from "vitest";

import { defineCollection, text } from "../../../../config";
import { describeEachDialect } from "../../../../plugins/__tests__/helpers/dialect-matrix";
import { definePlugin } from "../../../../plugins/plugin-context";
import {
  createTestNextly,
  type TestDialect,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import { introspectLiveSnapshot } from "../../pipeline/diff/introspect-live";
import { applyDesiredSchema } from "../../pipeline/index";

const SLUG = "rk_posts";
const TABLE = `dc_${SLUG}`;
const PLUGIN = "@test/code-indexer";

/** The plugin: an index on the collection's own `code` column. */
const indexer = definePlugin({
  name: PLUGIN,
  version: "1.0.0",
  nextly: ">=0.0.0",
  contributes: {
    schema: {
      extend: [
        ({ schema }) => {
          schema.extendTable(TABLE, { indexes: [{ columns: ["code"] }] });
        },
      ],
    },
  },
});

const fields = (withCode: boolean, withNote = true) => [
  text({ name: "title" }),
  ...(withCode ? [text({ name: "code" })] : []),
  ...(withNote ? [text({ name: "note" })] : []),
];

let handle: TestNextly | undefined;

afterEach(async () => {
  await handle?.destroy();
  handle = undefined;
  vi.unstubAllEnvs();
});

/** The table's column names and the columns each index stands on. */
async function shapeOf(instance: TestNextly, dialect: TestDialect) {
  const snapshot = await introspectLiveSnapshot(
    instance.adapter.getDrizzle(),
    dialect,
    [TABLE]
  );
  const table = snapshot.tables.find(t => t.name === TABLE);
  return {
    columns: (table?.columns ?? []).map(c => c.name).sort(),
    indexes: (table?.indexes ?? [])
      .map(index => index.columns.join(","))
      .sort(),
  };
}

/** The push of `fieldList` for the collection, as a restart or a reload pushes it. */
function push(fieldList: ReturnType<typeof fields>) {
  return applyDesiredSchema(
    {
      collections: {
        [SLUG]: { slug: SLUG, tableName: TABLE, fields: fieldList },
      },
      singles: {},
      components: {},
    },
    "code",
    { promptChannel: "terminal" }
  );
}

describeEachDialect(
  "a schema push keeps what a plugin built on a removed field's column",
  dialect => {
    it("refuses removing a field whose column a plugin's index stands on, changing nothing", async () => {
      handle = await createTestNextly({
        dialect,
        collections: [defineCollection({ slug: SLUG, fields: fields(true) })],
        plugins: [indexer],
      });
      const before = await shapeOf(handle, dialect);
      // The fixture's control: the plugin's index stands on `code`.
      expect(before.indexes).toContain("code");
      // The consent to delete `code`'s values, as a deploy gives it: what is refused is the index.
      vi.stubEnv("NEXTLY_ACCEPT_DATA_LOSS", `${TABLE}.code`);

      const pushed = await push(fields(false));

      expect(pushed.success, JSON.stringify(pushed)).toBe(false);
      const message = pushed.success ? "" : pushed.error.message;
      for (const part of ["code", PLUGIN, "index", TABLE]) {
        expect(message).toContain(part);
      }
      expect(await shapeOf(handle, dialect)).toEqual(before);
    });

    it("removes a field whose column nothing else stands on, keeping the plugin's index", async () => {
      handle = await createTestNextly({
        dialect,
        collections: [defineCollection({ slug: SLUG, fields: fields(true) })],
        plugins: [indexer],
      });
      vi.stubEnv("NEXTLY_ACCEPT_DATA_LOSS", `${TABLE}.note`);

      const pushed = await push(fields(true, false));

      expect(pushed.success, JSON.stringify(pushed)).toBe(true);
      const after = await shapeOf(handle, dialect);
      expect(after.columns).not.toContain("note");
      expect(after.indexes).toContain("code");
    });
  }
);
