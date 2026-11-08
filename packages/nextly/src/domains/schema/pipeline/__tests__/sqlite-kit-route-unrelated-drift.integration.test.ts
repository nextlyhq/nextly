// A SQLite push that goes through drizzle-kit applies its own changes, and
// leaves alone the tables it was not asked to change.
//
// A change outside the fast path (a column made optional) sends the whole push
// to drizzle-kit, which on SQLite compares the ENTIRE database with the
// runtime tables it is handed. Two of those disagree with a live database in
// ways no operation of this push asked about:
//
// - the media table still holds the retired `sizes` column, which Nextly keeps
//   until `nextly media remove-sizes --apply --drop`, while the core media
//   table carries no such column;
// - a field-group table an earlier release created has no column defaults,
//   where the runtime table declares them, so drizzle-kit rebuilds it.
//
// Either one made the destructive-statement guard refuse the whole push, so
// the column the push existed to add never arrived, and no consent flag
// could change that. The push must apply, keep `sizes` and its values, and
// leave both field-group tables exactly as they were.
//
// Against a real in-memory SQLite, the real drizzle-kit, and the production
// DDL of the core tables, the Builder and the field groups.

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { retiredSizesColumnDdl } from "../../../../__tests__/helpers/retired-image-sizes";
import { getDialectTables } from "../../../../database/index";
import { clearCachedSnapshot } from "../../../../init/schema-snapshot-cache";
import { DynamicCollectionSchemaService } from "../../../dynamic-collections/services/dynamic-collection-schema-service";
import { FieldGroupSchemaService } from "../../../field-groups/services/field-group-schema-service";
import { clearActiveExtensionSchema } from "../../extension/active-schema";
import { DrizzleStatementExecutor } from "../../services/drizzle-statement-executor";
import { freshPushSchema } from "../fresh-push";
import { PushSchemaPipeline } from "../pushschema-pipeline";
import {
  noopClassifier,
  noopMigrationJournal,
  noopNotifier,
  noopPreCleanupExecutor,
  noopPreRenameExecutor,
  noopPromptDispatcher,
  noopRenameDetector,
} from "../pushschema-pipeline-stubs";

const POSTS = "dc_kxdr_posts";
const LEGACY_GROUP = "comp_kxdr_legacy";
const CURRENT_GROUP = "comp_kxdr_current";
const SIZES = '{"card":{"url":"/uploads/2026/01/photo-card.png"}}';
const groupFields = [{ name: "note", type: "text" }];

let sqlite: Database.Database;
let db: ReturnType<typeof drizzle>;
const builder = new DynamicCollectionSchemaService(undefined, "sqlite");
const fieldGroups = new FieldGroupSchemaService("sqlite");

function runBuilderSql(sql: string): void {
  for (const part of sql.split("--> statement-breakpoint")) {
    const statement = part
      .split("\n")
      .filter(line => !line.trim().startsWith("--"))
      .join("\n")
      .trim();
    if (statement) sqlite.exec(statement);
  }
}

const storedSql = (table: string): string | undefined =>
  (
    sqlite
      .prepare(
        `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`
      )
      .get(table) as { sql: string } | undefined
  )?.sql;

const columnsOf = (table: string) =>
  sqlite
    .prepare(`SELECT name, "notnull" FROM pragma_table_info(?)`)
    .all(table) as Array<{ name: string; notnull: number }>;

/**
 * A database as an app that has run for a while leaves it: the core tables,
 * the media table with its retired `sizes` column and an item naming its size
 * files there, a Builder collection with a required headline, and two field
 * groups, one created by an earlier release (no column defaults) and one by
 * this one, each holding a row.
 */
async function existingDatabase(): Promise<void> {
  await freshPushSchema("sqlite", db, getDialectTables("sqlite"));
  sqlite.exec(retiredSizesColumnDdl("sqlite"));
  sqlite.exec(
    `INSERT INTO media (id, filename, original_filename, mime_type, size, url, uploaded_at, updated_at) ` +
      `VALUES ('older', '2026/01/photo.png', 'photo.png', 'image/png', 1, '/uploads/2026/01/photo.png', 0, 0)`
  );
  sqlite.prepare(`UPDATE media SET sizes = ? WHERE id = 'older'`).run(SIZES);

  runBuilderSql(
    builder.generateMigrationSQL(POSTS, [
      { name: "headline", type: "text", required: true },
    ] as never)
  );

  // This release's CREATE with its defaults taken out, as the earlier
  // release wrote it: the same columns, none of them defaulted.
  const legacy = fieldGroups
    .generateMigrationSQL(LEGACY_GROUP, groupFields as never)
    .replaceAll(" DEFAULT (strftime('%s', 'now'))", "")
    .replaceAll(" DEFAULT 0", "");
  expect(legacy).not.toContain("DEFAULT");
  sqlite.exec(legacy);
  sqlite.exec(
    fieldGroups.generateMigrationSQL(CURRENT_GROUP, groupFields as never)
  );
  for (const table of [LEGACY_GROUP, CURRENT_GROUP]) {
    sqlite.exec(
      `INSERT INTO ${table} (id, _parent_id, _parent_table, _parent_field, _order, _component_type, note, created_at, updated_at) ` +
        `VALUES ('row-1', 'post-1', '${POSTS}', 'meta', 0, 'kxdr', 'kept', 0, 0)`
    );
  }
}

function push() {
  return new PushSchemaPipeline({
    executor: new DrizzleStatementExecutor("sqlite", db),
    renameDetector: noopRenameDetector,
    classifier: noopClassifier,
    promptDispatcher: noopPromptDispatcher,
    preRenameExecutor: noopPreRenameExecutor,
    preCleanupExecutor: noopPreCleanupExecutor,
    migrationJournal: noopMigrationJournal,
    notifier: noopNotifier,
  }).apply({
    desired: {
      collections: {
        kxdr_posts: {
          slug: "kxdr_posts",
          tableName: POSTS,
          // The headline made optional is what sends the push to drizzle-kit;
          // the summary is the column the push exists to add.
          fields: [
            { name: "headline", type: "text", required: false },
            { name: "summary", type: "text" },
          ] as never,
        },
      },
      singles: {},
      components: {
        kxdr_legacy: {
          slug: "kxdr_legacy",
          tableName: LEGACY_GROUP,
          fields: groupFields as never,
        },
        kxdr_current: {
          slug: "kxdr_current",
          tableName: CURRENT_GROUP,
          fields: groupFields as never,
        },
      },
    },
    db,
    dialect: "sqlite",
    source: "code",
    promptChannel: "terminal",
  });
}

beforeEach(() => {
  clearCachedSnapshot();
  sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  db = drizzle({ client: sqlite });
});
afterEach(() => {
  clearCachedSnapshot();
  clearActiveExtensionSchema();
  sqlite.close();
});

describe("a SQLite push through drizzle-kit on a database with unrelated drift", () => {
  it("applies its own changes, keeps the retired sizes column, and leaves the field-group tables alone", async () => {
    await existingDatabase();
    const legacyBefore = storedSql(LEGACY_GROUP);
    const currentBefore = storedSql(CURRENT_GROUP);

    const result = await push();

    // The refusal, when there is one, is printed here rather than as a bare
    // `false`.
    expect(result.error?.message).toBeUndefined();
    expect(result.success).toBe(true);

    // The push's own changes landed.
    const posts = columnsOf(POSTS);
    expect(posts.map(column => column.name)).toContain("summary");
    expect(posts.find(column => column.name === "headline")?.notnull).toBe(0);

    // The retired column is still there, and so is the item's record in it.
    expect(columnsOf("media").map(column => column.name)).toContain("sizes");
    const media = sqlite
      .prepare(`SELECT sizes FROM media WHERE id = 'older'`)
      .get() as { sizes: string | null };
    expect(media.sizes).toBe(SIZES);

    // Neither field-group table was rebuilt: each is as it was created, rows
    // and all.
    expect(storedSql(LEGACY_GROUP)).toBe(legacyBefore);
    expect(storedSql(CURRENT_GROUP)).toBe(currentBefore);
    for (const table of [LEGACY_GROUP, CURRENT_GROUP]) {
      const row = sqlite
        .prepare(`SELECT note FROM ${table} WHERE id = 'row-1'`)
        .get() as { note: string } | undefined;
      expect(row?.note).toBe("kept");
    }
  });
});
