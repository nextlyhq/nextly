// Plan C1 — real-PG roundtrip: DrizzleMigrationJournal now writes
// `nextly_schema_events`. Verifies recordStart/recordEnd map source +
// scope + outcome onto the events row, read back via SchemaEventsRepository.
//
// Auto-skips when TEST_POSTGRES_URL isn't set (matches the integration-test
// convention).

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { makeTestContext } from "../../../../database/__tests__/integration/helpers/test-db";
import { getSchemaEventsDdl } from "../../events/schema-events-ddl";
import { SchemaEventsRepository } from "../../events/schema-events-repository";
import { DrizzleMigrationJournal } from "../migration-journal";

const ctx = makeTestContext("postgresql");

describe("DrizzleMigrationJournal → nextly_schema_events roundtrip (real PG)", () => {
  if (!ctx.available || !ctx.url) {
    it.skip("Skipping — TEST_POSTGRES_URL not set", () => {});
    return;
  }

  let pool: Pool;
  let db: ReturnType<typeof drizzle>;

  beforeAll(async () => {
    pool = new Pool({ connectionString: ctx.url ?? undefined });
    db = drizzle(pool);

    // Create the events table via the production DDL so this fixture can
    // never drift from the real schema (a hand-copy previously dropped the
    // `note` column and the suite failed against a real Postgres).
    await pool.query('DROP TABLE IF EXISTS "nextly_schema_events"');
    for (const stmt of getSchemaEventsDdl("postgresql")) await pool.query(stmt);
  });

  afterAll(async () => {
    if (pool) {
      await pool
        .query('DROP TABLE IF EXISTS "nextly_schema_events"')
        .catch(() => {});
      await pool.end();
    }
  });

  function makeJournal() {
    return new DrizzleMigrationJournal({
      db,
      dialect: "postgresql",
      logger: { warn: () => {} },
    });
  }

  it("persists collection scope + applied status on a successful apply", async () => {
    const journal = makeJournal();
    const repo = new SchemaEventsRepository(db, "postgresql");

    const id = await journal.recordStart({
      source: "ui",
      statementsPlanned: 3,
      scope: { kind: "collection", slug: "posts" },
    });
    await journal.recordEnd(id, {
      success: true,
      statementsExecuted: 3,
      summary: { added: 2, removed: 0, renamed: 1, changed: 0 },
    });

    const row = await repo.findById(id);
    expect(row?.eventType).toBe("ui_save");
    expect(row?.status).toBe("applied");
    expect(row?.scopeKind).toBe("collection");
    expect(row?.scopeSlug).toBe("posts");
    expect(row?.statementsExecuted).toBe(3);
    // Only renames are carried over from the journal summary (§4.3).
    expect(
      (row as { renamesApplied?: number } | undefined)?.renamesApplied
    ).toBe(1);
  });

  it("maps fresh-push scope → global (events has no fresh-push kind)", async () => {
    const journal = makeJournal();
    const repo = new SchemaEventsRepository(db, "postgresql");

    const id = await journal.recordStart({
      source: "code",
      statementsPlanned: 5,
      scope: { kind: "fresh-push" },
    });
    await journal.recordEnd(id, { success: true, statementsExecuted: 5 });

    const row = await repo.findById(id);
    expect(row?.eventType).toBe("dev_push");
    expect(row?.scopeKind).toBe("global");
    expect(row?.scopeSlug).toBeNull();
  });

  it("records a failed apply with the error message", async () => {
    const journal = makeJournal();
    const repo = new SchemaEventsRepository(db, "postgresql");

    const id = await journal.recordStart({
      source: "ui",
      statementsPlanned: 4,
      scope: { kind: "collection", slug: "authors" },
    });
    await journal.recordEnd(id, {
      success: false,
      statementsExecuted: 2,
      error: new Error("constraint violation"),
    });

    const row = await repo.findById(id);
    expect(row?.status).toBe("failed");
    expect(row?.scopeSlug).toBe("authors");
  });
});
