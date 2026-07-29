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
import { DynamicCollectionSchemaService } from "../../../dynamic-collections/services/dynamic-collection-schema-service";
import { buildCompanionReconcileStatements } from "../../../i18n/migration/reconcile-companion";
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

  /** Run production-generated migration SQL (breakpoint-separated). */
  function execMigrationSql(sql: string): void {
    for (const statement of sql.split("--> statement-breakpoint")) {
      const clean = statement
        .split("\n")
        .filter(line => !line.trim().startsWith("--"))
        .join("\n")
        .trim();
      if (clean) sqlite.exec(clean);
    }
  }

  beforeAll(async () => {
    sqlite = new Database(":memory:");
    db = drizzle({ client: sqlite });

    // Materialize the core system tables the way first-run setup does — the
    // pipeline's drizzle-kit pass declares them (buildDrizzleSchema injects
    // the dialect bundle), so a database without them would present its own
    // "created" set and change what this file is measuring.
    await freshPushSchema("sqlite", db, getDialectTables("sqlite"));

    // Live tables OUTSIDE any desired schema this file applies: a localized
    // companion (pipeline-excluded by design) and a UI-created entity's main
    // table (never part of a code-first apply). Both come from the SAME
    // production generators the real create paths use, so the fixtures track
    // whatever those paths produce.
    // Explicit dialect: the default constructor derives it from env, which
    // this bare-pipeline test intentionally leaves unset.
    const schemaService = new DynamicCollectionSchemaService(
      undefined,
      "sqlite"
    );
    execMigrationSql(
      schemaService.generateMigrationSQL(
        `dc_${P}_ui_made`,
        [{ name: "note", type: "text" }],
        { localized: false }
      )
    );
    for (const stmt of buildCompanionReconcileStatements({
      slug: `${P}_other`,
      tableName: `dc_${P}_other`,
      oldLocalized: [],
      newLocalized: [{ name: "heading", type: "text" }],
      dialect: "sqlite",
      status: false,
      companionExists: false,
    })) {
      sqlite.exec(stmt);
    }
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
    // is INTEGER live (the production generator maps number → INTEGER) but
    // the desired field type below maps to text, and SQLite implements that
    // as a whole-table rebuild the fast path cannot emit.
    const schemaService = new DynamicCollectionSchemaService(
      undefined,
      "sqlite"
    );
    execMigrationSql(
      schemaService.generateMigrationSQL(
        `dc_${P}_posts`,
        [{ name: "views", type: "number" }],
        { localized: false }
      )
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

    // Tracked indexes survive the kit pass on BOTH tables. drizzle-kit reads
    // every live index on a declared table as undeclared (its runtime
    // schemas carry none) and emits DROP INDEX even for tables it did not
    // change; the pipeline strips those for snapshot-tracked indexes and the
    // rebuild-restore replays the rebuilt table's set.
    const indexNames = (table: string) =>
      (
        sqlite
          .prepare(
            `SELECT name FROM sqlite_master WHERE type='index' AND tbl_name=?`
          )
          .all(table) as Array<{ name: string }>
      ).map(r => r.name);
    expect(indexNames(`dc_${P}_posts`)).toContain(`idx_dc_${P}_posts_slug`);
    expect(indexNames(`dc_${P}_reviews`)).toContain(`idx_dc_${P}_reviews_slug`);
  });
});
