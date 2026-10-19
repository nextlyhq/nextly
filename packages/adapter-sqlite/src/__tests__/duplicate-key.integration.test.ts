// A duplicate key raised through the adapter's Drizzle path reads as a unique
// violation, as callers that recover from one (a write-once notice, an upsert's
// fallback) depend on, on SQLite as on PostgreSQL and MySQL.

import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createSqliteAdapter } from "../index";

import type { TableDefinition } from "@nextlyhq/adapter-drizzle/types";

const TABLE = "int_sqlite_duplicate_key";

// Created through the adapter's own DDL path, as the schema pipeline creates
// tables, so the unique constraint under test is the one production builds.
const TABLE_DEFINITION: TableDefinition = {
  name: TABLE,
  columns: [
    { name: "id", type: "text", primaryKey: true },
    { name: "slug", type: "text", nullable: false, unique: true },
  ],
};

const posts = sqliteTable(TABLE, {
  id: text("id").primaryKey(),
  slug: text("slug").notNull(),
});

describe("SQLite duplicate key classification", () => {
  let adapter: ReturnType<typeof createSqliteAdapter>;

  beforeAll(async () => {
    adapter = createSqliteAdapter({ memory: true });
    await adapter.connect();
    await adapter.createTable(TABLE_DEFINITION);
    adapter.setTableResolver({
      getTable: (name: string) => (name === TABLE ? posts : null),
    });
  });

  afterAll(async () => {
    await adapter.disconnect();
  });

  it("classifies a duplicate inserted through the adapter as a unique violation", async () => {
    await adapter.insert(TABLE, { id: "1", slug: "taken" });

    const error: unknown = await adapter
      .insert(TABLE, { id: "2", slug: "taken" })
      .then(
        () => undefined,
        (caught: unknown) => caught
      );

    expect(error).toMatchObject({ kind: "unique_violation" });
  });
});
