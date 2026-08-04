// What a write answers with is what the database stored, read in the zone the
// statement wrote it in.
//
// A column declared without a time zone holds a wall clock. The statement binds
// a UTC one; node-postgres reads it back in the LOCAL zone, so the same row
// comes back shifted by the offset. Only the reading is wrong -- the wall clock
// in the database is right -- so the write must re-read it as UTC rather than
// substitute the value it was handed, which would report an instant the column
// never held.
//
// CI runs in UTC, where the two readings agree and none of this is observable,
// so the cases below fix `TZ` rather than trusting the machine.

import type { TableDefinition } from "@nextlyhq/adapter-drizzle/types";
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPostgresAdapter } from "../index";

const TEST_DB_URL = process.env.TEST_POSTGRES_URL;
const TABLE = "int_pg_write_dates";

const TABLE_DEFINITION: TableDefinition = {
  name: TABLE,
  columns: [
    { name: "id", type: "text", primaryKey: true },
    { name: "label", type: "text", nullable: false },
    // Without a time zone, which is what every generated timestamp column is.
    { name: "occurred_at", type: "timestamp" },
  ],
};

const events = pgTable(TABLE, {
  id: text("id").primaryKey(),
  label: text("label").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: false }),
});

const OCCURRED_AT = new Date("2026-08-04T15:04:01.860Z");

describe.skipIf(!TEST_DB_URL)("PostgreSQL write echoes the stored date", () => {
  let adapter: ReturnType<typeof createPostgresAdapter>;
  let previousTz: string | undefined;

  beforeAll(async () => {
    previousTz = process.env.TZ;
    process.env.TZ = "Asia/Karachi";
    adapter = createPostgresAdapter({ url: TEST_DB_URL as string });
    await adapter.connect();
    await adapter.executeQuery(`DROP TABLE IF EXISTS ${TABLE}`);
    await adapter.createTable(TABLE_DEFINITION);
    adapter.setTableResolver({
      getTable: (name: string) => (name === TABLE ? events : null),
    });
  });

  afterAll(async () => {
    await adapter.executeQuery(`DROP TABLE IF EXISTS ${TABLE}`);
    await adapter.disconnect();
    if (previousTz === undefined) delete process.env.TZ;
    else process.env.TZ = previousTz;
  });

  it("answers a write with the instant it wrote, on a non-UTC server", async () => {
    const written = await adapter.transaction(ctx =>
      ctx.insert<{ occurredAt: Date }>(
        TABLE,
        { id: "tz-1", label: "a", occurred_at: OCCURRED_AT },
        { returning: "*" }
      )
    );

    const read = await adapter.selectOne<{ occurredAt: Date }>(TABLE, {
      where: { and: [{ column: "id", op: "=", value: "tz-1" }] },
    });

    expect(written.occurredAt).toEqual(OCCURRED_AT);
    // The two paths agreeing is the point, not merely that one is right.
    expect(written.occurredAt).toEqual(read?.occurredAt);
  });

  it("keeps the wall clock the column stored, rather than the one it was handed", async () => {
    // The stored value as TEXT, so neither the driver nor the ORM interprets
    // it: a UTC wall clock is what a correct write leaves behind, and a local
    // one is the defect.
    await adapter.transaction(ctx =>
      ctx.insert(
        TABLE,
        { id: "tz-2", label: "b", occurred_at: OCCURRED_AT },
        { returning: [] }
      )
    );

    const [stored] = await adapter.executeQuery<{ w: string }>(
      `SELECT occurred_at::text AS w FROM ${TABLE} WHERE id = $1`,
      ["tz-2"]
    );

    expect(stored.w).toContain("15:04:01");
  });

  it("survives a wall clock inside the server's daylight-saving gap", async () => {
    // 02:00-02:59 does not exist in New York on 2026-03-08, and the process is
    // in that zone for this suite's sibling cases. A driver handed such a wall
    // clock normalizes it to 03:30 while constructing its `Date`, so the
    // original is destroyed before any correction could run -- which is why
    // the value is read from the database's own text rather than rebuilt.
    const inGap = new Date("2026-03-08T02:30:00.000Z");
    const previous = process.env.TZ;
    process.env.TZ = "America/New_York";
    try {
      const written = await adapter.transaction(ctx =>
        ctx.insert<{ occurredAt: Date }>(
          TABLE,
          { id: "dst-1", label: "d", occurred_at: inGap },
          { returning: "*" }
        )
      );

      const read = await adapter.selectOne<{ occurredAt: Date }>(TABLE, {
        where: { and: [{ column: "id", op: "=", value: "dst-1" }] },
      });

      expect(written.occurredAt).toEqual(inGap);
      expect(written.occurredAt).toEqual(read?.occurredAt);
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  });

  it("adds no column the caller did not ask to have returned", async () => {
    // A projection is a contract. A row answering with a timestamp the
    // statement never selected would be carrying a column out of thin air.
    const written = await adapter.transaction(ctx =>
      ctx.insert<Record<string, unknown>>(
        TABLE,
        { id: "tz-3", label: "c", occurred_at: OCCURRED_AT },
        { returning: ["id"] }
      )
    );

    expect(Object.keys(written)).toEqual(["id"]);
  });
});
