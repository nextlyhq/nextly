// A duplicate key raised through the adapter's Drizzle path reads as a unique
// violation, as callers that recover from one (a write-once notice, an upsert's
// fallback) depend on. Drizzle wraps mysql2's error, so this holds only if the
// classifier finds the driver's `errno` under the wrapper.
//
// Self-skips when TEST_MYSQL_URL is unset.

import { mysqlTable, varchar } from "drizzle-orm/mysql-core";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createMySqlAdapter, type MySqlAdapter } from "../index";

import type { TableDefinition } from "@nextlyhq/adapter-drizzle/types";

const TABLE = "int_mysql_duplicate_key";

// Created through the adapter's own DDL path, as the schema pipeline creates
// tables, so the unique constraint under test is the one production builds.
const TABLE_DEFINITION: TableDefinition = {
  name: TABLE,
  columns: [
    { name: "id", type: "varchar(36)", primaryKey: true },
    { name: "slug", type: "varchar(255)", nullable: false, unique: true },
  ],
};
const TEST_DB_URL = process.env.TEST_MYSQL_URL;

const posts = mysqlTable(TABLE, {
  id: varchar("id", { length: 36 }).primaryKey(),
  slug: varchar("slug", { length: 255 }).notNull(),
});

const canConnect = async (url: string): Promise<boolean> => {
  // Bounded, so an unreachable TEST_MYSQL_URL cannot hang the suite.
  const connPromise = mysql.createConnection(url).catch(() => undefined);
  const attempt = (async () => {
    const conn = await connPromise;
    if (!conn) return false;
    try {
      await conn.query("SELECT 1");
      return true;
    } catch {
      return false;
    }
  })();
  const timeout = new Promise<boolean>(resolve =>
    setTimeout(() => resolve(false), 5000)
  );
  const ok = await Promise.race([attempt, timeout]);
  void connPromise.then(conn => conn?.end().catch(() => {}));
  return ok;
};

describe("MySQL duplicate key classification", async () => {
  const available = TEST_DB_URL ? await canConnect(TEST_DB_URL) : false;

  if (!available) {
    it.skip("Skipping: TEST_MYSQL_URL not set or unreachable", () => {});
    return;
  }

  let adapter: MySqlAdapter;

  beforeAll(async () => {
    adapter = createMySqlAdapter({ url: TEST_DB_URL });
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
