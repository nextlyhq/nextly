// `upsert` against a real SQLite database: a new key inserts, an existing key
// updates the columns named, and naming no column keeps the existing row —
// the "write once" a caller inside a transaction needs, which must leave the
// transaction usable after a repeat.
//
// The PostgreSQL and MySQL adapters carry the same cases, so the three
// dialects answer one contract.

import type { TableDefinition } from "@nextlyhq/adapter-drizzle/types";
import {
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createSqliteAdapter } from "../index";

const TABLE = "int_upsert_sqlite";

const TABLE_DEFINITION: TableDefinition = {
  name: TABLE,
  columns: [
    { name: "id", type: "text", primaryKey: true },
    { name: "key", type: "text", nullable: false, unique: true },
    { name: "label", type: "text" },
    { name: "slug", type: "text", unique: true },
    { name: "grp", type: "text" },
    { name: "pos", type: "integer" },
  ],
};

const things = sqliteTable(
  TABLE,
  {
    id: text("id").primaryKey(),
    key: text("key").notNull().unique(),
    label: text("label"),
    slug: text("slug").unique(),
    grp: text("grp"),
    pos: integer("pos"),
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

describe("SQLite upsert", () => {
  let adapter: ReturnType<typeof createSqliteAdapter>;

  const rows = () =>
    adapter.executeQuery<Row>(
      `SELECT id, key, label FROM ${TABLE} ORDER BY id`
    );

  beforeAll(async () => {
    adapter = createSqliteAdapter({ memory: true });
    await adapter.connect();
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

  it("returns the row when the update changes its primary key", async () => {
    // With no `updateColumns`, every given column is updated, the primary key
    // included. The row is then found by its new key, not the one it had.
    await adapter.upsert(
      TABLE,
      { id: "a", key: "k1", label: "first" },
      { conflictColumns: ["key"] }
    );
    const stored = await adapter.upsert<Row>(
      TABLE,
      { id: "b", key: "k1", label: "second" },
      { conflictColumns: ["key"] }
    );
    expect(stored).toMatchObject({ id: "b", key: "k1", label: "second" });
    expect(await rows()).toEqual([{ id: "b", key: "k1", label: "second" }]);
  });

  it("lets exactly one of two concurrent inserts of one key report its own row", async () => {
    // Whether a call created the row is read from the id it returns: each
    // caller sends a fresh id, and only a caller whose insert ran gets its own
    // id back. A read-back of the row that stands can only ever return the
    // other caller's, so it can never report "created" for a call that kept.
    const outcomes = await Promise.all(
      ["first", "second"].map(id =>
        adapter.upsert<Row>(
          TABLE,
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

  it("refuses a conflict column named twice", async () => {
    await expect(
      adapter.upsert(
        TABLE,
        { id: "a", key: "k1", label: "first" },
        { conflictColumns: ["key", "key"] }
      )
    ).rejects.toThrow(/more than once/);
    expect(await rows()).toEqual([]);
  });

  it("refuses to keep a row by a conflict column left for the database to fill", async () => {
    // The row that stands is read back by the caller's conflict values; one
    // the database would supply is not among them. MySQL refuses the same.
    await expect(
      adapter.upsert(
        TABLE,
        { id: "a", key: "k1", label: "first" },
        { conflictColumns: ["slug"], updateColumns: [] }
      )
    ).rejects.toThrow(/needs a value for every conflict column/);
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
});
