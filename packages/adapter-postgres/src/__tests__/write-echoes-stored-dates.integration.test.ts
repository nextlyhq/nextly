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
    { name: "zoned_at", type: "timestamptz" },
  ],
};

const events = pgTable(TABLE, {
  id: text("id").primaryKey(),
  label: text("label").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: false }),
  // Carries its own zone, so it is already unambiguous and must be left alone.
  zonedAt: timestamp("zoned_at", { withTimezone: true }),
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

  it("reads the same instant under a non-ISO DateStyle", async () => {
    // `DateStyle` decides how PostgreSQL renders a timestamp as text, and
    // `SQL, DMY` renders 04/08/2026 rather than 2026-08-04. The statement asks
    // for a named format instead of the session's, so the rendering it parses
    // cannot be changed out from under it by a connection setting.
    await adapter.executeQuery("SET DateStyle = 'SQL, DMY'");
    try {
      const written = await adapter.transaction(ctx =>
        ctx.insert<{ occurredAt: Date }>(
          TABLE,
          { id: "ds-1", label: "e", occurred_at: OCCURRED_AT },
          { returning: "*" }
        )
      );

      expect(written.occurredAt).toEqual(OCCURRED_AT);
    } finally {
      await adapter.executeQuery("SET DateStyle = 'ISO, MDY'");
    }
  });

  it("aliases a long column name without exceeding the identifier limit", async () => {
    // PostgreSQL truncates an identifier at 63 bytes, and a truncated alias is
    // worse than a rejected one: the statement still succeeds while the lookup
    // misses the name it asked for, so the row would keep the driver's value
    // and a stray property.
    const longTable = "int_pg_long_column";
    const longColumn = `occurred_at_${"x".repeat(48)}`;
    expect(longColumn.length).toBeGreaterThan(44);

    await adapter.executeQuery(`DROP TABLE IF EXISTS ${longTable}`);
    await adapter.createTable({
      name: longTable,
      columns: [
        { name: "id", type: "text", primaryKey: true },
        { name: longColumn, type: "timestamp" },
      ],
    });
    const longTableObj = pgTable(longTable, {
      id: text("id").primaryKey(),
      occurredAt: timestamp(longColumn, { withTimezone: false }),
    });
    adapter.setTableResolver({
      getTable: (name: string) =>
        name === longTable ? longTableObj : name === TABLE ? events : null,
    });

    try {
      const written = await adapter.transaction(ctx =>
        ctx.insert<Record<string, unknown>>(
          longTable,
          { id: "long-1", [longColumn]: OCCURRED_AT },
          { returning: "*" }
        )
      );

      expect(written.occurredAt).toEqual(OCCURRED_AT);
      // No helper property survives into the row the caller sees.
      expect(Object.keys(written).sort()).toEqual(["id", "occurredAt"]);
    } finally {
      adapter.setTableResolver({
        getTable: (name: string) => (name === TABLE ? events : null),
      });
      await adapter.executeQuery(`DROP TABLE IF EXISTS ${longTable}`);
    }
  });

  it("leaves a zone-carrying column alone", async () => {
    // A `timestamptz` stores an instant, so the driver already reads back the
    // moment that was written. Spelling it out would render it in the session's
    // zone, and reading that as UTC would move a value that was correct.
    await adapter.executeQuery("SET TimeZone = 'Asia/Karachi'");
    try {
      const written = await adapter.transaction(ctx =>
        ctx.insert<{ zonedAt: Date }>(
          TABLE,
          { id: "tz-zoned", label: "f", zoned_at: OCCURRED_AT },
          { returning: "*" }
        )
      );

      const read = await adapter.selectOne<{ zonedAt: Date }>(TABLE, {
        where: { and: [{ column: "id", op: "=", value: "tz-zoned" }] },
      });

      expect(written.zonedAt).toEqual(OCCURRED_AT);
      expect(written.zonedAt).toEqual(read?.zonedAt);
    } finally {
      await adapter.executeQuery("SET TimeZone = 'UTC'");
    }
  });

  it("keeps a year below 0100 in its own century", async () => {
    // `Date.UTC` reads a year under 100 as shorthand for the 1900s, so year 50
    // would otherwise land in 1950. PostgreSQL can store it and said 0050.
    const ancient = new Date("2026-01-01T00:00:00.000Z");
    ancient.setUTCFullYear(50);

    const written = await adapter.transaction(ctx =>
      ctx.insert<{ occurredAt: Date }>(
        TABLE,
        { id: "old-1", label: "g", occurred_at: ancient },
        { returning: "*" }
      )
    );

    expect(written.occurredAt.getUTCFullYear()).toBe(50);
    expect(written.occurredAt).toEqual(ancient);
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
