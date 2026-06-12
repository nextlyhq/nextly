// Guards the `nextly_schema_events` ledger against the data-loss "orphan drop"
// bug. The ledger is a Nextly-managed table declared in the apply pipeline's
// desired schema (PushSchemaPipeline.buildDrizzleSchema), so drizzle-kit must
// see the raw-DDL-created table (getSchemaEventsDdl) as a clean match — no
// data-loss warning ("nextly_schema_events table with N items") and no
// statements. This requires the raw DDL and the Drizzle def to round-trip
// exactly: the SQLite PK is NOT NULL, and neither side declares a partial
// unique index (drizzle-kit 0.31.10 can't round-trip one — "one applied row
// per file" is enforced in app code instead).

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { describe, it, expect } from "vitest";

import { getSQLiteDrizzleKit } from "../../../../database/drizzle-kit-lazy";
import { nextlySchemaEventsSqlite } from "../../../../schemas/schema-events/sqlite";
import { getSchemaEventsDdl } from "../schema-events-ddl";

describe("nextly_schema_events declared-as-managed (sqlite)", () => {
  it("raw-DDL-created, populated ledger round-trips with no changes or warnings", async () => {
    const sqlite = new Database(":memory:");
    const db = drizzle(sqlite);

    // Create the ledger exactly as first-run / `nextly upgrade` does, with a row.
    for (const stmt of getSchemaEventsDdl("sqlite")) sqlite.exec(stmt);
    sqlite
      .prepare(
        `INSERT INTO nextly_schema_events
           (id, event_type, status, source, started_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run("evt-1", "file_apply", "applied", "code", 1_700_000_000_000);

    const kit = await getSQLiteDrizzleKit();
    const result = await kit.pushSchema(
      { nextlySchemaEvents: nextlySchemaEventsSqlite },
      db
    );

    sqlite.close();

    // Clean round-trip: no data-loss warning (the orphan-drop bug) and no
    // churn — drizzle-kit wants to change nothing.
    expect(result.warnings).toEqual([]);
    expect(result.statementsToExecute).toEqual([]);
  });
});
