// What a failing statement is REPORTED as, measured against a real database.
//
// The classifier reads the error it is handed, and by the time a query error
// reaches it the driver's own error is two `cause` levels down: the adapter
// sees a DrizzleQueryError whose message is the SQL statement, not the
// driver's "UNIQUE constraint failed: ...". Classifying from that message
// means classifying from the QUERY TEXT, which is how a unique violation came
// to be reported as a timeout.
//
// A timeout is the kind most likely to be treated as transient and retried, so
// misreporting a permanent failure as one turns a clean refusal into an
// indefinite retry.

import type { TableDefinition } from "@nextlyhq/adapter-drizzle/types";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createSqliteAdapter } from "../index";

const TABLE = "int_sqlite_error_kinds";

/**
 * The table carries `locked_by`/`locked_until` deliberately.
 *
 * Those names are not decoration: `nextly_users`, `nextly_webhook_deliveries`
 * and `nextly_jobs` all carry a `locked_*` column, and it is their presence in
 * the SQL text that triggered the misclassification. A fixture without them
 * would exercise the same code path and never reproduce the defect.
 */
const TABLE_DEFINITION: TableDefinition = {
  name: TABLE,
  columns: [
    { name: "id", type: "text", primaryKey: true },
    { name: "dedupe_key", type: "text", unique: true },
    { name: "locked_by", type: "text" },
    { name: "locked_until", type: "integer" },
  ],
};

const rows = sqliteTable(TABLE, {
  id: text("id").primaryKey(),
  dedupeKey: text("dedupe_key"),
  lockedBy: text("locked_by"),
  lockedUntil: integer("locked_until", { mode: "timestamp" }),
});

describe("SQLite error classification", () => {
  let adapter: ReturnType<typeof createSqliteAdapter>;

  beforeAll(async () => {
    adapter = createSqliteAdapter({ memory: true });
    await adapter.connect();
    await adapter.createTable(TABLE_DEFINITION);
    adapter.setTableResolver({
      getTable: (name: string) => (name === TABLE ? rows : null),
    });
  });

  afterAll(async () => {
    await adapter.disconnect();
  });

  it("reports a duplicate key as a unique violation, not a timeout", async () => {
    await adapter.insert(TABLE, { id: "a", dedupe_key: "K" });

    let caught: unknown;
    try {
      await adapter.insert(TABLE, { id: "b", dedupe_key: "K" });
    } catch (error) {
      caught = error;
    }

    // The premise: something was actually refused. Without this the assertion
    // below could pass against a database that accepted both rows.
    expect(caught).toBeDefined();
    expect((caught as { kind?: string }).kind).toBe("unique_violation");
  });

  it("still reports a genuinely locked database as a timeout", async () => {
    // The control for the fix. Making the classifier stop matching the SQL
    // text must not make it blind to the condition that matching was there to
    // catch — otherwise the test above could be satisfied by a classifier that
    // simply never says "timeout".
    const busy = Object.assign(new Error("database is locked"), {
      code: "SQLITE_BUSY",
    });
    const classified = (
      adapter as unknown as {
        classifyError(error: unknown, sql?: string): { kind: string };
      }
    ).classifyError(busy);
    expect(classified.kind).toBe("timeout");
  });
});
