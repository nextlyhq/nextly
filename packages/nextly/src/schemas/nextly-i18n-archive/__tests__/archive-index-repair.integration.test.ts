/**
 * A MySQL archive table missing its lookup index gets it back.
 *
 * The bootstrap DDL declares the index inside `CREATE TABLE IF NOT EXISTS`
 * rather than as a following `CREATE INDEX`, because MySQL has no
 * `CREATE INDEX IF NOT EXISTS` and the separate statement failed with a
 * duplicate key name on every ensure after the first. Inline, re-running the
 * bootstrap is a no-op — but so is the index creation, which raises the fair
 * question of what repairs a table that exists without the index.
 *
 * The answer is that the archive is now a bundle-managed core table, so the
 * push reconciles its indexes like any other. That is strictly more general
 * than the statement it replaced: it also repairs an index dropped later,
 * which an unconditional `CREATE INDEX` never could — that could only ever
 * fail against a table already carrying one.
 *
 * This asserts that, so the claim cannot quietly stop being true.
 */
import { createRequire } from "node:module";

import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { nextlyI18nArchive } from "../mysql";

const MYSQL_URL = process.env.TEST_MYSQL_URL ?? "";
const TABLE = "nextly_i18n_archive";
const INDEX = "nextly_i18n_archive_lookup_idx";

// Dialect gate: skipped when the dialect's URL is unset.
const describeMysql = describe.skipIf(!MYSQL_URL);

let connection: mysql.Connection | undefined;

beforeAll(async () => {
  if (!MYSQL_URL) return;
  connection = await mysql.createConnection(MYSQL_URL);
  // A fixed-name system table, so start from a known state rather than
  // whatever an earlier suite in this shared run left behind.
  await connection.query(`DROP TABLE IF EXISTS \`${TABLE}\``);
});

afterAll(async () => {
  await connection?.query(`DROP TABLE IF EXISTS \`${TABLE}\``);
  await connection?.end();
});

async function indexExists(): Promise<boolean> {
  const [rows] = await connection!.query(
    `SHOW INDEX FROM \`${TABLE}\` WHERE Key_name = ?`,
    [INDEX]
  );
  return Array.isArray(rows) && rows.length > 0;
}

describeMysql("mysql archive index repair", () => {
  it("recreates a lookup index the table is missing", async () => {
    const db = connection!;

    // The state in question: the table exists, the index does not. Reached in
    // practice by an ensure that died between the old table and index
    // statements, or by the index being dropped.
    await db.query(
      `CREATE TABLE \`${TABLE}\` (
        \`id\` BIGINT AUTO_INCREMENT PRIMARY KEY,
        \`collection\` VARCHAR(191) NOT NULL,
        \`entry_id\` VARCHAR(191) NOT NULL,
        \`locale\` VARCHAR(20) NOT NULL,
        \`field\` VARCHAR(191) NOT NULL,
        \`value\` LONGTEXT,
        \`archived_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
      )`
    );
    expect(await indexExists()).toBe(false);

    const kit = createRequire(import.meta.url)("drizzle-kit/payload/mysql") as {
      pushSchema: (
        schema: Record<string, unknown>,
        client: { query: <T>(sql: string, params?: unknown[]) => Promise<T[]> },
        databaseName?: string
      ) => Promise<{ apply: () => Promise<void> }>;
    };

    const databaseName = new URL(MYSQL_URL).pathname.replace(/^\//, "");
    const result = await kit.pushSchema(
      { nextlyI18nArchive },
      {
        query: async <T>(sql: string, params: unknown[] = []): Promise<T[]> => {
          const [rows] = await db.query(sql, params);
          return rows as T[];
        },
      },
      databaseName
    );
    await result.apply();

    expect(await indexExists()).toBe(true);
  });
});
