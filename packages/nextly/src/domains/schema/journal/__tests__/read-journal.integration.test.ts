// F10 PR 4 — real-PG integration test for `readJournal` pagination.
//
// Seeds N rows with deterministic `started_at` timestamps and verifies
// the cursor-based pagination contract end-to-end against real PG:
//   1. First page returns the latest `limit` rows newest-first +
//      hasMore=true when more exist.
//   2. Second page using `before=<oldest of page 1>` returns the next
//      page + hasMore correctly reflects remaining rows.
//   3. NULL scope_kind / summary columns surface as null in the API
//      shape (forward-compat for legacy rows).
//
// Auto-skips when TEST_POSTGRES_URL isn't set (matches F18 convention).

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { makeTestContext } from "../../../../database/__tests__/integration/helpers/test-db.js";
import { readJournal } from "../read-journal.js";

const ctx = makeTestContext("postgresql");

describe("readJournal — real-PG integration", () => {
  if (!ctx.available || !ctx.url) {
    it.skip("Skipping — TEST_POSTGRES_URL not set", () => {});
    return;
  }

  let pool: Pool;
  let db: ReturnType<typeof drizzle>;

  beforeAll(async () => {
    pool = new Pool({ connectionString: ctx.url ?? undefined });
    db = drizzle(pool);

    // Stand up the journal table directly (raw SQL mirroring the
    // Drizzle schema). Avoids pulling in pushSchema for a focused
    // pagination test.
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

  beforeEach(async () => {
    await pool.query('TRUNCATE TABLE "nextly_migration_journal"');
  });

  // Seeds `count` rows with deterministically-decreasing started_at
  // values starting from `baseTime`. Returns the inserted IDs in
  // newest-to-oldest order so callers can match against `readJournal`
  // results without sorting.
  async function seedRows(args: {
    count: number;
    baseTime: Date;
    legacyMissingScope?: boolean;
  }): Promise<string[]> {
    const ids: string[] = [];
    for (let i = 0; i < args.count; i++) {
      const id = `seed-${i.toString().padStart(3, "0")}`;
      ids.push(id);
      const startedAt = new Date(args.baseTime.getTime() - i * 1000);
      const endedAt = new Date(startedAt.getTime() + 100);
      await pool.query(
        `INSERT INTO "nextly_migration_journal"
         (id, source, status, started_at, ended_at, duration_ms,
          statements_planned, statements_executed, renames_applied,
          scope_kind, scope_slug,
          summary_added, summary_removed, summary_renamed, summary_changed)
         VALUES ($1, 'ui', 'success', $2, $3, 100,
                 1, 1, 0,
                 $4, $5, $6, $7, $8, $9)`,
        [
          id,
          startedAt,
          endedAt,
          args.legacyMissingScope ? null : "collection",
          args.legacyMissingScope ? null : `posts-${i}`,
          args.legacyMissingScope ? null : 1,
          args.legacyMissingScope ? null : 0,
          args.legacyMissingScope ? null : 0,
          args.legacyMissingScope ? null : 0,
        ]
      );
    }
    return ids;
  }

  it("returns the latest `limit` rows newest-first with hasMore=true when more exist", async () => {
    const ids = await seedRows({
      count: 25,
      baseTime: new Date("2026-04-29T18:00:00.000Z"),
    });

    const result = await readJournal({
      db,
      dialect: "postgresql",
      limit: 20,
    });

    expect(result.rows).toHaveLength(20);
    expect(result.hasMore).toBe(true);
    // Newest-first ordering.
    expect(result.rows[0].id).toBe(ids[0]);
    expect(result.rows[19].id).toBe(ids[19]);
  });

  it("paginates the next page via `before` cursor", async () => {
    const ids = await seedRows({
      count: 25,
      baseTime: new Date("2026-04-29T18:00:00.000Z"),
    });

    const page1 = await readJournal({
      db,
      dialect: "postgresql",
      limit: 20,
    });
    expect(page1.hasMore).toBe(true);

    const oldestOnPage1 = page1.rows[19].startedAt;
    const page2 = await readJournal({
      db,
      dialect: "postgresql",
      limit: 20,
      before: oldestOnPage1,
    });

    expect(page2.rows).toHaveLength(5);
    expect(page2.hasMore).toBe(false);
    expect(page2.rows.map(r => r.id)).toEqual(ids.slice(20));
  });

  it("hasMore=false when total rows fit in one page", async () => {
    await seedRows({
      count: 5,
      baseTime: new Date("2026-04-29T18:00:00.000Z"),
    });

    const result = await readJournal({
      db,
      dialect: "postgresql",
      limit: 20,
    });

    expect(result.rows).toHaveLength(5);
    expect(result.hasMore).toBe(false);
  });

  it("returns empty result when table is empty", async () => {
    const result = await readJournal({
      db,
      dialect: "postgresql",
      limit: 20,
    });
    expect(result.rows).toEqual([]);
    expect(result.hasMore).toBe(false);
  });

  it("legacy rows (scope_kind=null, summary columns null) surface as null fields", async () => {
    await seedRows({
      count: 3,
      baseTime: new Date("2026-04-29T18:00:00.000Z"),
      legacyMissingScope: true,
    });

    const result = await readJournal({
      db,
      dialect: "postgresql",
      limit: 20,
    });

    expect(result.rows).toHaveLength(3);
    expect(result.rows[0].scope).toBeNull();
    expect(result.rows[0].summary).toBeNull();
    // Other fields populated as expected.
    expect(result.rows[0].source).toBe("ui");
    expect(result.rows[0].status).toBe("success");
  });
});
