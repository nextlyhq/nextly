/**
 * @module schemas/schema-events/__tests__/columns
 * @since v0.0.3-alpha (Plan B)
 */
import { getColumns, getTableName } from "drizzle-orm";
import { describe, it, expect } from "vitest";

import { getSchemaEventsDdl } from "../../../domains/schema/events/schema-events-ddl";
import { nextlySchemaEventsPg } from "../postgres";

/**
 * Pull the column names out of a `CREATE TABLE ( ... )` statement: the first
 * token on each line inside the parentheses. Good enough for our own DDL,
 * whose column list is one-per-line.
 */
function ddlColumnNames(createTableStmt: string): string[] {
  const body = createTableStmt.slice(
    createTableStmt.indexOf("(") + 1,
    createTableStmt.lastIndexOf(")")
  );
  return body
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => line.split(/[\s(]/)[0].replace(/["`]/g, ""))
    .filter(tok => /^[a-z_][a-z0-9_]*$/.test(tok));
}

const EXPECTED_COLUMNS = [
  "id",
  "event_type",
  "status",
  "source",
  "filename",
  "sha256",
  "scope_kind",
  "scope_slug",
  "started_at",
  "ended_at",
  "duration_ms",
  "applied_by",
  "note",
  "statements_planned",
  "statements_executed",
  "renames_applied",
  "error_code",
  "error_message",
  "error_json",
  "superseded_event_ids",
  "superseded_at",
  "superseded_by",
].sort();

describe("nextly_schema_events — postgres", () => {
  it("is named nextly_schema_events", () => {
    expect(getTableName(nextlySchemaEventsPg)).toBe("nextly_schema_events");
  });
  it("has exactly the spec §4.3 columns", () => {
    const names = Object.values(getColumns(nextlySchemaEventsPg))
      .map(c => c.name)
      .sort();
    expect(names).toEqual(EXPECTED_COLUMNS);
  });
  it("requires event_type/status/source (notNull)", () => {
    const cols = getColumns(nextlySchemaEventsPg);
    expect(cols.eventType.notNull).toBe(true);
    expect(cols.status.notNull).toBe(true);
    expect(cols.source.notNull).toBe(true);
  });
});

describe.each([
  ["mysql", () => import("../mysql").then(m => m.nextlySchemaEventsMysql)],
  ["sqlite", () => import("../sqlite").then(m => m.nextlySchemaEventsSqlite)],
])("nextly_schema_events — %s", (_name, load) => {
  it("matches the canonical column set", async () => {
    const table = await load();
    const names = Object.values(getColumns(table))
      .map(c => c.name)
      .sort();
    expect(names).toEqual(EXPECTED_COLUMNS);
  });
});

// The raw DDL (getSchemaEventsDdl) is a second, hand-written copy of the
// table used by `nextly upgrade` and by integration-test setup. It once
// drifted from the model (a missing `note` column), so pin it to the same
// canonical column set per dialect — any divergence now fails CI here, in a
// unit test that needs no database.
describe.each(["postgresql", "mysql", "sqlite"] as const)(
  "getSchemaEventsDdl — %s stays in sync with the model",
  dialect => {
    it("creates exactly the canonical columns", () => {
      const createTable = getSchemaEventsDdl(dialect)[0];
      expect(ddlColumnNames(createTable).sort()).toEqual(EXPECTED_COLUMNS);
    });
  }
);
