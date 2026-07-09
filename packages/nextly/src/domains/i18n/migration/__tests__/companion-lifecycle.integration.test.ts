// M3b-2 Task 5: the safety proof, on a real in-memory SQLite DB.
//
// Three properties the race-free companion lifecycle must hold:
//   1. ENABLE transition seeds BEFORE it drops — no data is lost when localization
//      is turned on for an existing collection with rows.
//   2. FRESH localized collection gets a create-only companion (no seed, no drop).
//   3. The pushSchema pipeline never drops the companion (it is migration-owned and
//      protected by the dc_ drop-guard), preserving its rows on a core reconcile.

import Database from "better-sqlite3";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getDialectTables } from "../../../../database/index";
import { freshPushSchema } from "../../../schema/pipeline/fresh-push";
import { deriveCompanionSpec } from "../derive-companion-spec";
import { planCompanionMigration } from "../plan-companion-migration";

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

/** Column names on a live SQLite table (via PRAGMA table_info). */
function columnNames(table: string): string[] {
  return (
    sqlite.pragma(`table_info("${table}")`) as Array<{ name: string }>
  ).map(c => c.name);
}

const PAGES_FIELDS = [
  { name: "body", type: "longText", localized: true },
  { name: "price", type: "number" },
];

describe("companion lifecycle (real SQLite)", () => {
  it("ENABLE: seeds the companion from existing rows BEFORE dropping the main column (no data loss)", () => {
    // A non-localized dc_pages with two rows of real content.
    sqlite.exec(
      'CREATE TABLE "dc_pages" ("id" text PRIMARY KEY, "body" text, "price" integer)'
    );
    db.run(
      sql`INSERT INTO "dc_pages" ("id","body","price") VALUES ('p1','Hello',10),('p2','World',20)`
    );

    const spec = deriveCompanionSpec({
      slug: "pages",
      dbName: "dc_pages",
      fields: PAGES_FIELDS,
      dialect: "sqlite",
      defaultLocale: "en",
      collectionLocalized: true,
    })!;
    const plan = planCompanionMigration({
      spec,
      prevMainColumnNames: ["id", "body", "price"], // main HELD body → enable
      companionExisted: false,
    });
    expect(plan.kind).toBe("enable");

    // Run the planned enable migration verbatim (CREATE + seed + drop, in order).
    sqlite.exec(plan.upSql);

    // Companion seeded with the default-locale rows carrying the original body.
    const locales = db.all(
      sql`SELECT "_parent","_locale","body" FROM "dc_pages_locales" ORDER BY "_parent"`
    ) as Array<{ _parent: string; _locale: string; body: string }>;
    expect(locales).toEqual([
      { _parent: "p1", _locale: "en", body: "Hello" },
      { _parent: "p2", _locale: "en", body: "World" },
    ]);

    // body is gone from the main table; price (shared) survives untouched.
    const mainCols = columnNames("dc_pages");
    expect(mainCols).not.toContain("body");
    expect(mainCols).toContain("price");
    const pages = db.all(
      sql`SELECT "id","price" FROM "dc_pages" ORDER BY "id"`
    ) as Array<{ id: string; price: number }>;
    expect(pages).toEqual([
      { id: "p1", price: 10 },
      { id: "p2", price: 20 },
    ]);
  });

  it("FRESH: create-only companion — no seed, no drop, main never had the localized column", () => {
    // Fresh localized collection: main table created WITHOUT the localized column.
    sqlite.exec(
      'CREATE TABLE "dc_docs" ("id" text PRIMARY KEY, "price" integer)'
    );

    const spec = deriveCompanionSpec({
      slug: "docs",
      dbName: "dc_docs",
      fields: PAGES_FIELDS,
      dialect: "sqlite",
      defaultLocale: "en",
      collectionLocalized: true,
    })!;
    const plan = planCompanionMigration({
      spec,
      prevMainColumnNames: ["id", "price"], // main NEVER had body → create-only
      companionExisted: false,
    });
    expect(plan.kind).toBe("create-only");
    expect(plan.upSql).not.toContain("INSERT INTO");
    expect(plan.upSql).not.toContain("DROP COLUMN");

    sqlite.exec(plan.upSql);

    // Companion exists and is empty; main never had (and still lacks) body.
    const count = (
      db.get(sql`SELECT COUNT(*) AS n FROM "dc_docs_locales"`) as { n: number }
    ).n;
    expect(count).toBe(0);
    expect(columnNames("dc_docs")).not.toContain("body");
  });

  it("PIPELINE: a core reconcile does NOT drop the companion — its rows are preserved", async () => {
    // 1. Establish the core schema first (fresh DB → only CREATEs, no
    //    rename-ambiguity prompt), mirroring an already-migrated project.
    await freshPushSchema("sqlite", db, getDialectTables("sqlite"));

    // 2. Establish a companion table with a row (the create-only path, condensed).
    sqlite.exec(
      'CREATE TABLE "dc_pages" ("id" text PRIMARY KEY, "price" integer)'
    );
    db.run(sql`INSERT INTO "dc_pages" ("id","price") VALUES ('p1',10)`);
    const spec = deriveCompanionSpec({
      slug: "pages",
      dbName: "dc_pages",
      fields: PAGES_FIELDS,
      dialect: "sqlite",
      defaultLocale: "en",
      collectionLocalized: true,
    })!;
    const plan = planCompanionMigration({
      spec,
      prevMainColumnNames: ["id", "price"],
      companionExisted: false,
    });
    sqlite.exec(plan.upSql); // create-only companion
    db.run(
      sql`INSERT INTO "dc_pages_locales" ("_parent","_locale","body") VALUES ('p1','en','Bonjour')`
    );

    // 3. Re-reconcile the CORE schema (what `nextly migrate` Phase 1 does). The
    //    core schema knows nothing about dc_pages / dc_pages_locales, so drizzle-kit
    //    wants to drop them — the dc_ drop-guard must block the companion.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await freshPushSchema("sqlite", db, getDialectTables("sqlite"));

    // Companion table + its row survive — the pipeline never dropped it.
    const rows = db.all(
      sql`SELECT "_parent","_locale","body" FROM "dc_pages_locales"`
    ) as Array<{ _parent: string; _locale: string; body: string }>;
    expect(rows).toEqual([{ _parent: "p1", _locale: "en", body: "Bonjour" }]);

    // The companion is migration-owned (Option B): its drop is blocked SILENTLY
    // — no reconcile-noise warning is emitted for it. (The plain user table
    // dc_pages IS warned about, proving the guard ran and the silence is
    // companion-specific, not a no-op.)
    const warnedMessages = warn.mock.calls.map(c => String(c[0]));
    expect(warnedMessages.some(m => m.includes("dc_pages_locales"))).toBe(false);
    expect(
      warnedMessages.some(m => m.includes('Blocked DROP TABLE "dc_pages"'))
    ).toBe(true);
  });
});
