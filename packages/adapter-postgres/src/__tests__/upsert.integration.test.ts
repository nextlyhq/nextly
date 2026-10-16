// `upsert` against a real PostgreSQL database: a new key inserts, an existing key
// updates the columns named, and naming no column keeps the existing row —
// the "write once" a caller inside a transaction needs, which must leave the
// transaction usable after a repeat.
//
// The SQLite and MySQL adapters carry the same cases, so the three
// dialects answer one contract.

import type { TableDefinition } from "@nextlyhq/adapter-drizzle/types";
import { pgTable, text } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createPostgresAdapter } from "../index";

const TABLE = "int_upsert_pg";
const TEST_DB_URL = process.env.TEST_POSTGRES_URL;

const TABLE_DEFINITION: TableDefinition = {
  name: TABLE,
  columns: [
    { name: "id", type: "text", primaryKey: true },
    { name: "key", type: "text", nullable: false, unique: true },
    { name: "label", type: "text" },
  ],
};

const things = pgTable(TABLE, {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  label: text("label"),
});

interface Row {
  id: string;
  key: string;
  label: string | null;
}

describe.skipIf(!TEST_DB_URL)("PostgreSQL upsert", () => {
  let adapter: ReturnType<typeof createPostgresAdapter>;

  const rows = () =>
    adapter.executeQuery<Row>(
      `SELECT id, key, label FROM ${TABLE} ORDER BY id`
    );

  beforeAll(async () => {
    adapter = createPostgresAdapter({ url: TEST_DB_URL as string });
    await adapter.connect();
    await adapter.executeQuery(`DROP TABLE IF EXISTS ${TABLE}`);
    await adapter.createTable(TABLE_DEFINITION);
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
});
