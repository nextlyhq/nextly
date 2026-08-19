/**
 * A MySQL baseline must be rebuildable when a column carries an expression
 * default of a shape Nextly itself emits.
 *
 * SCOPE, because the title would otherwise read as the whole class: every
 * default here is one an emitter in this package produces, or a bare-keyword
 * form that must survive untouched. An expression CONTAINING a string literal
 * is reported with its quotes backslash-escaped and is still unparseable —
 * deliberately absent, because a passing case would not exist and a failing
 * one would pin behaviour nobody has decided yet.
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

import { quoteJsonSqlDefault } from "../../../utils/sql-literal";
import { generateMysqlSQL } from "../../sql-templates/mysql";
import { introspectLiveSnapshot } from "../introspect-live";

const MYSQL_URL = process.env.TEST_MYSQL_URL;
// Per-run database name, matching the other MySQL suites here: a fixed name
// could collide with a concurrent run. The hex suffix keeps it a safe
// identifier, so interpolating it into DDL is not an injection surface.
const DB_NAME = `nextly_mysql_expr_default_${randomBytes(16).toString("hex")}`;

// `drizzle` is overloaded, so `ReturnType<typeof drizzle>` names a DIFFERENT
// instantiation from the one this call produces and the two are unrelated
// types. Naming the handle through the call itself keeps the annotation and
// the value in step.
const openDrizzle = (client: Pool) => drizzle({ client });
type MysqlHandle = ReturnType<typeof openDrizzle>;

const SOURCE_TABLE = "dc_expr_defaults";
const REBUILT_TABLE = "dc_expr_defaults_rebuilt";

// CALLED, not hand-copied. The suite's premise is that this is the default a
// required JSON, repeater, group or chips field actually gets, and a literal
// copy of the emitter's output would keep passing on a shape Nextly no longer
// emits — agreeing with itself while its docblock still claims to cover the
// production case. Deriving it means an emitter change fails HERE, loudly.
//
// The expected REPORTED text further down stays literal on purpose: that is
// MySQL's normalisation of this DDL, not something this package computes.
const JSON_OBJECT_DEFAULT = quoteJsonSqlDefault("{}", "mysql");

// The emitted JSON default alongside the other expression shapes a live table
// can carry. MySQL reports the first three with the parentheses removed and
// the last two as written.
const SOURCE_DDL = `CREATE TABLE ${SOURCE_TABLE} (
  id int NOT NULL PRIMARY KEY,
  payload json NOT NULL DEFAULT ${JSON_OBJECT_DEFAULT},
  listing json NOT NULL DEFAULT (json_array()),
  ident varchar(36) NOT NULL DEFAULT (uuid()),
  total int NOT NULL DEFAULT ((1 + 2)),
  made_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  seen_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
)`;

// The carve-out's reason, as a table this suite creates itself rather than as
// a claim in a comment. Wrapping CURRENT_TIMESTAMP is accepted by MySQL and
// behaves identically on insert — what it does NOT do is round-trip, and that
// is the whole reason the carve-out exists.
const WRAPPED_CT_TABLE = "dc_expr_defaults_wrapped_ct";

describe.skipIf(!MYSQL_URL)("MySQL expression-default rebuild", () => {
  let bootstrap: Pool;
  let pool: Pool;
  let db: MysqlHandle;

  beforeAll(async () => {
    bootstrap = createPool({ uri: MYSQL_URL });
    await bootstrap.promise().query(`CREATE DATABASE ${DB_NAME}`);
    const url = new URL(MYSQL_URL as string);
    url.pathname = `/${DB_NAME}`;
    pool = createPool({ uri: url.toString() });
    db = openDrizzle(pool);
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

  it("keeps CURRENT_TIMESTAMP bare, because the wrapped form does not round-trip", async () => {
    // The carve-out's reason, OBSERVED rather than asserted. Wrapping every
    // expression uniformly is not a parse failure — MySQL accepts
    // `DEFAULT (CURRENT_TIMESTAMP)` — so nothing in the rebuild test above
    // would have caught it. What it does is rewrite the default to `now()`,
    // which introspection then reads back, so a snapshot that wrapped it would
    // disagree with its own table on every subsequent read and the diff would
    // report drift that is not there.
    await pool
      .promise()
      .query(
        `CREATE TABLE ${WRAPPED_CT_TABLE} (id int NOT NULL PRIMARY KEY, made_at datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP))`
      );

    const wrapped = await introspectLiveSnapshot(db, "mysql", [
      WRAPPED_CT_TABLE,
    ]);
    const wrappedDefault = wrapped.tables
      .find(t => t.name === WRAPPED_CT_TABLE)!
      .columns.find(c => c.name === "made_at")!.default;

    // The server rewrote it: the text that went in is not the text that comes
    // back. This is what the bare form is protected from.
    expect(wrappedDefault).toBe("(now())");

    const bare = await introspectLiveSnapshot(db, "mysql", [SOURCE_TABLE]);
    const byName = new Map(
      bare.tables
        .find(t => t.name === SOURCE_TABLE)!
        .columns.map(c => [c.name, c.default])
    );

    expect(byName.get("made_at")).toBe("CURRENT_TIMESTAMP");
    expect(byName.get("seen_at")).toBe("CURRENT_TIMESTAMP(3)");
  });
});
