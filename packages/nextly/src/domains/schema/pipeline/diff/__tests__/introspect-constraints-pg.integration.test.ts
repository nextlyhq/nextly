/**
 * Live constraint introspection against a real PostgreSQL.
 *
 * The SQL here reads pg_constraint with unnest-with-ordinality for composite
 * column order and pg_get_constraintdef for check expressions — properties a
 * mocked row set cannot prove. Gated on TEST_POSTGRES_URL like the other
 * PostgreSQL integration tests; CI's postgres legs run it.
 *
 * @module domains/schema/pipeline/diff/__tests__/introspect-constraints-pg.integration
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { diffSnapshots } from "../diff";
import { introspectLiveSnapshot } from "../introspect-live";

const URL = process.env.TEST_POSTGRES_URL ?? "";
const describePg = describe.skipIf(!URL);

const TABLE = "nx_intro_fx_linked";
const REF = "nx_intro_owners";

describePg("pg constraint introspection", () => {
  let client: Client;
  let db: unknown;

  beforeAll(async () => {
    if (!URL) return;
    client = new Client({ connectionString: URL });
    await client.connect();
    await client.query(`DROP TABLE IF EXISTS ${TABLE}`);
    await client.query(`DROP TABLE IF EXISTS ${REF}`);
    await client.query(`CREATE TABLE ${REF} (id TEXT PRIMARY KEY)`);
    await client.query(`CREATE TABLE ${TABLE} (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      score INTEGER,
      CONSTRAINT fk_${TABLE}_owner FOREIGN KEY (owner_id)
        REFERENCES ${REF} (id) ON DELETE CASCADE ON UPDATE NO ACTION,
      CONSTRAINT ck_${TABLE}_score CHECK (score >= 0 AND (score IS NULL OR score < 1000))
    )`);
    db = drizzle({ client });
  });

  afterAll(async () => {
    if (!URL) return;
    await client.query(`DROP TABLE IF EXISTS ${TABLE}`);
    await client.query(`DROP TABLE IF EXISTS ${REF}`);
    await client.end();
  });

  it("reads foreign keys with catalog names and mapped actions", async () => {
    const snapshot = await introspectLiveSnapshot(db, "postgresql", [TABLE]);
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

  it("reads checks with the definition's expression unwrapped", async () => {
    // Recorded as PostgreSQL deparses it — every subexpression parenthesised —
    // because that text is what the server holds and is valid DDL as it
    // stands. Only the `CHECK (...)` wrapper comes off.
    const snapshot = await introspectLiveSnapshot(db, "postgresql", [TABLE]);
    expect(snapshot.tables[0]?.checks).toEqual([
      {
        name: `ck_${TABLE}_score`,
        sql: "(score >= 0) AND ((score IS NULL) OR (score < 1000))",
      },
    ]);
  });

  it("a check reads as the same check it was declared as", async () => {
    // The deparsed spelling differs from the authored one, so this is the
    // comparison that decides whether the diff sees drift. It must not.
    const snapshot = await introspectLiveSnapshot(db, "postgresql", [TABLE]);
    const live = snapshot.tables[0];
    if (live === undefined) throw new Error("expected the table");
    const declared = {
      ...live,
      checks: [
        {
          name: `ck_${TABLE}_score`,
          sql: "score >= 0 AND (score IS NULL OR score < 1000)",
        },
      ],
    };
    expect(diffSnapshots({ tables: [live] }, { tables: [declared] })).toEqual(
      []
    );
  });

  it("a table with no constraints reports empty lists, not undefined", async () => {
    const snapshot = await introspectLiveSnapshot(db, "postgresql", [REF]);
    expect(snapshot.tables[0]?.foreignKeys).toEqual([]);
    expect(snapshot.tables[0]?.checks).toEqual([]);
  });
});
