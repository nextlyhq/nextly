/**
 * A MySQL baseline must be rebuildable when a column carries an expression
 * default.
 *
 * `information_schema.COLUMN_DEFAULT` reports a function-call expression
 * default with its enclosing parentheses stripped, and MySQL refuses that same
 * text without them. Recorded verbatim, the snapshot of a table holding a
 * required JSON, repeater, group or chips field therefore rendered a
 * `CREATE TABLE` no MySQL server would accept — including the one it was read
 * from.
 *
 * The unit suite beside this file pins the recorded TEXT; only a real server
 * can answer whether that text is DDL. The two halves are not
 * interchangeable: the transform can be correct in isolation and still emit
 * something MySQL rejects, which is exactly what the previous behaviour did.
 *
 * Auto-skips without TEST_MYSQL_URL
 * (docker compose -f docker-compose.test.yml up -d mysql-test).
 */
import { randomBytes } from "node:crypto";

import { drizzle } from "drizzle-orm/mysql2";
import { createPool, type Pool } from "mysql2";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { generateMysqlSQL } from "../../sql-templates/mysql";
import { introspectLiveSnapshot } from "../introspect-live";

const MYSQL_URL = process.env.TEST_MYSQL_URL;
// Per-run database name, matching the other MySQL suites here: a fixed name
// could collide with a concurrent run. The hex suffix keeps it a safe
// identifier, so interpolating it into DDL is not an injection surface.
const DB_NAME = `nextly_mysql_expr_default_${randomBytes(16).toString("hex")}`;

const SOURCE_TABLE = "dc_expr_defaults";
const REBUILT_TABLE = "dc_expr_defaults_rebuilt";

// The JSON default Nextly itself emits (`quoteJsonSqlDefault`) alongside the
// other expression shapes a live table can carry. MySQL reports the first
// three with the parentheses removed and the last two as written.
const SOURCE_DDL = `CREATE TABLE ${SOURCE_TABLE} (
  id int NOT NULL PRIMARY KEY,
  payload json NOT NULL DEFAULT (CONVERT(X'7b7d' USING utf8mb4)),
  listing json NOT NULL DEFAULT (json_array()),
  ident varchar(36) NOT NULL DEFAULT (uuid()),
  total int NOT NULL DEFAULT ((1 + 2)),
  made_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  seen_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
)`;

describe.skipIf(!MYSQL_URL)("MySQL expression-default rebuild", () => {
  let bootstrap: Pool;
  let pool: Pool;
  let db: ReturnType<typeof drizzle>;

  beforeAll(async () => {
    bootstrap = createPool({ uri: MYSQL_URL });
    await bootstrap.promise().query(`CREATE DATABASE ${DB_NAME}`);
    const url = new URL(MYSQL_URL as string);
    url.pathname = `/${DB_NAME}`;
    pool = createPool({ uri: url.toString() });
    db = drizzle({ client: pool });
    await pool.promise().query(SOURCE_DDL);
  });

  afterAll(async () => {
    await new Promise<void>(res => pool.end(() => res()));
    await bootstrap
      .promise()
      .query(`DROP DATABASE IF EXISTS ${DB_NAME}`)
      .catch(() => {});
    await new Promise<void>(res => bootstrap.end(() => res()));
  });

  it("re-applies the CREATE TABLE rendered from a live snapshot", async () => {
    const live = await introspectLiveSnapshot(db, "mysql", [SOURCE_TABLE]);
    const table = live.tables.find(t => t.name === SOURCE_TABLE);
    expect(table).toBeDefined();

    // The reported text without the repair — what the snapshot used to hold,
    // asserted here so this suite fails if introspection stops reaching the
    // columns at all rather than silently testing an empty table.
    expect(table!.columns.map(c => c.name)).toEqual([
      "id",
      "payload",
      "listing",
      "ident",
      "total",
      "made_at",
      "seen_at",
    ]);

    const sqlText = generateMysqlSQL({
      type: "add_table",
      table: { ...table!, name: REBUILT_TABLE, indexes: [] },
    });

    // Fails with ER_PARSE_ERROR on a snapshot that recorded the reported text
    // verbatim; the assertion is that this statement is DDL MySQL accepts.
    await pool.promise().query(sqlText);

    const [rebuilt] = await pool.promise().query(
      `SELECT COLUMN_NAME, COLUMN_DEFAULT FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`,
      [DB_NAME, REBUILT_TABLE]
    );

    // The rebuilt table reports exactly what the source did, so the round trip
    // preserved every default rather than merely producing parseable text.
    const [source] = await pool.promise().query(
      `SELECT COLUMN_NAME, COLUMN_DEFAULT FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`,
      [DB_NAME, SOURCE_TABLE]
    );

    expect(rebuilt).toEqual(source);
  });

  it("keeps CURRENT_TIMESTAMP bare, which is a different column to MySQL", async () => {
    // `DEFAULT (CURRENT_TIMESTAMP)` is recorded as the ordinary expression
    // `now()`, losing the auto-initialisation the bare keyword carries — so
    // wrapping every expression uniformly would round-trip a DIFFERENT column
    // while still parsing.
    const live = await introspectLiveSnapshot(db, "mysql", [SOURCE_TABLE]);
    const byName = new Map(
      live.tables
        .find(t => t.name === SOURCE_TABLE)!
        .columns.map(c => [c.name, c.default])
    );

    expect(byName.get("made_at")).toBe("CURRENT_TIMESTAMP");
    expect(byName.get("seen_at")).toBe("CURRENT_TIMESTAMP(3)");
    expect(byName.get("payload")).toBe("(convert(0x7b7d using utf8mb4))");
  });
});
