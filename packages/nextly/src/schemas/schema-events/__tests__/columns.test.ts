/**
 * @module schemas/schema-events/__tests__/columns
 * @since v0.0.3-alpha (Plan B)
 */
import { getTableColumns, getTableName } from "drizzle-orm";
import { describe, it, expect } from "vitest";

import { nextlySchemaEventsPg } from "../postgres";

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
    const names = Object.values(getTableColumns(nextlySchemaEventsPg))
      .map(c => c.name)
      .sort();
    expect(names).toEqual(EXPECTED_COLUMNS);
  });
  it("requires event_type/status/source (notNull)", () => {
    const cols = getTableColumns(nextlySchemaEventsPg);
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
    const names = Object.values(getTableColumns(table))
      .map(c => c.name)
      .sort();
    expect(names).toEqual(EXPECTED_COLUMNS);
  });
});
