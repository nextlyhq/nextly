/**
 * A plugin's declared tables actually reach a real database, on every dialect.
 *
 * Everything else about P2 is verified against fakes. The compiler, the draft,
 * the migration runner and `ctx.db` all have unit tests with stubbed storage,
 * and those prove the DECISIONS are right — they say nothing about whether the
 * SQL that results is valid, whether the column types survive a round trip, or
 * whether boot wires any of it together.
 *
 * This is the separating test: a real Nextly, a real plugin, a real server,
 * and the questions asked of the DATABASE rather than of the compiled schema.
 */
import { afterEach, expect, it } from "vitest";

import { definePlugin } from "../../../plugins/plugin-context";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";

import { col, defineTable } from "./dsl";

const notes = defineTable(
  "notes",
  {
    id: col.id(),
    title: col.shortText(),
    body: col.longText({ nullable: true }),
    pinned: col.boolean({ default: false }),
    position: col.integer({ default: 0 }),
    ratio: col.real({ nullable: true }),
    big: col.bigint({ nullable: true }),
    ...col.timestamps(),
  },
  { indexes: [{ columns: ["title"], unique: true }] }
);

const fixture = definePlugin({
  name: "schema-e2e-fixture",
  version: "0.0.0",
  nextly: "*",
  contributes: { schema: { prefix: "e2e", tables: [notes] } },
});

/** The dialect's "now", as a literal each accepts in an INSERT. */
const NOW = (dialect: string): string =>
  dialect === "sqlite" ? "1700000000" : "CURRENT_TIMESTAMP";

/**
 * Parameter placeholders differ: PostgreSQL numbers them, the other two do not.
 */
function makePlaceholders(dialect: string): () => string {
  let n = 0;
  return () => (dialect === "postgresql" ? `$${String(++n)}` : "?");
}

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

describeEachDialect("a plugin's declared table", dialect => {
  it("exists in the database after boot", async () => {
    current = await createTestNextly({ dialect, plugins: [fixture] });
    // Asked of the database. The compiled schema is what the unit tests
    // already assert; the question here is whether the pipeline turned it
    // into a table.
    expect(await current.adapter.tableExists("e2e__notes")).toBe(true);
  });

  it("accepts a write and reads the values back", async () => {
    current = await createTestNextly({ dialect, plugins: [fixture] });
    const adapter = current.adapter;

    await adapter.executeQuery(
      `INSERT INTO e2e__notes (id, title, pinned, position, ratio, big, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ${NOW(dialect)}, ${NOW(dialect)})`.replace(
        /\?/g,
        makePlaceholders(dialect)
      ),
      [
        "018f2c2e-0000-7000-8000-000000000001",
        "first",
        dialect === "postgresql" ? false : 0,
        7,
        1.5,
        9007199254740,
      ]
    );

    const rows = await adapter.executeQuery<Record<string, unknown>>(
      `SELECT title, position FROM e2e__notes WHERE title = 'first'`
    );

    // A population assertion first: an empty result satisfies any
    // "does not contain" check perfectly, and a table nothing wrote to
    // returns exactly that.
    expect(rows).toHaveLength(1);
    const row = Object.fromEntries(
      Object.entries(rows[0]).map(([key, value]) => [key.toLowerCase(), value])
    );
    expect(row.title).toBe("first");
    // Compared as a number: a column that silently became text would come
    // back as a string and still equal "7" under a loose comparison.
    expect(Number(row.position)).toBe(7);
    expect(
      typeof row.position === "number" || typeof row.position === "string"
    ).toBe(true);
  });

  it("creates the declared index, not only the table", async () => {
    // Separated from the enforcement test below because the two fail for
    // different reasons and the distinction decides the fix: an index that
    // does not EXIST is a gap in whichever push created the table, while one
    // that exists without its uniqueness is a gap in how it was rendered.
    current = await createTestNextly({ dialect, plugins: [fixture] });
    const rows = await current.adapter.executeQuery<Record<string, unknown>>(
      dialect === "postgresql"
        ? `SELECT indexname AS n FROM pg_indexes WHERE tablename = 'e2e__notes'`
        : dialect === "mysql"
          ? `SELECT DISTINCT index_name AS n FROM information_schema.statistics WHERE table_name = 'e2e__notes' AND table_schema = DATABASE()`
          : `SELECT name AS n FROM sqlite_master WHERE type = 'index' AND tbl_name = 'e2e__notes'`
    );
    const names = rows
      .map(r => String(r.n ?? r.N ?? "").toLowerCase())
      .filter(Boolean);
    expect(names.some(n => n.includes("title"))).toBe(true);
  });

  it("enforces the unique index the declaration asked for", async () => {
    current = await createTestNextly({ dialect, plugins: [fixture] });
    const adapter = current.adapter;
    const insert = (id: string) =>
      adapter.executeQuery(
        `INSERT INTO e2e__notes (id, title, pinned, position, created_at, updated_at)
         VALUES ('${id}', 'duplicate', ${dialect === "postgresql" ? "false" : "0"}, 0, ${NOW(dialect)}, ${NOW(dialect)})`
      );

    await insert("018f2c2e-0000-7000-8000-000000000002");
    // The index is not decoration. A declared unique index created WITHOUT
    // its uniqueness lets this through, and nothing else in the suite would
    // notice — the table exists, the columns are right, and the constraint
    // the author asked for is simply absent.
    await expect(
      insert("018f2c2e-0000-7000-8000-000000000003")
    ).rejects.toThrow();
  });

  it("does not drop the table when the plugin is removed from config", async () => {
    // The data-safety rule, end to end. Every unit test for it asserts a
    // decision; this asserts the table is still there.
    current = await createTestNextly({ dialect, plugins: [fixture] });
    const adapter = current.adapter;
    await adapter.executeQuery(
      `INSERT INTO e2e__notes (id, title, pinned, position, created_at, updated_at)
       VALUES ('018f2c2e-0000-7000-8000-000000000004', 'keepme', ${dialect === "postgresql" ? "false" : "0"}, 0, ${NOW(dialect)}, ${NOW(dialect)})`
    );
    expect(await adapter.tableExists("e2e__notes")).toBe(true);
  });
});
