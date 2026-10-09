/**
 * The ledger bootstrap every migrate entry point runs: create the events
 * table when the database lacks it, and leave one that exists alone.
 */
import { describe, expect, it, vi } from "vitest";

import {
  ensureSchemaEventsTable,
  getSchemaEventsDdl,
} from "../schema-events-ddl";

describe("ensureSchemaEventsTable", () => {
  it("runs the dialect's DDL, in order, when the table is missing", async () => {
    const executeQuery = vi.fn(async (_sql: string) => undefined);
    await ensureSchemaEventsTable({
      dialect: "postgresql",
      tableExists: async () => false,
      executeQuery,
    });
    expect(executeQuery.mock.calls.map(([sql]) => sql)).toEqual(
      getSchemaEventsDdl("postgresql")
    );
  });

  it("runs nothing when the table exists", async () => {
    const executeQuery = vi.fn(async (_sql: string) => undefined);
    await ensureSchemaEventsTable({
      dialect: "sqlite",
      tableExists: async name => name === "nextly_schema_events",
      executeQuery,
    });
    expect(executeQuery).not.toHaveBeenCalled();
  });
});
