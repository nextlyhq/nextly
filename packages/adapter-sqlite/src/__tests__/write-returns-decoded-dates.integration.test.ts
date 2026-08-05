// A write's returned row carries the same value representation a read of the
// same row gives. The raw-SQL insert paths exist because SQLite needs SQL a
// Drizzle query cannot express, not because their callers want a different row
// shape: without decoding, an insert answers a timestamp column with the
// integer SQLite stores while every select answers a `Date`.

import type { TableDefinition } from "@nextlyhq/adapter-drizzle/types";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createSqliteAdapter } from "../index";

const TABLE = "int_sqlite_write_dates";

/**
 * The physical table, built through the adapter's own DDL rather than a
 * hand-written statement, so the dialect decides how each column is spelled.
 *
 * SQLite stores a timestamp as an integer of unix seconds, which is what
 * `integer({ mode: "timestamp" })` binds and decodes.
 */
const TABLE_DEFINITION: TableDefinition = {
  name: TABLE,
  columns: [
    { name: "id", type: "text", primaryKey: true },
    { name: "label", type: "text", nullable: false },
    { name: "occurred_at", type: "integer" },
  ],
};

/**
 * The schema the adapter resolves the table through, in the shape a generated
 * collection uses, so what this suite decodes is what a real row decodes.
 *
 * That this agrees with the physical column is the premise of every case below
 * rather than an assumption: the first one reads the stored value back raw and
 * fails if it is not the integer the decoder expects.
 */
const events = sqliteTable(TABLE, {
  id: text("id").primaryKey(),
  label: text("label").notNull(),
  occurredAt: integer("occurred_at", { mode: "timestamp" }),
});

const OCCURRED_AT = new Date("2026-08-04T09:33:20.000Z");

describe("SQLite write paths return Drizzle-decoded dates", () => {
  let adapter: ReturnType<typeof createSqliteAdapter>;

  beforeAll(async () => {
    adapter = createSqliteAdapter({ memory: true });
    await adapter.connect();
    await adapter.createTable(TABLE_DEFINITION);
    adapter.setTableResolver({
      getTable: (name: string) => (name === TABLE ? events : null),
    });
  });

  afterAll(async () => {
    await adapter.disconnect();
  });

  it("stores the timestamp as the raw integer the decoder expects", async () => {
    // The premise of every case below. If the physical column and the resolver
    // schema ever disagree about how a timestamp is stored, the decode under
    // test becomes a no-op and the assertions would pass having proved nothing.
    await adapter.transaction(ctx =>
      ctx.insert(
        TABLE,
        { id: "raw-1", label: "raw", occurred_at: OCCURRED_AT },
        { returning: [] }
      )
    );

    const [stored] = await adapter.executeQuery<{ occurred_at: unknown }>(
      `SELECT occurred_at FROM ${TABLE} WHERE id = ?`,
      ["raw-1"]
    );

    expect(typeof stored.occurred_at).toBe("number");
  });

  it("decodes a date on the transactional insert, matching a read of the row", async () => {
    const written = await adapter.transaction(ctx =>
      ctx.insert<{ occurredAt: unknown }>(
        TABLE,
        { id: "tx-1", label: "a", occurred_at: OCCURRED_AT },
        { returning: "*" }
      )
    );

    const read = await adapter.selectOne<{ occurredAt: unknown }>(TABLE, {
      where: { and: [{ column: "id", op: "=", value: "tx-1" }] },
    });

    expect(written.occurredAt).toBeInstanceOf(Date);
    expect(written.occurredAt).toEqual(OCCURRED_AT);
    // Asserted against the read as well as against the expected value: the
    // point is that the two paths agree, not merely that one of them is right.
    expect(written.occurredAt).toEqual(read?.occurredAt);
  });

  it("decodes dates on the transactional bulk insert", async () => {
    const written = await adapter.transaction(ctx =>
      ctx.insertMany<{ occurredAt: unknown }>(
        TABLE,
        [
          { id: "tx-2", label: "b", occurred_at: OCCURRED_AT },
          { id: "tx-3", label: "c", occurred_at: OCCURRED_AT },
        ],
        { returning: "*" }
      )
    );

    expect(written).toHaveLength(2);
    for (const row of written) {
      expect(row.occurredAt).toBeInstanceOf(Date);
      expect(row.occurredAt).toEqual(OCCURRED_AT);
    }
  });

  it("decodes dates on the non-transactional bulk insert", async () => {
    const written = await adapter.insertMany<{ occurredAt: unknown }>(
      TABLE,
      [
        { id: "bulk-1", label: "d", occurred_at: OCCURRED_AT },
        { id: "bulk-2", label: "e", occurred_at: OCCURRED_AT },
      ],
      { returning: "*" }
    );

    expect(written).toHaveLength(2);
    for (const row of written) {
      expect(row.occurredAt).toBeInstanceOf(Date);
    }
  });

  it("adds no column the caller did not ask to have returned", async () => {
    // A projection is a contract: `recordEvent()` writes a timestamp while
    // asking only for the id, and a row that answered with more than was
    // requested would be carrying a column the statement never selected.
    const written = await adapter.transaction(ctx =>
      ctx.insert<Record<string, unknown>>(
        TABLE,
        { id: "proj-1", label: "h", occurred_at: OCCURRED_AT },
        { returning: ["id"] }
      )
    );

    expect(Object.keys(written)).toEqual(["id"]);
  });

  it("leaves a null date null rather than decoding it to the epoch", async () => {
    const written = await adapter.transaction(ctx =>
      ctx.insert<{ occurredAt: unknown }>(
        TABLE,
        { id: "tx-null", label: "f", occurred_at: null },
        { returning: "*" }
      )
    );

    expect(written.occurredAt).toBeNull();
  });
});
