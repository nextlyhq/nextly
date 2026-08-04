// A write's returned row carries the same value representation a read of the
// same row gives. The raw-SQL insert paths exist because SQLite needs SQL a
// Drizzle query cannot express, not because their callers want a different row
// shape: without decoding, an insert answers a timestamp column with the
// integer SQLite stores while every select answers a `Date`.

import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createSqliteAdapter } from "../index";

const TABLE = "int_sqlite_write_dates";

const events = sqliteTable(TABLE, {
  id: text("id").primaryKey(),
  label: text("label").notNull(),
  // The mode every generated timestamp column uses, so what this suite decodes
  // is what a real collection row decodes.
  occurredAt: integer("occurred_at", { mode: "timestamp" }),
});

const OCCURRED_AT = new Date("2026-08-04T09:33:20.000Z");

describe("SQLite write paths return Drizzle-decoded dates", () => {
  let adapter: ReturnType<typeof createSqliteAdapter>;

  beforeAll(async () => {
    adapter = createSqliteAdapter({ memory: true });
    await adapter.connect();
    await adapter.executeQuery(
      `CREATE TABLE ${TABLE} (id text PRIMARY KEY, label text NOT NULL, occurred_at integer)`
    );
    adapter.setTableResolver({
      getTable: (name: string) => (name === TABLE ? events : null),
    });
  });

  afterAll(async () => {
    await adapter.disconnect();
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
