// F10 PR 2 — real-PG integration test for scope + summary roundtrip.
//
// Verifies that the new nullable columns added in F10 PR 1 actually
// accept inserts and return correct values when DrizzleMigrationJournal
// writes scope at recordStart and summary at recordEnd.
//
// Auto-skips when TEST_POSTGRES_URL isn't set (matches F18's
// integration-test convention).

import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { makeTestContext } from "../../../../database/__tests__/integration/helpers/test-db.js";
import { nextlyMigrationJournalPg } from "../../../../schemas/migration-journal/index.js";
import { DrizzleMigrationJournal } from "../migration-journal.js";

const ctx = makeTestContext("postgresql");

describe("DrizzleMigrationJournal — F10 PR 2 scope+summary roundtrip (real PG)", () => {
  if (!ctx.available || !ctx.url) {
    it.skip("Skipping — TEST_POSTGRES_URL not set", () => {});
    return;
  }

  let pool: Pool;
  let db: ReturnType<typeof drizzle>;

  beforeAll(async () => {
    pool = new Pool({ connectionString: ctx.url ?? undefined });
    db = drizzle(pool);

    // Create the journal table from raw SQL mirroring the Drizzle
    // schema in `schemas/migration-journal/postgres.ts`. We avoid
    // pushSchema here so the test stays focused on the column-roundtrip
    // contract rather than the full apply pipeline.
    await pool.query('DROP TABLE IF EXISTS "nextly_migration_journal"');
    await pool.query(`
      CREATE TABLE "nextly_migration_journal" (
        "id" text PRIMARY KEY,
        "source" varchar(20) NOT NULL,
        "status" varchar(20) NOT NULL DEFAULT 'in_progress',
        "started_at" timestamptz NOT NULL,
        "ended_at" timestamptz,
        "duration_ms" integer,
        "statements_planned" integer NOT NULL DEFAULT 0,
        "statements_executed" integer,
        "renames_applied" integer,
        "error_code" varchar(64),
        "error_message" text,
        "scope_kind" varchar(20),
        "scope_slug" text,
        "summary_added" integer,
        "summary_removed" integer,
        "summary_renamed" integer,
        "summary_changed" integer
      )
    `);
  });

  afterAll(async () => {
    if (pool) {
      await pool
        .query('DROP TABLE IF EXISTS "nextly_migration_journal"')
        .catch(() => {});
      await pool.end();
    }
  });

  it("persists collection scope + full summary on a successful apply", async () => {
    const journal = new DrizzleMigrationJournal({
      db,
      dialect: "postgresql",
      logger: { warn: () => {} },
    });

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

    const rows = await db
      .select()
      .from(nextlyMigrationJournalPg)
      .where(eq(nextlyMigrationJournalPg.id, id));

    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.source).toBe("ui");
    expect(row.status).toBe("success");
    expect(row.scopeKind).toBe("collection");
    expect(row.scopeSlug).toBe("posts");
    expect(row.summaryAdded).toBe(2);
    expect(row.summaryRemoved).toBe(0);
    expect(row.summaryRenamed).toBe(1);
    expect(row.summaryChanged).toBe(0);
    expect(row.statementsExecuted).toBe(3);
  });

  it("persists fresh-push scope (no slug) and leaves summary NULL when omitted", async () => {
    const journal = new DrizzleMigrationJournal({
      db,
      dialect: "postgresql",
      logger: { warn: () => {} },
    });

    const id = await journal.recordStart({
      source: "code",
      statementsPlanned: 5,
      scope: { kind: "fresh-push" },
    });

    await journal.recordEnd(id, {
      success: true,
      statementsExecuted: 5,
    });

    const rows = await db
      .select()
      .from(nextlyMigrationJournalPg)
      .where(eq(nextlyMigrationJournalPg.id, id));

    expect(rows[0].scopeKind).toBe("fresh-push");
    expect(rows[0].scopeSlug).toBeNull();
    expect(rows[0].summaryAdded).toBeNull();
    expect(rows[0].summaryRemoved).toBeNull();
    expect(rows[0].summaryRenamed).toBeNull();
    expect(rows[0].summaryChanged).toBeNull();
  });

  it("legacy callers (no scope, no summary) leave all 6 new columns NULL", async () => {
    const journal = new DrizzleMigrationJournal({
      db,
      dialect: "postgresql",
      logger: { warn: () => {} },
    });

    const id = await journal.recordStart({
      source: "code",
      statementsPlanned: 1,
    });

    await journal.recordEnd(id, {
      success: true,
      statementsExecuted: 1,
    });

    const rows = await db
      .select()
      .from(nextlyMigrationJournalPg)
      .where(eq(nextlyMigrationJournalPg.id, id));

    expect(rows[0].scopeKind).toBeNull();
    expect(rows[0].scopeSlug).toBeNull();
    expect(rows[0].summaryAdded).toBeNull();
    expect(rows[0].summaryRemoved).toBeNull();
    expect(rows[0].summaryRenamed).toBeNull();
    expect(rows[0].summaryChanged).toBeNull();
  });

  it("persists summary on failed apply (partial-progress audit)", async () => {
    const journal = new DrizzleMigrationJournal({
      db,
      dialect: "postgresql",
      logger: { warn: () => {} },
    });

    const id = await journal.recordStart({
      source: "ui",
      statementsPlanned: 4,
      scope: { kind: "collection", slug: "authors" },
    });

    await journal.recordEnd(id, {
      success: false,
      statementsExecuted: 2,
      error: new Error("constraint violation"),
      summary: { added: 1, removed: 0, renamed: 0, changed: 0 },
    });

    const rows = await db
      .select()
      .from(nextlyMigrationJournalPg)
      .where(eq(nextlyMigrationJournalPg.id, id));

    expect(rows[0].status).toBe("failed");
    expect(rows[0].errorMessage).toContain("constraint violation");
    expect(rows[0].summaryAdded).toBe(1);
    expect(rows[0].scopeSlug).toBe("authors");
  });
});
