// Regression: creating tables on SQLite while the live DB holds tables
// OUTSIDE the desired schema (localized `_locales` companions, UI-created
// entities during a code-first apply) must not crash the apply.
//
// drizzle-kit v1 has no introspection filter on SQLite, so its differ sees
// every live table. A table absent from the desired schema reads as
// "deleted"; paired against a "created" table, the v1 rename resolver
// throws `Internal error: resolver(table) was called without a
// HintsHandler` BEFORE emitting anything — the whole apply fails and the
// new table is never created (observed live: a code-first collection whose
// dc_* table could not materialize once a UI-made localized entity's
// companion existed). Two defenses under test, both against the REAL
// drizzle-kit and a real in-memory SQLite database:
//
//   1. A purely-additive op set takes the in-memory fast path and never
//      reaches drizzle-kit at all.
//   2. A mixed op set still uses drizzle-kit for the rebuild remainder,
//      but the pipeline pre-creates the planned tables first, emptying the
//      differ's created set so the resolver is never consulted.

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getDialectTables } from "../../../../database/index";
import { DrizzleStatementExecutor } from "../../services/drizzle-statement-executor";

import { freshPushSchema } from "../fresh-push";
import { PushSchemaPipeline } from "../pushschema-pipeline";
import {
  noopClassifier,
  noopMigrationJournal,
  noopNotifier,
  noopPreRenameExecutor,
  noopPreCleanupExecutor,
  noopPromptDispatcher,
  noopRenameDetector,
} from "../pushschema-pipeline-stubs";

const P = "i18nfx"; // per-file table prefix

describe("PushSchemaPipeline — SQLite applies with orphan live tables", () => {
  let sqlite: Database.Database;
  let db: ReturnType<typeof drizzle>;

  beforeAll(async () => {
    sqlite = new Database(":memory:");
    db = drizzle({ client: sqlite });

    // Materialize the core system tables the way first-run setup does — the
    // pipeline's drizzle-kit pass declares them (buildDrizzleSchema injects
    // the dialect bundle), so a database without them would present its own
    // "created" set and change what this file is measuring.
    await freshPushSchema("sqlite", db, getDialectTables("sqlite"));

    // Live tables OUTSIDE any desired schema this file applies:
    // a localized companion (pipeline-excluded by design) and a
    // UI-created entity's main table (never part of a code-first apply).
    sqlite.exec(
      `CREATE TABLE "dc_${P}_other_locales" ("_parent" text NOT NULL, "_locale" text NOT NULL, "heading" text, PRIMARY KEY ("_parent", "_locale"))`
    );
    sqlite.exec(
      `CREATE TABLE "dc_${P}_ui_made" ("id" text PRIMARY KEY NOT NULL, "title" text, "note" text)`
    );
  });

  afterAll(() => {
    sqlite?.close();
  });

  function makePipeline() {
    return new PushSchemaPipeline({
      executor: new DrizzleStatementExecutor("sqlite", db),
      renameDetector: noopRenameDetector,
      classifier: noopClassifier,
      promptDispatcher: noopPromptDispatcher,
      preRenameExecutor: noopPreRenameExecutor,
      preCleanupExecutor: noopPreCleanupExecutor,
      migrationJournal: noopMigrationJournal,
      notifier: noopNotifier,
    });
  }

  function tableExists(name: string): boolean {
    const row = sqlite
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
      .get(name);
    return row !== undefined;
  }

  it("pure add_table apply succeeds without consulting drizzle-kit", async () => {
    const result = await makePipeline().apply({
      desired: {
        collections: {
          [`${P}_articles`]: {
            slug: `${P}_articles`,
            tableName: `dc_${P}_articles`,
            fields: [{ name: "body", type: "text" }] as never,
          },
        },
        singles: {},
        components: {},
      },
      db,
      dialect: "sqlite",
      source: "code",
      promptChannel: "terminal",
    });

    expect(result.success).toBe(true);
    expect(tableExists(`dc_${P}_articles`)).toBe(true);
    // The orphans are untouched.
    expect(tableExists(`dc_${P}_other_locales`)).toBe(true);
    expect(tableExists(`dc_${P}_ui_made`)).toBe(true);
  });

  it("mixed apply (new table + column-type rebuild) pre-creates then lets the kit finish", async () => {
    // A managed table with drift that forces the drizzle-kit path: `views`
    // is INTEGER live but the desired field type maps to text, and SQLite
    // implements that as a whole-table rebuild the fast path cannot emit.
    sqlite.exec(
      `CREATE TABLE "dc_${P}_posts" (
        "id" text PRIMARY KEY NOT NULL,
        "title" text,
        "slug" text NOT NULL,
        "created_at" integer,
        "updated_at" integer,
        "created_by" text,
        "views" integer
      )`
    );

    const result = await makePipeline().apply({
      desired: {
        collections: {
          [`${P}_posts`]: {
            slug: `${P}_posts`,
            tableName: `dc_${P}_posts`,
            fields: [{ name: "views", type: "text" }] as never,
          },
          [`${P}_reviews`]: {
            slug: `${P}_reviews`,
            tableName: `dc_${P}_reviews`,
            fields: [{ name: "rating", type: "number" }] as never,
          },
        },
        singles: {},
        components: {},
      },
      db,
      dialect: "sqlite",
      source: "code",
      promptChannel: "terminal",
    });

    // Pre-fix this failed with PUSHSCHEMA_FAILED: `Internal error:
    // resolver(table) was called without a HintsHandler` — the kit paired
    // the orphan companion against the to-be-created dc_*_reviews table.
    if (!result.success) {
      console.error("APPLY ERROR:", JSON.stringify(result.error, null, 2));
    }
    expect(result.success).toBe(true);
    expect(tableExists(`dc_${P}_reviews`)).toBe(true);
    // The rebuild landed: views is now text.
    const cols = sqlite
      .prepare(`PRAGMA table_info("dc_${P}_posts")`)
      .all() as Array<{ name: string; type: string }>;
    const views = cols.find(c => c.name === "views");
    expect(views?.type.toLowerCase()).toBe("text");
    // Orphans still intact — the drop-guard filtered the kit's orphan drops.
    expect(tableExists(`dc_${P}_other_locales`)).toBe(true);
    expect(tableExists(`dc_${P}_ui_made`)).toBe(true);
  });
});
