// Plan C1 — real-PG integration test for `readJournal` pagination, now
// against `nextly_schema_events`.
//
// Seeds N rows with deterministic `started_at` timestamps and verifies the
// cursor-based pagination contract end-to-end against real PG, plus the
// events→API mapping (event_type ui_save → source ui; status applied →
// success; summary always null).
//
// Auto-skips when TEST_POSTGRES_URL isn't set.

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { makeTestContext } from "../../../../database/__tests__/integration/helpers/test-db";
import { readJournal } from "../read-journal";

const ctx = makeTestContext("postgresql");

describe("readJournal — real-PG integration (nextly_schema_events)", () => {
  if (!ctx.available || !ctx.url) {
    it.skip("Skipping — TEST_POSTGRES_URL not set", () => {});
    return;
  }

  let pool: Pool;
  let db: ReturnType<typeof drizzle>;

  beforeAll(async () => {
    pool = new Pool({ connectionString: ctx.url ?? undefined });
    db = drizzle({ client: pool });

    await pool.query('DROP TABLE IF EXISTS "nextly_schema_events"');
    await pool.query(`
      CREATE TABLE "nextly_schema_events" (
        "id" text PRIMARY KEY,
        "event_type" text NOT NULL,
        "status" text NOT NULL,
        "source" text NOT NULL,
        "filename" text,
        "sha256" text,
        "scope_kind" text,
        "scope_slug" text,
        "started_at" timestamptz NOT NULL,
        "ended_at" timestamptz,
        "duration_ms" integer,
        "applied_by" text,
        "note" text,
        "statements_planned" integer,
        "statements_executed" integer,
        "renames_applied" integer,
        "error_code" text,
        "error_message" text,
        "error_json" jsonb,
        "superseded_event_ids" jsonb,
        "superseded_at" timestamptz,
        "superseded_by" text
      )
    `);
  });

  afterAll(async () => {
    if (pool) {
      await pool
        .query('DROP TABLE IF EXISTS "nextly_schema_events"')
        .catch(() => {});
      await pool.end();
    }
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE TABLE "nextly_schema_events"');
  });

  // Seeds `count` applied ui_save events with decreasing started_at.
  // Returns ids newest-to-oldest.
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
        `INSERT INTO "nextly_schema_events"
         (id, event_type, status, source, started_at, ended_at, duration_ms,
          statements_planned, statements_executed, renames_applied,
          scope_kind, scope_slug)
         VALUES ($1, 'ui_save', 'applied', 'admin-ui', $2, $3, 100,
                 1, 1, 0, $4, $5)`,
        [
          id,
          startedAt,
          endedAt,
          args.legacyMissingScope ? null : "collection",
          args.legacyMissingScope ? null : `posts-${i}`,
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
    const result = await readJournal({ db, dialect: "postgresql", limit: 20 });
    expect(result.rows).toHaveLength(20);
    expect(result.hasMore).toBe(true);
    expect(result.rows[0].id).toBe(ids[0]);
    expect(result.rows[19].id).toBe(ids[19]);
  });

  it("paginates the next page via `before` cursor", async () => {
    const ids = await seedRows({
      count: 25,
      baseTime: new Date("2026-04-29T18:00:00.000Z"),
    });
    const page1 = await readJournal({ db, dialect: "postgresql", limit: 20 });
    expect(page1.hasMore).toBe(true);

    const oldestOnPage1 = page1.rows[19].startedAt;
    const page2 = await readJournal({
      db,
      dialect: "postgresql",
      limit: 20,
      before: oldestOnPage1,
    });
    if (page2.rows.length !== 5)
      console.error(
        "PAGE2_DEBUG",
        JSON.stringify({
          oldestOnPage1,
          page2ids: page2.rows.map(r => [r.id, r.startedAt]),
        })
      );
    expect(page2.rows).toHaveLength(5);
    expect(page2.hasMore).toBe(false);
    expect(page2.rows.map(r => r.id)).toEqual(ids.slice(20));
  });

  it("hasMore=false when total rows fit in one page", async () => {
    await seedRows({
      count: 5,
      baseTime: new Date("2026-04-29T18:00:00.000Z"),
    });
    const result = await readJournal({ db, dialect: "postgresql", limit: 20 });
    if (result.rows.length !== 5)
      console.error(
        "HASMORE_DEBUG",
        JSON.stringify(result.rows.map(r => [r.id, r.startedAt]))
      );
    expect(result.rows).toHaveLength(5);
    expect(result.hasMore).toBe(false);
  });

  it("returns empty result when table is empty", async () => {
    const result = await readJournal({ db, dialect: "postgresql", limit: 20 });
    expect(result.rows).toEqual([]);
    expect(result.hasMore).toBe(false);
  });

  it("rows with null scope surface scope=null and summary is always null", async () => {
    await seedRows({
      count: 3,
      baseTime: new Date("2026-04-29T18:00:00.000Z"),
      legacyMissingScope: true,
    });
    const result = await readJournal({ db, dialect: "postgresql", limit: 20 });
    expect(result.rows).toHaveLength(3);
    expect(result.rows[0].scope).toBeNull();
    expect(result.rows[0].summary).toBeNull();
    expect(result.rows[0].source).toBe("ui");
    expect(result.rows[0].status).toBe("success");
  });
});
