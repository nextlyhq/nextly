// Postgres counterpart of schema-events-roundtrip.integration.test.ts.
//
// On Postgres the ledger keeps its partial unique index (drizzle-kit CAN
// round-trip a PG partial index, unlike SQLite — drizzle-team/drizzle-orm#4688
// is SQLite/D1-only). This guards that property: once `nextly_schema_events`
// became a core table flowing through drizzle-kit's PG diff, a predicate
// mismatch between the raw DDL (getSchemaEventsDdl) and the Drizzle def
// (nextlySchemaEventsPg) would churn DROP/CREATE INDEX on every push. It must
// be a clean no-op instead.
//
// Skips unless TEST_POSTGRES_URL (or legacy TEST_DATABASE_URL) points at a
// reachable Postgres. The scope is narrowed to the ledger via tablesFilter so
// other tables in the test DB don't pollute the diff.

import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { describe, it, expect } from "vitest";

import { getPgDrizzleKit } from "../../../../database/drizzle-kit-lazy";
import { nextlySchemaEventsPg } from "../../../../schemas/schema-events/postgres";
import { getSchemaEventsDdl } from "../schema-events-ddl";

const TEST_DB_URL =
  process.env.TEST_POSTGRES_URL ?? process.env.TEST_DATABASE_URL ?? "";

const canConnect = async (): Promise<boolean> => {
  if (!TEST_DB_URL) return false;
  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  } finally {
    await pool.end();
  }
};

describe("nextly_schema_events declared-as-managed (postgres)", async () => {
  if (!(await canConnect())) {
    it.skip("Skipping: Test PostgreSQL not available", () => {});
    return;
  }

  it("raw-DDL-created, populated ledger round-trips with no index churn or warnings", async () => {
    const pool = new Pool({ connectionString: TEST_DB_URL });
    const db = drizzle({ client: pool });

    // Recreate the ledger exactly as first-run / `nextly upgrade` does, with a row.
    await pool.query(`DROP TABLE IF EXISTS "nextly_schema_events" CASCADE;`);
    for (const stmt of getSchemaEventsDdl("postgresql")) await pool.query(stmt);
    await pool.query(
      `INSERT INTO "nextly_schema_events"
         (id, event_type, status, source, started_at)
       VALUES ($1, $2, $3, $4, now())`,
      ["evt-1", "file_apply", "applied", "code"]
    );

    const kit = await getPgDrizzleKit();
    // v1 named entities filter scopes introspection to just the ledger.
    const result = await kit.pushSchema(
      { nextlySchemaEvents: nextlySchemaEventsPg },
      db,
      { schemas: ["public"], tables: ["nextly_schema_events"] }
    );

    await pool.query(`DROP TABLE IF EXISTS "nextly_schema_events" CASCADE;`);
    await pool.end();

    // Clean round-trip for the ledger: no churn touching nextly_schema_events
    // (covers the partial unique index AND the started_at default). Filter to
    // ledger statements so unrelated objects in a shared/populated test DB (e.g.
    // orphan sequences from other tables, which tablesFilter doesn't scope) don't
    // fail this assertion — on a clean DB the list is empty either way.
    const ledgerChurn = result.sqlStatements.filter(s =>
      s.includes("nextly_schema_events")
    );
    expect(ledgerChurn).toEqual([]);
    const ledgerHints = result.hints.filter(h =>
      `${h.hint} ${h.statement ?? ""}`.includes("nextly_schema_events")
    );
    expect(ledgerHints).toEqual([]);
  });
});
