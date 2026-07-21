/**
 * A MySQL archive table missing its lookup index gets it back on the next
 * ensure.
 *
 * The bootstrap declares the index inside `CREATE TABLE IF NOT EXISTS`,
 * because MySQL has no `CREATE INDEX IF NOT EXISTS` and a separate statement
 * failed with a duplicate key name on every ensure after the first. MySQL
 * skips that whole statement when the table exists, though, so the inline
 * form cannot restore an index that went missing.
 *
 * Nothing else covers it either: `drizzleTableToTableSpec` records names and
 * columns only, so index-only drift produces no operations and the reconcile
 * returns before any push. The ensure path therefore carries an explicit
 * repair, attempted and tolerated rather than checked first, which is the same
 * tolerance the schema executor already applies.
 *
 * PostgreSQL and SQLite need none of this — their bootstrap emits
 * `CREATE INDEX IF NOT EXISTS` beside the table — so the repair is null there.
 */
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { isIdempotencyError } from "../../../domains/schema/pipeline/sql-statement-utils";
import { getI18nArchiveDdl, getI18nArchiveIndexRepairDdl } from "../ddl";

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

    // Exactly what the dispatchers run when a localization disable needs the
    // archive: the bootstrap, then the repair.
    const ensure = async (): Promise<void> => {
      for (const statement of getI18nArchiveDdl("mysql")) {
        await db.query(statement);
      }
      const repair = getI18nArchiveIndexRepairDdl("mysql");
      if (!repair) return;
      try {
        await db.query(repair);
      } catch (err) {
        if (!isIdempotencyError(err)) throw err;
      }
    };

    await ensure();
    expect(await indexExists()).toBe(true);

    // And the ensure stays safe to repeat, which is what broke before the
    // index moved inline.
    await ensure();
    await ensure();
    expect(await indexExists()).toBe(true);
  });

  it("has no repair statement for the dialects that self-repair", () => {
    // Their bootstrap emits CREATE INDEX IF NOT EXISTS beside the table.
    expect(getI18nArchiveIndexRepairDdl("postgresql")).toBeNull();
    expect(getI18nArchiveIndexRepairDdl("sqlite")).toBeNull();
  });
});
