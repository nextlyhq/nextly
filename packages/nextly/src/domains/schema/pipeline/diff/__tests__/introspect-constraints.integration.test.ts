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
