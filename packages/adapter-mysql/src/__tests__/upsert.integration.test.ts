// `upsert` against a real MySQL database: a new key inserts, an existing key
// updates the columns named, and naming no column keeps the existing row —
// the "write once" a caller inside a transaction needs, which must leave the
// transaction usable after a repeat.
//
// The SQLite and PostgreSQL adapters carry the same cases, so the three
// dialects answer one contract. MySQL keeps it only where the conflict target
// is the table's one unique key besides the primary key, so each table here
// has exactly one, and a table with two is the refusal case.

import type { TableDefinition } from "@nextlyhq/adapter-drizzle/types";
import { int, mysqlTable, uniqueIndex, varchar } from "drizzle-orm/mysql-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createMySqlAdapter, type MySqlAdapter } from "../index";

const KEYED = "int_upsert_mysql";
const NULLABLE = "int_upsert_mysql_nullable";
const PAIR = "int_upsert_mysql_pair";
const MANY = "int_upsert_mysql_many";
const SERIAL = "int_upsert_mysql_serial";
const TABLES = [KEYED, NULLABLE, PAIR, MANY, SERIAL];
const TEST_DB_URL = process.env.TEST_MYSQL_URL;

const DEFINITIONS: TableDefinition[] = [
  {
    name: KEYED,
    columns: [
      { name: "id", type: "varchar(36)", primaryKey: true },
      { name: "key", type: "varchar(64)", nullable: false, unique: true },
      { name: "label", type: "varchar(64)" },
    ],
  },
  {
    name: NULLABLE,
    columns: [
      { name: "id", type: "varchar(36)", primaryKey: true },
      { name: "slug", type: "varchar(64)", unique: true },
      { name: "label", type: "varchar(64)" },
    ],
  },
  {
    name: PAIR,
    columns: [
      { name: "id", type: "varchar(36)", primaryKey: true },
      { name: "grp", type: "varchar(64)" },
      { name: "pos", type: "int" },
      { name: "label", type: "varchar(64)" },
    ],
  },
  {
    name: MANY,
    columns: [
      { name: "id", type: "varchar(36)", primaryKey: true },
      { name: "key", type: "varchar(64)", nullable: false, unique: true },
      { name: "slug", type: "varchar(64)", unique: true },
      { name: "label", type: "varchar(64)" },
    ],
  },
];

// An auto-increment key is created by statement: the table definition helper
// spells a primary key as a given value.
const SERIAL_DDL = `CREATE TABLE ${SERIAL} (id INT AUTO_INCREMENT PRIMARY KEY, slug VARCHAR(64) UNIQUE, label VARCHAR(64))`;

const models = {
  [SERIAL]: mysqlTable(SERIAL, {
    id: int("id").autoincrement().primaryKey(),
    slug: varchar("slug", { length: 64 }).unique(),
    label: varchar("label", { length: 64 }),
  }),
  [KEYED]: mysqlTable(KEYED, {
    id: varchar("id", { length: 36 }).primaryKey(),
    key: varchar("key", { length: 64 }).notNull().unique(),
    label: varchar("label", { length: 64 }),
  }),
  [NULLABLE]: mysqlTable(NULLABLE, {
    id: varchar("id", { length: 36 }).primaryKey(),
    slug: varchar("slug", { length: 64 }).unique(),
    label: varchar("label", { length: 64 }),
  }),
  [PAIR]: mysqlTable(
    PAIR,
    {
      id: varchar("id", { length: 36 }).primaryKey(),
      grp: varchar("grp", { length: 64 }),
      pos: int("pos"),
      label: varchar("label", { length: 64 }),
    },
    table => [uniqueIndex("int_upsert_grp_pos_uidx").on(table.grp, table.pos)]
  ),
  [MANY]: mysqlTable(MANY, {
    id: varchar("id", { length: 36 }).primaryKey(),
    key: varchar("key", { length: 64 }).notNull().unique(),
    slug: varchar("slug", { length: 64 }).unique(),
    label: varchar("label", { length: 64 }),
  }),
};

interface Row {
  id: string;
  key: string;
  label: string | null;
}

describe.skipIf(!TEST_DB_URL)("MySQL upsert", () => {
  let adapter: MySqlAdapter;

  const rows = (table = KEYED) =>
    adapter.executeQuery<{ id: string; label: string | null }>(
      table === KEYED
        ? `SELECT id, \`key\`, label FROM ${KEYED} ORDER BY id`
        : `SELECT id, label FROM ${table} ORDER BY id`
    );

  beforeAll(async () => {
    adapter = createMySqlAdapter({ url: TEST_DB_URL as string });
    await adapter.connect();
    for (const definition of DEFINITIONS) {
      await adapter.executeQuery(`DROP TABLE IF EXISTS ${definition.name}`);
      await adapter.createTable(definition);
    }
    await adapter.executeQuery(`DROP TABLE IF EXISTS ${SERIAL}`);
    await adapter.executeQuery(SERIAL_DDL);
    // The composite key, created by statement because the table definition
    // helper does not create indexes everywhere.
    await adapter.executeQuery(
      `CREATE UNIQUE INDEX int_upsert_grp_pos_uidx ON ${PAIR} (grp, pos)`
    );
    adapter.setTableResolver({
      getTable: (name: string) => models[name as keyof typeof models] ?? null,
    });
  });

  beforeEach(async () => {
    for (const table of TABLES) {
      await adapter.executeQuery(`DELETE FROM ${table}`);
    }
  });

  afterAll(async () => {
    for (const table of TABLES) {
      await adapter.executeQuery(`DROP TABLE IF EXISTS ${table}`);
    }
    await adapter.disconnect();
  });

  it("inserts a new key and returns the stored row", async () => {
    const stored = await adapter.upsert<Row>(
      KEYED,
      { id: "a", key: "k1", label: "first" },
      { conflictColumns: ["key"] }
    );
    expect(stored).toMatchObject({ id: "a", key: "k1", label: "first" });
    expect(await rows()).toEqual([{ id: "a", key: "k1", label: "first" }]);
  });

  it("updates the named columns of an existing key and returns the stored row", async () => {
    await adapter.upsert(
      KEYED,
      { id: "a", key: "k1", label: "first" },
      { conflictColumns: ["key"] }
    );
    const stored = await adapter.upsert<Row>(
      KEYED,
      { id: "b", key: "k1", label: "second" },
      { conflictColumns: ["key"], updateColumns: ["label"] }
    );
    // The existing row, updated: its id is kept, its label replaced.
    expect(stored).toMatchObject({ id: "a", key: "k1", label: "second" });
    expect(await rows()).toEqual([{ id: "a", key: "k1", label: "second" }]);
  });

  it("keeps the existing row unchanged when no column is left to update", async () => {
    await adapter.upsert(
      KEYED,
      { id: "a", key: "k1", label: "first" },
      { conflictColumns: ["key"] }
    );
    const stored = await adapter.upsert<Row>(
      KEYED,
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
        KEYED,
        { id: "a", key: "k1", label: "first" },
        { conflictColumns: ["key"], updateColumns: [] }
      );
      const again = await tx.upsert<Row>(
        KEYED,
        { id: "b", key: "k1", label: "repeat" },
        { conflictColumns: ["key"], updateColumns: [] }
      );
      expect(again).toMatchObject({ id: "a" });
      await tx.upsert(
        KEYED,
        { id: "c", key: "k2", label: "next" },
        { conflictColumns: ["key"], updateColumns: [] }
      );
    });
    expect(await rows()).toEqual([
      { id: "a", key: "k1", label: "first" },
      { id: "c", key: "k2", label: "next" },
    ]);
  });

  it("refuses a table with another unique key before writing anything", async () => {
    // MySQL cannot tell a collision on `slug` from one on `key`, so it could
    // update a row the caller never targeted. The table is refused up front,
    // naming the other key and what to do instead.
    await expect(
      adapter.upsert(
        MANY,
        { id: "a", key: "k1", slug: "s1", label: "first" },
        { conflictColumns: ["key"] }
      )
    ).rejects.toThrow(
      /other unique keys \(int_upsert_mysql_many_slug_unique\)/
    );
    expect(await rows(MANY)).toEqual([]);
  });

  it("refuses a primary-key collision as a unique violation, and changes no row", async () => {
    // The one duplicate besides the target a permitted table can raise. No row
    // holds the target key, so it is refused as ON CONFLICT (key) refuses it,
    // with the kind a caller handles it by.
    await adapter.upsert(
      KEYED,
      { id: "a", key: "k1", label: "first" },
      { conflictColumns: ["key"] }
    );
    await expect(
      adapter.upsert(
        KEYED,
        { id: "a", key: "k2", label: "second" },
        { conflictColumns: ["key"] }
      )
    ).rejects.toMatchObject({ kind: "unique_violation" });
    expect(await rows()).toEqual([{ id: "a", key: "k1", label: "first" }]);
  });

  it("returns the stored row when an insert trigger rewrites the conflict key", async () => {
    // PostgreSQL's RETURNING gives the row as stored. A read-back by the
    // caller's conflict value would find nothing once a trigger changed it.
    await adapter.executeQuery(
      `CREATE TRIGGER int_upsert_prefix BEFORE INSERT ON ${KEYED} FOR EACH ROW SET NEW.\`key\` = CONCAT('t-', NEW.\`key\`)`
    );
    try {
      const stored = await adapter.upsert<Row>(
        KEYED,
        { id: "a", key: "k1", label: "first" },
        { conflictColumns: ["key"] }
      );
      expect(stored).toMatchObject({ id: "a", key: "t-k1", label: "first" });
    } finally {
      await adapter.executeQuery("DROP TRIGGER IF EXISTS int_upsert_prefix");
    }
  });

  it("returns the row when the update changes its primary key", async () => {
    // With no `updateColumns`, every given column is updated, the primary key
    // included, as ON CONFLICT DO UPDATE does on the other dialects. The row
    // is then found by its new key, not the one it had.
    await adapter.upsert(
      KEYED,
      { id: "a", key: "k1", label: "first" },
      { conflictColumns: ["key"] }
    );
    const stored = await adapter.upsert<Row>(
      KEYED,
      { id: "b", key: "k1", label: "second" },
      { conflictColumns: ["key"] }
    );
    expect(stored).toMatchObject({ id: "b", key: "k1", label: "second" });
    expect(await rows()).toEqual([{ id: "b", key: "k1", label: "second" }]);
  });

  it("returns the stored row when an update trigger rewrites the primary key", async () => {
    // The key the update left is not the one the trigger wrote, so the row is
    // found by the conflict value, which the trigger did not touch.
    await adapter.upsert(
      KEYED,
      { id: "a", key: "k1", label: "first" },
      { conflictColumns: ["key"] }
    );
    await adapter.executeQuery(
      `CREATE TRIGGER int_upsert_reid BEFORE UPDATE ON ${KEYED} FOR EACH ROW SET NEW.id = CONCAT('t-', OLD.id)`
    );
    try {
      const stored = await adapter.upsert<Row>(
        KEYED,
        { id: "b", key: "k1", label: "second" },
        { conflictColumns: ["key"], updateColumns: ["label"] }
      );
      expect(stored).toMatchObject({ id: "t-a", key: "k1", label: "second" });
    } finally {
      await adapter.executeQuery("DROP TRIGGER IF EXISTS int_upsert_reid");
    }
  });

  it("returns the stored row when an update trigger rewrites the conflict key", async () => {
    // Read back by the row's primary key: by the conflict value the update was
    // keyed on, the row a trigger re-keyed is not found.
    await adapter.upsert(
      KEYED,
      { id: "a", key: "k1", label: "first" },
      { conflictColumns: ["key"] }
    );
    await adapter.executeQuery(
      `CREATE TRIGGER int_upsert_rekey BEFORE UPDATE ON ${KEYED} FOR EACH ROW SET NEW.\`key\` = CONCAT('u-', OLD.\`key\`)`
    );
    try {
      const stored = await adapter.upsert<Row>(
        KEYED,
        { id: "b", key: "k1", label: "second" },
        { conflictColumns: ["key"], updateColumns: ["label"] }
      );
      expect(stored).toMatchObject({ id: "a", key: "u-k1", label: "second" });
    } finally {
      await adapter.executeQuery("DROP TRIGGER IF EXISTS int_upsert_rekey");
    }
  });

  it("lets exactly one of two concurrent inserts of one key report its own row", async () => {
    // Whether a call created the row is read from the id it returns: each
    // caller sends a fresh id, and only a caller whose insert ran gets its own
    // id back. A read-back of the row that stands can only ever return the
    // other caller's, so it can never report "created" for a call that kept.
    const outcomes = await Promise.all(
      ["first", "second"].map(id =>
        adapter.upsert<Row>(
          KEYED,
          { id, key: "k1", label: id },
          { conflictColumns: ["key"], updateColumns: [] }
        )
      )
    );
    const created = outcomes.filter(
      (row, i) => row?.id === ["first", "second"][i]
    );
    expect(created).toHaveLength(1);
    expect(outcomes.map(row => row?.id)).toEqual([
      created[0]?.id,
      created[0]?.id,
    ]);
    expect(await rows()).toHaveLength(1);
  });

  it("returns the generated key when the caller passes it as undefined", async () => {
    // The caller's undefined id must not hide the one MySQL generated, or the
    // row could not be read back and the input would be returned instead.
    const stored = await adapter.upsert<{ id: number; label: string }>(
      SERIAL,
      { id: undefined, slug: null, label: "first" },
      { conflictColumns: ["slug"] }
    );
    expect(stored).toMatchObject({ label: "first" });
    expect(typeof stored.id).toBe("number");
  });

  it("reads back the row matching every column of a composite key", async () => {
    // Two rows share the key's first column, so a read-back by that column
    // alone could return the wrong one.
    await adapter.upsert(
      PAIR,
      { id: "a", grp: "g", pos: 1, label: "one" },
      { conflictColumns: ["grp", "pos"] }
    );
    await adapter.upsert(
      PAIR,
      { id: "b", grp: "g", pos: 2, label: "two" },
      { conflictColumns: ["grp", "pos"] }
    );
    const stored = await adapter.upsert<Row>(
      PAIR,
      { id: "c", grp: "g", pos: 2, label: "two, again" },
      { conflictColumns: ["grp", "pos"], updateColumns: ["label"] }
    );
    expect(stored).toMatchObject({ id: "b", label: "two, again" });
    // And only that row: the other one sharing the first column is untouched.
    expect(await rows(PAIR)).toEqual([
      { id: "a", label: "one" },
      { id: "b", label: "two, again" },
    ]);
  });

  it("inserts a row whose conflict key is null, since a null never conflicts", async () => {
    await adapter.upsert(
      NULLABLE,
      { id: "a", slug: null, label: "first" },
      { conflictColumns: ["slug"] }
    );
    await adapter.upsert(
      NULLABLE,
      { id: "b", slug: null, label: "second" },
      { conflictColumns: ["slug"] }
    );
    expect((await rows(NULLABLE)).map(row => row.id)).toEqual(["a", "b"]);
  });

  it("returns the stored row for a null conflict key", async () => {
    const stored = await adapter.upsert<Row>(
      NULLABLE,
      { id: "a", slug: null, label: "first" },
      { conflictColumns: ["slug"] }
    );
    expect(stored).toMatchObject({ id: "a", label: "first" });
  });

  it("keeps an existing row without running its update triggers", async () => {
    // A no-op duplicate-key assignment would still fire BEFORE/AFTER UPDATE
    // triggers; keeping the row must not touch it at all.
    await adapter.executeQuery(
      `CREATE TRIGGER int_upsert_touch BEFORE UPDATE ON ${KEYED} FOR EACH ROW SET NEW.label = 'touched'`
    );
    try {
      await adapter.upsert(
        KEYED,
        { id: "a", key: "k1", label: "first" },
        { conflictColumns: ["key"] }
      );
      await adapter.upsert(
        KEYED,
        { id: "b", key: "k1", label: "second" },
        { conflictColumns: ["key"], updateColumns: [] }
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
        KEYED,
        { id: "a", key: "k1", label: "first" },
        { conflictColumns: ["label"] }
      )
    ).rejects.toThrow(/not a primary or unique key/);
    expect(await rows()).toEqual([]);
  });

  it("refuses an upsert that leaves a conflict column for the database to fill", async () => {
    // MySQL cannot look a row up by a key value the database would only
    // supply itself; said, rather than treating the omission as NULL.
    await expect(
      adapter.upsert(
        NULLABLE,
        { id: "a", label: "first" },
        { conflictColumns: ["slug"] }
      )
    ).rejects.toThrow(/needs a value for every conflict column/);
  });

  it("takes a row another transaction committed after this one's snapshot", async () => {
    // Repeatable read: this transaction's first read fixes its snapshot. A
    // row with the same key committed by someone else after that is invisible
    // to a plain select here, so only a locking (current) read can find the
    // row the duplicate-key error is about.
    await adapter.transaction(async tx => {
      await tx.select(KEYED, {});
      await adapter.upsert(
        KEYED,
        { id: "theirs", key: "k1", label: "theirs" },
        { conflictColumns: ["key"] }
      );
      const stored = await tx.upsert<Row>(
        KEYED,
        { id: "mine", key: "k1", label: "mine" },
        { conflictColumns: ["key"], updateColumns: [] }
      );
      expect(stored).toMatchObject({ id: "theirs", label: "theirs" });
    });
  });
});
