/**
 * Live constraint introspection on a real SQLite.
 *
 * The diff matches foreign keys and checks by NAME, so the live side must
 * spell names exactly the way the compiler does — derived from the FINAL
 * table name, parenthesis-balanced for expressions that themselves contain
 * parentheses. A unit test with fake rows cannot prove either property;
 * only the engine's own PRAGMAs and stored CREATE statements can.
 *
 * @module domains/schema/pipeline/diff/__tests__/introspect-constraints.integration
 */
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { foreignKeyNameForColumns } from "../../../services/index-name";
import { introspectLiveSnapshot } from "../introspect-live";

describe("sqlite constraint introspection", () => {
  let sqlite: Database.Database;

  beforeAll(() => {
    sqlite = new Database(":memory:");
    sqlite.exec(`CREATE TABLE owners (
      id TEXT PRIMARY KEY
    )`);
    sqlite.exec(`CREATE TABLE fx__linked (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      score INTEGER,
      CONSTRAINT fk_fx__linked_owner_id FOREIGN KEY (owner_id)
        REFERENCES owners (id) ON DELETE CASCADE ON UPDATE NO ACTION,
      CONSTRAINT ck_fx__linked_score_ok CHECK (score >= 0 AND (score IS NULL OR score < 1000))
    )`);
  });
  afterAll(() => sqlite.close());

  it("reads foreign keys with derived names and mapped actions", async () => {
    const snapshot = await introspectLiveSnapshot(
      drizzle({ client: sqlite }),
      "sqlite",
      ["fx__linked"]
    );
    expect(snapshot.tables[0]?.foreignKeys).toEqual([
      {
        name: "fk_fx__linked_owner_id",
        columns: ["owner_id"],
        referencesTable: "owners",
        referencesColumns: ["id"],
        onDelete: "cascade",
        onUpdate: "no action",
      },
    ]);
  });

  it("reads named checks with parenthesis-balanced expressions", async () => {
    const snapshot = await introspectLiveSnapshot(
      drizzle({ client: sqlite }),
      "sqlite",
      ["fx__linked"]
    );
    expect(snapshot.tables[0]?.checks).toEqual([
      {
        name: "ck_fx__linked_score_ok",
        sql: "score >= 0 AND (score IS NULL OR score < 1000)",
      },
    ]);
  });

  it("reads an explicitly named foreign key by the name it was declared with", async () => {
    // The desired side carries an author's explicit name verbatim, so a live
    // side that derived the name instead would never match it: a drop and an
    // add on every diff, which on SQLite is a rebuild of the table.
    sqlite.exec(`CREATE TABLE fx__named (
      id TEXT PRIMARY KEY,
      owner_id TEXT,
      CONSTRAINT "fx_named_owner_link" FOREIGN KEY ("owner_id")
        REFERENCES "owners" ("id") ON DELETE CASCADE
    )`);
    const snapshot = await introspectLiveSnapshot(
      drizzle({ client: sqlite }),
      "sqlite",
      ["fx__named"]
    );
    expect(snapshot.tables[0]?.foreignKeys?.map(fk => fk.name)).toEqual([
      "fx_named_owner_link",
    ]);
  });

  it("names an unnamed foreign key with the compiler's own bounded rule", async () => {
    // Long enough that the plain `fk_<table>_<cols>` exceeds the identifier
    // bound, so only the shared namer's hashed spelling matches the desired
    // side.
    const table = `fx__${"a_really_long_table_name_".repeat(3)}notes`;
    const column = "an_owner_reference_column_with_a_long_name_id";
    sqlite.exec(`CREATE TABLE "${table}" (
      id TEXT PRIMARY KEY,
      ${column} TEXT REFERENCES owners (id)
    )`);
    const snapshot = await introspectLiveSnapshot(
      drizzle({ client: sqlite }),
      "sqlite",
      [table]
    );
    const expected = foreignKeyNameForColumns(table, [column]);
    expect(expected).not.toBe(`fk_${table}_${column}`);
    expect(snapshot.tables[0]?.foreignKeys?.map(fk => fk.name)).toEqual([
      expected,
    ]);
  });

  it("a table with no constraints reports empty lists, not undefined", async () => {
    const snapshot = await introspectLiveSnapshot(
      drizzle({ client: sqlite }),
      "sqlite",
      ["owners"]
    );
    expect(snapshot.tables[0]?.foreignKeys).toEqual([]);
    expect(snapshot.tables[0]?.checks).toEqual([]);
  });
});
