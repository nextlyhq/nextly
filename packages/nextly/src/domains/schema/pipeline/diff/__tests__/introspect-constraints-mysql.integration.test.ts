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
import { createPool, type Pool } from "mysql2";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { diffSnapshots } from "../diff";
import { introspectLiveSnapshot } from "../introspect-live";

const URL = process.env.TEST_MYSQL_URL ?? "";
const describeMysql = describe.skipIf(!URL);

const TABLE = "nx_intro_fx_linked";
const REF = "nx_intro_owners";
const ESCAPED = "nx_intro_escaped";

describeMysql("mysql constraint introspection", () => {
  let pool: Pool;
  let db: unknown;
  // Statements go through the promise wrapper of the same pool.
  const query = (text: string) => pool.promise().query(text);

  beforeAll(async () => {
    if (!URL) return;
    // A callback pool, not one from `mysql2/promise`: drizzle's mysql2 driver
    // sets `client.config.supportBigNumbers` on the client it is given, and a
    // promise pool has no `config`, so construction threw before any test ran.
    pool = createPool({ uri: URL });
    await query(`DROP TABLE IF EXISTS \`${TABLE}\``);
    await query(`DROP TABLE IF EXISTS \`${REF}\``);
    await query(`CREATE TABLE \`${REF}\` (id VARCHAR(36) PRIMARY KEY)`);
    await query(`CREATE TABLE \`${TABLE}\` (
      id VARCHAR(36) PRIMARY KEY,
      owner_id VARCHAR(36) NOT NULL,
      score INTEGER,
      CONSTRAINT fk_${TABLE}_owner FOREIGN KEY (owner_id)
        REFERENCES \`${REF}\` (id) ON DELETE CASCADE ON UPDATE NO ACTION,
      CONSTRAINT ck_${TABLE}_score CHECK (score >= 0)
    )`);
    // Values information_schema has to escape: a quote, and a backslash
    // written as hex so its value does not depend on this session's sql_mode.
    await query(`DROP TABLE IF EXISTS \`${ESCAPED}\``);
    await query(`CREATE TABLE \`${ESCAPED}\` (
      s VARCHAR(36),
      CONSTRAINT ck_quote CHECK (s IN ('it''s', 'x')),
      CONSTRAINT ck_backslash CHECK (s IN ('a', _utf8mb4 X'615C62'))
    )`);
    db = drizzle({ client: pool });
  });

  afterAll(async () => {
    if (!URL) return;
    await query(`DROP TABLE IF EXISTS \`${TABLE}\``);
    await query(`DROP TABLE IF EXISTS \`${REF}\``);
    await query(`DROP TABLE IF EXISTS \`${ESCAPED}\``);
    await new Promise<void>(resolve => pool.end(() => resolve()));
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

  it("leaves out the index MySQL created to back a foreign key, so a declared one is still added", async () => {
    // The CREATE TABLE above declares no index on owner_id, so MySQL made one
    // named after the constraint. Reported as an index, it shares its key with
    // an index declared on the same column, and the diff never added that one.
    const raw = (await query(
      `SELECT INDEX_NAME FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${TABLE}'
         AND INDEX_NAME = 'fk_${TABLE}_owner'`
    )) as unknown as [unknown[], unknown];
    // The server really has it — without this the assertions below would
    // pass on a table that never had the index to leave out.
    expect(raw[0]).toHaveLength(1);

    const snapshot = await introspectLiveSnapshot(db, "mysql", [TABLE]);
    const live = snapshot.tables[0];
    if (live === undefined) throw new Error("expected the table");
    expect(live.indexes?.map(index => index.name)).not.toContain(
      `fk_${TABLE}_owner`
    );
    const declaredIndex = {
      name: `idx_${TABLE}_owner_id`,
      columns: ["owner_id"],
      unique: false,
    };
    expect(
      diffSnapshots(
        { tables: [live] },
        {
          tables: [
            { ...live, indexes: [...(live.indexes ?? []), declaredIndex] },
          ],
        }
      )
    ).toEqual([{ type: "add_index", tableName: TABLE, index: declaredIndex }]);
  });

  it("reads checks as MySQL printed them, information_schema's escaping undone", async () => {
    // CHECK_CLAUSE stores `(\`score\` >= 0)`; that is valid DDL as it stands,
    // so it is recorded as is rather than reshaped as text.
    const snapshot = await introspectLiveSnapshot(db, "mysql", [TABLE]);
    expect(snapshot.tables[0]?.checks).toEqual([
      { name: `ck_${TABLE}_score`, sql: "(`score` >= 0)" },
    ]);
  });

  it("a check reads as the same check it was declared as", async () => {
    const snapshot = await introspectLiveSnapshot(db, "mysql", [TABLE]);
    const live = snapshot.tables[0];
    if (live === undefined) throw new Error("expected the table");
    const declared = {
      ...live,
      checks: [{ name: `ck_${TABLE}_score`, sql: "score >= 0" }],
    };
    expect(diffSnapshots({ tables: [live] }, { tables: [declared] })).toEqual(
      []
    );
  });

  it("undoes exactly one layer of escaping, leaving MySQL's own", async () => {
    // CHECK_CLAUSE stores these as _utf8mb4\'it\\\'s\' and
    // _utf8mb4\'a\\\\b\'. One layer off leaves the clause as MySQL printed
    // it, where a quote inside a string is \' and a backslash is \\.
    const snapshot = await introspectLiveSnapshot(db, "mysql", [ESCAPED]);
    const checks = [...(snapshot.tables[0]?.checks ?? [])].sort((a, b) =>
      a.name < b.name ? -1 : 1
    );
    expect(checks).toEqual([
      {
        name: "ck_backslash",
        sql: "(`s` in (_utf8mb4'a',_utf8mb4'a\\\\b'))",
      },
      { name: "ck_quote", sql: "(`s` in (_utf8mb4'it\\'s',_utf8mb4'x'))" },
    ]);
  });

  it("a quoted value reads as its declaration; a backslash value does not", async () => {
    // The backslash clause is re-read by MySQL under whichever sql_mode opens
    // the table, so its value is not knowable from the text and the diff must
    // report it rather than claim a match.
    const snapshot = await introspectLiveSnapshot(db, "mysql", [ESCAPED]);
    const live = snapshot.tables[0];
    if (live === undefined) throw new Error("expected the table");
    const declared = {
      ...live,
      checks: [
        { name: "ck_quote", sql: "s IN ('it''s', 'x')" },
        { name: "ck_backslash", sql: "s IN ('a', 'a\\b')" },
      ],
    };
    const ops = diffSnapshots({ tables: [live] }, { tables: [declared] });
    expect(
      ops.map(op => ("check" in op ? `${op.type}:${op.check.name}` : op.type))
    ).toEqual(["drop_check:ck_backslash", "add_check:ck_backslash"]);
  });

  it("a table with no constraints reports empty lists, not undefined", async () => {
    const snapshot = await introspectLiveSnapshot(db, "mysql", [REF]);
    expect(snapshot.tables[0]?.foreignKeys).toEqual([]);
    expect(snapshot.tables[0]?.checks).toEqual([]);
  });
});
