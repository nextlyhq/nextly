// `upsert` against a real MySQL database: a new key inserts, an existing key
// updates the columns named, and naming no column keeps the existing row —
// the "write once" a caller inside a transaction needs, which must leave the
// transaction usable after a repeat.
//
// The SQLite and PostgreSQL adapters carry the same cases, so the three
// dialects answer one contract.

import type { TableDefinition } from "@nextlyhq/adapter-drizzle/types";
import { int, mysqlTable, uniqueIndex, varchar } from "drizzle-orm/mysql-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createMySqlAdapter, type MySqlAdapter } from "../index";

const TABLE = "int_upsert_mysql";
const TEST_DB_URL = process.env.TEST_MYSQL_URL;

const TABLE_DEFINITION: TableDefinition = {
  name: TABLE,
  columns: [
    { name: "id", type: "varchar(36)", primaryKey: true },
    { name: "key", type: "varchar(64)", nullable: false, unique: true },
    { name: "label", type: "varchar(64)" },
    { name: "slug", type: "varchar(64)", unique: true },
    { name: "grp", type: "varchar(64)" },
    { name: "pos", type: "int" },
  ],
};

const things = mysqlTable(
  TABLE,
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    key: varchar("key", { length: 64 }).notNull().unique(),
    label: varchar("label", { length: 64 }),
    slug: varchar("slug", { length: 64 }).unique(),
    grp: varchar("grp", { length: 64 }),
    pos: int("pos"),
  },
  // Declared on the model as well as created in the database, so an adapter
  // that checks the conflict target against the table's keys can see it.
  table => [uniqueIndex("int_upsert_grp_pos_uidx").on(table.grp, table.pos)]
);

interface Row {
  id: string;
  key: string;
  label: string | null;
}

describe.skipIf(!TEST_DB_URL)("MySQL upsert", () => {
  let adapter: MySqlAdapter;

  const rows = () =>
    adapter.executeQuery<Row>(
      `SELECT id, \`key\`, label FROM ${TABLE} ORDER BY id`
    );

  beforeAll(async () => {
    adapter = createMySqlAdapter({ url: TEST_DB_URL as string });
    await adapter.connect();
    await adapter.executeQuery(`DROP TABLE IF EXISTS ${TABLE}`);
    await adapter.createTable(TABLE_DEFINITION);
    // The composite key the composite-key case targets, created by statement
    // because the table definition helper does not create indexes everywhere.
    await adapter.executeQuery(
      `CREATE UNIQUE INDEX int_upsert_grp_pos_uidx ON ${TABLE} (grp, pos)`
    );
    adapter.setTableResolver({
      getTable: (name: string) => (name === TABLE ? things : null),
    });
  });

  beforeEach(async () => {
    await adapter.executeQuery(`DELETE FROM ${TABLE}`);
  });

  afterAll(async () => {
    await adapter.executeQuery(`DROP TABLE IF EXISTS ${TABLE}`);
    await adapter.disconnect();
  });

  it("inserts a new key and returns the stored row", async () => {
    const stored = await adapter.upsert<Row>(
      TABLE,
      { id: "a", key: "k1", label: "first" },
      { conflictColumns: ["key"] }
    );
    expect(stored).toMatchObject({ id: "a", key: "k1", label: "first" });
    expect(await rows()).toEqual([{ id: "a", key: "k1", label: "first" }]);
  });

  it("updates the named columns of an existing key and returns the stored row", async () => {
    await adapter.upsert(
      TABLE,
      { id: "a", key: "k1", label: "first" },
      {
        conflictColumns: ["key"],
      }
    );
    const stored = await adapter.upsert<Row>(
      TABLE,
      { id: "b", key: "k1", label: "second" },
      { conflictColumns: ["key"], updateColumns: ["label"] }
    );
    // The existing row, updated: its id is kept, its label replaced.
    expect(stored).toMatchObject({ id: "a", key: "k1", label: "second" });
    expect(await rows()).toEqual([{ id: "a", key: "k1", label: "second" }]);
  });

  it("keeps the existing row unchanged when no column is left to update", async () => {
    await adapter.upsert(
      TABLE,
      { id: "a", key: "k1", label: "first" },
      {
        conflictColumns: ["key"],
      }
    );
    const stored = await adapter.upsert<Row>(
      TABLE,
      { id: "b", key: "k1", label: "second" },
      { conflictColumns: ["key"], updateColumns: [] }
    );
    // The row that stands is returned, so a caller can tell by its id that
    // this call did not create it.
    expect(stored).toMatchObject({ id: "a", key: "k1", label: "first" });
    expect(await rows()).toEqual([{ id: "a", key: "k1", label: "first" }]);
  });

  it("repeats inside a transaction and leaves the transaction usable", async () => {
    await adapter.transaction(async tx => {
      await tx.upsert(
        TABLE,
        { id: "a", key: "k1", label: "first" },
        {
          conflictColumns: ["key"],
          updateColumns: [],
        }
      );
      const again = await tx.upsert<Row>(
        TABLE,
        { id: "b", key: "k1", label: "repeat" },
        { conflictColumns: ["key"], updateColumns: [] }
      );
      expect(again).toMatchObject({ id: "a" });
      await tx.upsert(
        TABLE,
        { id: "c", key: "k2", label: "next" },
        {
          conflictColumns: ["key"],
          updateColumns: [],
        }
      );
    });
    expect(await rows()).toEqual([
      { id: "a", key: "k1", label: "first" },
      { id: "c", key: "k2", label: "next" },
    ]);
  });
  it("refuses a collision on another unique key, and changes no row", async () => {
    // The upsert is keyed on `key`. A row colliding on `slug` instead is not
    // the row it targets: PostgreSQL and SQLite refuse it, and so must MySQL,
    // whose duplicate-key clause would otherwise update that other row.
    await adapter.upsert(
      TABLE,
      { id: "a", key: "k1", slug: "s1", label: "first" },
      {
        conflictColumns: ["key"],
      }
    );
    await expect(
      adapter.upsert(
        TABLE,
        { id: "b", key: "k2", slug: "s1", label: "second" },
        {
          conflictColumns: ["key"],
        }
      )
    ).rejects.toThrow();
    expect(await rows()).toEqual([{ id: "a", key: "k1", label: "first" }]);
  });

  it("reads back the row matching every column of a composite key", async () => {
    // Two rows share the key's first column, so a read-back by that column
    // alone could return the wrong one.
    await adapter.upsert(
      TABLE,
      { id: "a", key: "k1", grp: "g", pos: 1, label: "one" },
      {
        conflictColumns: ["grp", "pos"],
      }
    );
    await adapter.upsert(
      TABLE,
      { id: "b", key: "k2", grp: "g", pos: 2, label: "two" },
      {
        conflictColumns: ["grp", "pos"],
      }
    );
    const stored = await adapter.upsert<Row>(
      TABLE,
      { id: "c", key: "k3", grp: "g", pos: 2, label: "two, again" },
      { conflictColumns: ["grp", "pos"], updateColumns: ["label"] }
    );
    expect(stored).toMatchObject({ id: "b", label: "two, again" });
    // And only that row: the other one sharing the first column is untouched.
    expect(await rows()).toEqual([
      { id: "a", key: "k1", label: "one" },
      { id: "b", key: "k2", label: "two, again" },
    ]);
  });

  it("inserts a row whose conflict key is null, since a null never conflicts", async () => {
    await adapter.upsert(
      TABLE,
      { id: "a", key: "k1", slug: null, label: "first" },
      {
        conflictColumns: ["slug"],
      }
    );
    await adapter.upsert(
      TABLE,
      { id: "b", key: "k2", slug: null, label: "second" },
      {
        conflictColumns: ["slug"],
      }
    );
    expect((await rows()).map(row => row.id)).toEqual(["a", "b"]);
  });
  it("keeps an existing row without running its update triggers", async () => {
    // A no-op duplicate-key assignment would still fire BEFORE/AFTER UPDATE
    // triggers; keeping the row must not touch it at all.
    await adapter.executeQuery(
      `CREATE TRIGGER int_upsert_touch BEFORE UPDATE ON ${TABLE} FOR EACH ROW SET NEW.label = 'touched'`
    );
    try {
      await adapter.upsert(
        TABLE,
        { id: "a", key: "k1", label: "first" },
        {
          conflictColumns: ["key"],
        }
      );
      await adapter.upsert(
        TABLE,
        { id: "b", key: "k1", label: "second" },
        {
          conflictColumns: ["key"],
          updateColumns: [],
        }
      );
      expect(await rows()).toEqual([{ id: "a", key: "k1", label: "first" }]);
    } finally {
      await adapter.executeQuery("DROP TRIGGER IF EXISTS int_upsert_touch");
    }
  });
  it("refuses conflict columns that are not a unique key", async () => {
    // A target that is not unique could match several rows; PostgreSQL and
    // SQLite refuse it as an ON CONFLICT target, and so must every dialect.
    await expect(
      adapter.upsert(
        TABLE,
        { id: "a", key: "k1", label: "first" },
        {
          conflictColumns: ["label"],
        }
      )
    ).rejects.toThrow();
    expect(await rows()).toEqual([]);
  });

  it("returns the stored row for a null conflict key", async () => {
    const stored = await adapter.upsert<Row>(
      TABLE,
      { id: "a", key: "k1", slug: null, label: "first" },
      { conflictColumns: ["slug"] }
    );
    expect(stored).toMatchObject({ id: "a", key: "k1", label: "first" });
  });
  it("refuses an upsert that leaves a conflict column for the database to fill", async () => {
    // MySQL cannot look a row up by a key value the database would only
    // supply itself; said, rather than treating the omission as NULL.
    await expect(
      adapter.upsert(
        TABLE,
        { id: "a", key: "k1", label: "first" },
        {
          conflictColumns: ["slug"],
        }
      )
    ).rejects.toThrow(/needs a value for every conflict column/);
  });

  it("takes a row another transaction committed after this one's snapshot", async () => {
    // Repeatable read: this transaction's first read fixes its snapshot. A
    // row with the same key committed by someone else after that is invisible
    // to a plain select here, so only a locking (current) read can find the
    // row the duplicate-key error is about.
    await adapter.transaction(async tx => {
      await tx.select(TABLE, {});
      await adapter.upsert(
        TABLE,
        { id: "theirs", key: "k1", label: "theirs" },
        {
          conflictColumns: ["key"],
        }
      );
      const stored = await tx.upsert<Row>(
        TABLE,
        { id: "mine", key: "k1", label: "mine" },
        { conflictColumns: ["key"], updateColumns: [] }
      );
      expect(stored).toMatchObject({ id: "theirs", label: "theirs" });
    });
  });
});
