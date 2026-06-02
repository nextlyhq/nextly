// Regression: freshPushSchema with a core-only schema must NOT drop user
// (dc_/single_/comp_) tables. Pre-fix, drizzle-kit's pushSchema emitted
// DROP TABLE dc_articles (extraneous vs the core schema) and freshPushSchema
// executed it, wiping all collection content on every `nextly migrate` that
// reconciled core. Uses a real in-memory SQLite DB + real drizzle-kit.

import Database from "better-sqlite3";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getDialectTables } from "../../../../database/index";

import { freshPushSchema } from "../fresh-push";

let sqlite: Database.Database;
let db: ReturnType<typeof drizzle>;

beforeEach(() => {
  sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  db = drizzle(sqlite);
});

afterEach(() => {
  sqlite.close();
  vi.restoreAllMocks();
});

describe("freshPushSchema drop-guard (real SQLite)", () => {
  it("preserves a user dc_ table + its row when reconciling the core schema", async () => {
    const core = getDialectTables("sqlite");

    // 1. Establish the core schema first (fresh DB → only CREATEs, no
    //    extraneous tables, so drizzle-kit emits no rename-ambiguity prompt).
    //    This mirrors a project that has already been migrated once.
    await freshPushSchema("sqlite", db, core);

    // 2. A user collection table appears with content — exactly what the
    //    original data-loss bug destroyed on the next migrate.
    sqlite.exec(
      'CREATE TABLE "dc_articles" ("id" text PRIMARY KEY, "title" text)'
    );
    db.run(
      sql`INSERT INTO "dc_articles" ("id", "title") VALUES ('a1', 'Hello')`
    );

    // 3. Re-reconcile core (what `nextly migrate` Phase 1 does). drizzle-kit
    //    now sees dc_articles as extraneous (no added tables to pair it with),
    //    so it emits a plain DROP TABLE dc_articles — which the guard blocks.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await freshPushSchema("sqlite", db, core);

    // The table and row must still be there.
    const rows = db.all(
      sql`SELECT "id", "title" FROM "dc_articles"`
    ) as Array<{ id: string; title: string }>;
    expect(rows).toEqual([{ id: "a1", title: "Hello" }]);

    // And the guard logged that it blocked the drop.
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Blocked DROP TABLE "dc_articles"')
    );
  });
});
