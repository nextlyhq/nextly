// A duplicate key raised through the adapter's Drizzle path reads as a unique
// violation, as callers that recover from one (a write-once notice, an upsert's
// fallback) depend on. Drizzle wraps the driver's error, so this holds only if
// the classifier finds the driver's code under the wrapper.
//
// Self-skips when TEST_POSTGRES_URL is unset.

import { pgTable, text } from "drizzle-orm/pg-core";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPostgresAdapter, type PostgresAdapter } from "../index";

import type { TableDefinition } from "@nextlyhq/adapter-drizzle/types";

const TABLE = "int_pg_duplicate_key";

// Created through the adapter's own DDL path, as the schema pipeline creates
// tables, so the unique constraint under test is the one production builds.
const TABLE_DEFINITION: TableDefinition = {
  name: TABLE,
  columns: [
    { name: "id", type: "text", primaryKey: true },
    { name: "slug", type: "text", nullable: false, unique: true },
  ],
};
const TEST_DB_URL = process.env.TEST_POSTGRES_URL;

const posts = pgTable(TABLE, {
  id: text("id").primaryKey(),
  slug: text("slug").notNull(),
});

const canConnect = async (url: string): Promise<boolean> => {
  // Bounded connect so an unreachable TEST_POSTGRES_URL cannot hang the suite.
  const client = new pg.Client({
    connectionString: url,
    connectionTimeoutMillis: 5000,
  });
  try {
    await client.connect();
    await client.query("SELECT 1");
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => {});
  }
};

describe("PostgreSQL duplicate key classification", async () => {
  const available = TEST_DB_URL ? await canConnect(TEST_DB_URL) : false;

  if (!available) {
    it.skip("Skipping: TEST_POSTGRES_URL not set or unreachable", () => {});
    return;
  }

  let adapter: PostgresAdapter;

  beforeAll(async () => {
    adapter = createPostgresAdapter({ url: TEST_DB_URL });
    await adapter.connect();
    await adapter.executeQuery(`DROP TABLE IF EXISTS ${TABLE}`);
    await adapter.createTable(TABLE_DEFINITION);
    adapter.setTableResolver({
      getTable: (name: string) => (name === TABLE ? posts : null),
    });
  });

  afterAll(async () => {
    await adapter.executeQuery(`DROP TABLE IF EXISTS ${TABLE}`);
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
