/**
 * Live constraint introspection against a real MySQL.
 *
 * The query joins KEY_COLUMN_USAGE with REFERENTIAL_CONSTRAINTS (actions) and
 * TABLE_CONSTRAINTS with CHECK_CONSTRAINTS (expressions) — the tuple shapes
 * only a real server returns. Gated on TEST_MYSQL_URL like the other MySQL
 * integration tests; CI's mysql legs run it.
 *
 * @module domains/schema/pipeline/diff/__tests__/introspect-constraints-mysql.integration
 */
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { introspectLiveSnapshot } from "../introspect-live";

const URL = process.env.TEST_MYSQL_URL ?? "";
const describeMysql = describe.skipIf(!URL);

const TABLE = "nx_intro_fx_linked";
const REF = "nx_intro_owners";

describeMysql("mysql constraint introspection", () => {
  let pool: mysql.Pool;
  let db: unknown;

  beforeAll(async () => {
    if (!URL) return;
    pool = mysql.createPool(URL);
    await pool.query(`DROP TABLE IF EXISTS \`${TABLE}\``);
    await pool.query(`DROP TABLE IF EXISTS \`${REF}\``);
    await pool.query(`CREATE TABLE \`${REF}\` (id VARCHAR(36) PRIMARY KEY)`);
    await pool.query(`CREATE TABLE \`${TABLE}\` (
      id VARCHAR(36) PRIMARY KEY,
      owner_id VARCHAR(36) NOT NULL,
      score INTEGER,
      CONSTRAINT fk_${TABLE}_owner FOREIGN KEY (owner_id)
        REFERENCES \`${REF}\` (id) ON DELETE CASCADE ON UPDATE NO ACTION,
      CONSTRAINT ck_${TABLE}_score CHECK (score >= 0)
    )`);
    db = drizzle({ client: pool });
  });

  afterAll(async () => {
    if (!URL) return;
    await pool.query(`DROP TABLE IF EXISTS \`${TABLE}\``);
    await pool.query(`DROP TABLE IF EXISTS \`${REF}\``);
    await pool.end();
  });

  it("reads foreign keys with catalog names, ordered columns, and actions", async () => {
    const snapshot = await introspectLiveSnapshot(db, "mysql", [TABLE]);
    expect(snapshot.tables[0]?.foreignKeys).toEqual([
      {
        name: `fk_${TABLE}_owner`,
        columns: ["owner_id"],
        referencesTable: REF,
        referencesColumns: ["id"],
        onDelete: "cascade",
        onUpdate: "no action",
      },
    ]);
  });

  it("reads checks normalised: backticks stripped, one paren layer off", async () => {
    const snapshot = await introspectLiveSnapshot(db, "mysql", [TABLE]);
    expect(snapshot.tables[0]?.checks).toEqual([
      { name: `ck_${TABLE}_score`, sql: "score >= 0" },
    ]);
  });

  it("a table with no constraints reports empty lists, not undefined", async () => {
    const snapshot = await introspectLiveSnapshot(db, "mysql", [REF]);
    expect(snapshot.tables[0]?.foreignKeys).toEqual([]);
    expect(snapshot.tables[0]?.checks).toEqual([]);
  });
});
