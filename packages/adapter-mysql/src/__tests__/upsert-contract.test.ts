// Which tables MySQL's upsert accepts, judged from the model before any
// statement runs — so these cases need no database. MySQL cannot limit a
// duplicate to one key, so the conflict target must be the table's one unique
// key besides the primary key.

import {
  int,
  mysqlTable,
  unique,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";
import { describe, expect, it, vi } from "vitest";

import { createMySqlAdapter } from "../index";

const single = mysqlTable("single_key", {
  id: varchar("id", { length: 36 }).primaryKey(),
  key: varchar("key", { length: 64 }).notNull().unique(),
});

const columnAndIndex = mysqlTable(
  "column_and_index",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    key: varchar("key", { length: 64 }).notNull().unique(),
    grp: varchar("grp", { length: 64 }),
    pos: int("pos"),
  },
  table => [uniqueIndex("column_and_index_pair_uidx").on(table.grp, table.pos)]
);

const constraintOnly = mysqlTable(
  "constraint_only",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    grp: varchar("grp", { length: 64 }),
    pos: int("pos"),
  },
  table => [unique("constraint_only_pair").on(table.grp, table.pos)]
);

const keyless = mysqlTable("keyless", {
  key: varchar("key", { length: 64 }).notNull().unique(),
});

const tables: Record<string, unknown> = {
  keyless,
  single_key: single,
  column_and_index: columnAndIndex,
  constraint_only: constraintOnly,
};

function adapter() {
  // Never connected: a refusal must come before any statement.
  const unconnected = createMySqlAdapter({
    url: "mysql://nobody@127.0.0.1:1/none",
  });
  unconnected.setTableResolver({
    getTable: (name: string) => tables[name] ?? null,
  });
  return unconnected;
}

describe("MySQL upsert: the tables it accepts", () => {
  it("refuses a target beside which the table has another unique key, naming it", async () => {
    await expect(
      adapter().upsert(
        "column_and_index",
        { id: "a", key: "k1" },
        { conflictColumns: ["key"] }
      )
    ).rejects.toThrow(/other unique keys \(column_and_index_pair_uidx\)/);
    await expect(
      adapter().upsert(
        "column_and_index",
        { id: "a", key: "k1", grp: "g", pos: 1 },
        { conflictColumns: ["grp", "pos"] }
      )
    ).rejects.toThrow(/other unique keys \(column_and_index_key_unique\)/);
  });

  it("refuses the primary key as a target while the table has a unique key", async () => {
    await expect(
      adapter().upsert(
        "single_key",
        { id: "a", key: "k1" },
        { conflictColumns: ["id"] }
      )
    ).rejects.toThrow(/other unique keys \(single_key_key_unique\)/);
  });

  it("refuses a table without a primary key to read rows back by", async () => {
    await expect(
      adapter().upsert("keyless", { key: "k1" }, { conflictColumns: ["key"] })
    ).rejects.toThrow(/need a table with a primary key/);
  });

  it("refuses a conflict column named twice", async () => {
    // SQLite rejects it as no constraint's target; MySQL must not accept it
    // as the single-column key it collapses to.
    await expect(
      adapter().upsert(
        "single_key",
        { id: "a", key: "k1" },
        { conflictColumns: ["key", "key"] }
      )
    ).rejects.toThrow(/more than once/);
  });

  it("refuses a target that is not a key at all", async () => {
    await expect(
      adapter().upsert(
        "constraint_only",
        { id: "a", grp: "g", pos: 1 },
        { conflictColumns: ["grp"] }
      )
    ).rejects.toThrow(/not a primary or unique key/);
  });

  it("runs an upsert without the caller's transaction in one of its own", async () => {
    // A locking read under autocommit locks nothing past its own statement,
    // so the read and the update after it would not be protected. A refused
    // call is judged first and opens nothing.
    const unconnected = adapter();
    const transaction = vi
      .spyOn(unconnected, "transaction")
      .mockResolvedValue({ id: "a" });
    await unconnected.upsert(
      "single_key",
      { id: "a", key: "k1" },
      { conflictColumns: ["key"] }
    );
    expect(transaction).toHaveBeenCalledTimes(1);
    await expect(
      unconnected.upsert(
        "column_and_index",
        { id: "a", key: "k1" },
        { conflictColumns: ["key"] }
      )
    ).rejects.toThrow(/other unique keys/);
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it("accepts the one unique key, declared on a column or as a constraint", async () => {
    // Accepted means it gets past the contract to the database — which,
    // unconnected, is the next thing to fail, and fails differently.
    for (const [table, data, conflictColumns] of [
      ["single_key", { id: "a", key: "k1" }, ["key"]],
      ["constraint_only", { id: "a", grp: "g", pos: 1 }, ["grp", "pos"]],
    ] as const) {
      const refusal = await adapter()
        .upsert(table, { ...data }, { conflictColumns: [...conflictColumns] })
        .then(
          () => undefined,
          (error: unknown) => (error as Error).message
        );
      expect(refusal).toBeDefined();
      expect(refusal).not.toMatch(/unique key/);
    }
  });
});
