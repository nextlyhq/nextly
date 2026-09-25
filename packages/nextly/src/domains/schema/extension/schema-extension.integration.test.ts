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
import { afterEach, describe, expect, it } from "vitest";

import {
  definePlugin,
  type PluginContext,
} from "../../../plugins/plugin-context";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  getConfiguredTestDialects,
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

const authors = defineTable("authors", { id: col.id(), name: col.shortText() });
const links = defineTable(
  "links",
  { id: col.id(), userId: col.shortText(), authorId: col.shortText() },
  {
    foreignKeys: [
      // A CORE table, outside the extension bundle.
      { columns: ["userId"], references: { table: "users", columns: ["id"] } },
      // A table in the same bundle.
      {
        columns: ["authorId"],
        references: { table: "fk__authors", columns: ["id"] },
        onDelete: "cascade",
      },
    ],
  }
);
const fkFixture = definePlugin({
  name: "schema-e2e-fk-fixture",
  version: "0.0.0",
  nextly: "*",
  contributes: { schema: { prefix: "fk", tables: [authors, links] } },
});

// SQLite only: it is the one dialect that takes a foreign key in CREATE TABLE
// or not at all. The others add each constraint with its own statement, so a
// reference compiled away on the kit table cost them nothing and cost SQLite
// the constraint, silently. Asked of the database, because the compiled table
// looked right while the DDL named no local column.
(getConfiguredTestDialects().includes("sqlite") ? describe : describe.skip)(
  "a plugin table's foreign keys (sqlite)",
  () => {
    it("creates both, to a core table and to its own", async () => {
      current = await createTestNextly({
        dialect: "sqlite",
        plugins: [fkFixture],
      });
      const rows = await current.adapter.executeQuery<Record<string, unknown>>(
        `PRAGMA foreign_key_list(fk__links)`
      );
      const found = rows
        .map(
          row => `${String(row.from)}->${String(row.table)}.${String(row.to)}`
        )
        .sort();
      expect(found).toEqual(["author_id->fk__authors.id", "user_id->users.id"]);
    });
  }
);

const txNotes = defineTable("notes", {
  id: col.id(),
  title: col.shortText(),
});
let txContext: PluginContext | undefined;
const txFixture = definePlugin({
  name: "schema-e2e-tx-fixture",
  version: "0.0.0",
  nextly: "*",
  contributes: { schema: { prefix: "txq", tables: [txNotes] } },
  init: ctx => {
    txContext = ctx;
  },
});

// Every dialect, because the defect this pins is invisible on one: SQLite has
// a single connection, so a relational read that escaped the transaction
// still saw its writes there. On PostgreSQL and MySQL it ran on a pooled
// connection and could not — and the transaction's own handle had no
// relations config, so `tx.query.<table>` did not exist at all.
describeEachDialect("ctx.db.transaction's relational reads", dialect => {
  it("see the transaction's uncommitted writes, and roll back with it", async () => {
    txContext = undefined;
    current = await createTestNextly({ dialect, plugins: [txFixture] });
    // Read through a function: the assignment happens inside `init`, which
    // control-flow analysis cannot see, so it would narrow to `undefined`.
    const captured = (): PluginContext | undefined => txContext;
    const db = captured()?.db;
    if (!db) throw new Error("the plugin's init never ran");

    const seen = await db
      .transaction(async tx => {
        await tx.insert(txNotes, { title: "inside" });
        const rows = await tx.query["txq__notes"].findMany();
        throw Object.assign(new Error("roll back"), { rows });
      })
      .catch(
        (error: {
          rows?: Array<Record<string, unknown>>;
          cause?: { rows?: Array<Record<string, unknown>> };
        }) => {
          // The adapter wraps what the callback threw, keeping it as the
          // cause. Only the deliberate rollback carries `rows`; anything
          // else is a real failure and must surface as one.
          const rows = error.rows ?? error.cause?.rows;
          if (rows === undefined) throw error;
          return rows;
        }
      );

    // Population first: an empty read would satisfy the rollback check below
    // for the wrong reason.
    expect(seen?.map(row => row.title)).toEqual(["inside"]);
    expect(await db.query["txq__notes"].findMany()).toEqual([]);
  });
});
