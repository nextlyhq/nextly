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
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { pgTable, serial, text as pgText } from "drizzle-orm/pg-core";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { Pool } from "pg";
import { describe, it, expect } from "vitest";

import { getPgDrizzleKit, getSQLiteDrizzleKit } from "../drizzle-kit-lazy";

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

  it("throws (never prompts, never hangs) on an ambiguous drop+add rename shape", async () => {
    // v1's differ pairs a dropped column with an added column and invokes its
    // rename resolver — which has no hints channel on the programmatic path
    // and throws `Internal error: resolver(column) was called without a
    // HintsHandler`. That deterministic, catchable error replaces 0.31's
    // interactive TTY prompt (which hung unwatched terminals and crashed
    // non-TTY environments). The pipeline's pre-resolution design guarantees
    // drizzle-kit never sees this shape in production; this test pins the
    // failure mode in case it ever does. If this starts RETURNING instead of
    // throwing, the programmatic hints channel probably shipped — revisit the
    // wrapper to pass resolutions through.
    const sqlite = new Database(":memory:");
    sqlite.exec(
      "CREATE TABLE contract_sample (id text PRIMARY KEY NOT NULL, title text);"
    );
    const db = makeDb(sqlite);
    const kit = await getSQLiteDrizzleKit();

    const renamed = sqliteTable("contract_sample", {
      id: text("id").primaryKey(),
      name: text("name"),
    });
    await expect(
      kit.pushSchema({ contract_sample: renamed }, db)
    ).rejects.toThrow(/HintsHandler/);

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

// PG variant — runs only when a test database is configured (docker matrix in
// CI, `docker compose -f docker-compose.test.yml up -d` locally). Covers the
// dialect where pushSchema takes a real drizzle instance plus the named
// entities filter — surface the SQLite test cannot reach.
describe.skipIf(!process.env.TEST_POSTGRES_URL)(
  "drizzle-kit v1 payload API contract (PostgreSQL)",
  () => {
    const contractSamplePg = pgTable("contract_sample_pg", {
      id: serial("id").primaryKey(),
      title: pgText("title"),
    });

    it("pushSchema accepts a NodePgDatabase + entitiesConfig and returns the v1 contract", async () => {
      const pool = new Pool({
        connectionString: process.env.TEST_POSTGRES_URL,
      });
      const db = drizzlePg({ client: pool });
      const kit = await getPgDrizzleKit();

      try {
        await pool.query('DROP TABLE IF EXISTS "contract_sample_pg"');
        const result = await kit.pushSchema(
          { contract_sample_pg: contractSamplePg },
          db,
          { schemas: ["public"], tables: ["contract_sample_pg"] }
        );

        expect(Array.isArray(result.sqlStatements)).toBe(true);
        expect(Array.isArray(result.hints)).toBe(true);
        expect(typeof result.apply).toBe("function");
        expect(result).not.toHaveProperty("statementsToExecute");
        const joined = result.sqlStatements.join("\n").toLowerCase();
        expect(joined).toContain("create table");
        expect(joined).toContain("contract_sample_pg");
      } finally {
        await pool.query('DROP TABLE IF EXISTS "contract_sample_pg"');
        await pool.end();
      }
    });
  }
);
