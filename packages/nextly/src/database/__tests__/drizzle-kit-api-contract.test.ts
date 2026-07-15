// Contract test for drizzle-kit v1's per-dialect pushSchema result shape.
// What: calls the real SQLite pushSchema (drizzle-kit/payload/sqlite via the
// lazy wrapper) against an in-memory DB and asserts the result object has
// exactly the v1 contract our PushSchemaPipeline relies on
// ({ sqlStatements, hints, apply }) — and that the pre-v1 fields are GONE.
// Why: the payload/* entrypoints are undocumented (built for Payload CMS's
// programmatic use). If a drizzle-kit upgrade reshapes them, this test fails
// loudly instead of the pipeline breaking silently in production.

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { describe, it, expect } from "vitest";

import { getSQLiteDrizzleKit } from "../drizzle-kit-lazy";

// A minimal table so pushSchema has something to diff against an empty DB.
const contractSample = sqliteTable("contract_sample", {
  id: text("id").primaryKey(),
  title: text("title"),
});

// v1 constructor is object-form ONLY: `drizzle(client, cfg)` positional was
// removed and silently misbehaves (treats the client as config and opens a
// NEW :memory: db). Object form guarantees `db.$client === sqlite`, which the
// lazy wrapper's raw-client shim depends on.
function makeDb(sqlite: Database.Database) {
  return drizzle({ client: sqlite });
}

describe("drizzle-kit v1 payload API contract (SQLite)", () => {
  it("pushSchema returns the v1 contract { sqlStatements, hints, apply }", async () => {
    const sqlite = new Database(":memory:");
    const db = makeDb(sqlite);
    const kit = await getSQLiteDrizzleKit();

    const result = await kit.pushSchema(
      { contract_sample: contractSample },
      db
    );

    expect(Array.isArray(result.sqlStatements)).toBe(true);
    expect(Array.isArray(result.hints)).toBe(true);
    expect(typeof result.apply).toBe("function");

    sqlite.close();
  });

  it("does NOT re-expose the pre-v1 field names (no aliasing)", async () => {
    const sqlite = new Database(":memory:");
    const db = makeDb(sqlite);
    const kit = await getSQLiteDrizzleKit();

    const result = await kit.pushSchema(
      { contract_sample: contractSample },
      db
    );

    // Pin that the wrapper adopted the v1 names outright. If any of these
    // reappear, someone added a compatibility alias — forbidden by the
    // drizzle-v1 migration's no-legacy constraint.
    expect(result).not.toHaveProperty("hasDataLoss");
    expect(result).not.toHaveProperty("warnings");
    expect(result).not.toHaveProperty("statementsToExecute");

    sqlite.close();
  });

  it("sqlStatements contains the CREATE TABLE for a brand-new table", async () => {
    const sqlite = new Database(":memory:");
    const db = makeDb(sqlite);
    const kit = await getSQLiteDrizzleKit();

    const result = await kit.pushSchema(
      { contract_sample: contractSample },
      db
    );

    const joined = result.sqlStatements.join("\n").toLowerCase();
    expect(joined).toContain("create table");
    expect(joined).toContain("contract_sample");

    sqlite.close();
  });

  it("apply() executes DDL against the real client (v1 fixed the 0.31 .all() crash)", async () => {
    const sqlite = new Database(":memory:");
    const db = makeDb(sqlite);
    const kit = await getSQLiteDrizzleKit();

    const result = await kit.pushSchema(
      { contract_sample: contractSample },
      db
    );
    await result.apply();

    const tables = sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='contract_sample'"
      )
      .all();
    expect(tables).toHaveLength(1);

    sqlite.close();
  });

  it("INCLUDES destructive statements in sqlStatements (v1 semantic inversion — spike 1.1)", async () => {
    // Pre-v1 kit OMITTED data-losing statements and reported them via
    // `warnings`. v1 includes them with EMPTY hints. The pipeline's
    // destructive-statement scan (Phase D guard) depends on this behavior —
    // if drizzle ever reverts to omission, that guard needs a redesign, so
    // fail loudly here.
    const sqlite = new Database(":memory:");
    sqlite.exec(
      "CREATE TABLE contract_sample (id text PRIMARY KEY NOT NULL, title text, extra text);"
    );
    const db = makeDb(sqlite);
    const kit = await getSQLiteDrizzleKit();

    // Desired schema omits the `extra` column → a destructive DROP COLUMN.
    const result = await kit.pushSchema(
      { contract_sample: contractSample },
      db
    );

    const joined = result.sqlStatements.join("\n").toLowerCase();
    expect(joined).toContain("drop column");
    expect(result.hints).toHaveLength(0);

    sqlite.close();
  });
});
