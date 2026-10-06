// A SQLite dev push that rebuilds a Schema Builder table through drizzle-kit.
//
// A check contributed to an entity table is a change SQLite can make only by
// rebuilding the table, and on dev push drizzle-kit does that from the
// runtime Drizzle tables — which declare only what the schema tracks. A
// Builder table created with a relationship holds that relationship's foreign
// key, which no spec records, so the rebuild would drop it silently. The
// pipeline must refuse before anything writes, with the rule a migration's
// rebuild uses (`untrackedConstraintCounts`).
//
// Against a real in-memory SQLite, the real drizzle-kit, the Builder's own
// DDL generator and a compiled extension schema.

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getDialectTables } from "../../../../database/index";
import { clearCachedSnapshot } from "../../../../init/schema-snapshot-cache";
import { DynamicCollectionSchemaService } from "../../../dynamic-collections/services/dynamic-collection-schema-service";
import {
  clearActiveExtensionSchema,
  setActiveExtensionSchema,
} from "../../extension/active-schema";
import { buildExtensionSchema } from "../../extension/build-extension-schema";
import { col } from "../../extension/dsl";
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

const AUTHORS = "dc_fxkr_authors";
const POSTS = "dc_fxkr_posts";
const authorField = {
  name: "author",
  type: "relationship",
  options: { target: "fxkr_authors", relationType: "manyToOne" },
};

let sqlite: Database.Database;
let db: ReturnType<typeof drizzle>;
const builder = new DynamicCollectionSchemaService(undefined, "sqlite");

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

const foreignKeysOfPosts = () =>
  sqlite
    .prepare(`SELECT "table", "from" FROM pragma_foreign_key_list(?)`)
    .all(POSTS);

/**
 * The posts table as the Builder leaves it: created with the relationship
 * (so it holds the foreign key), or created bare and given it later (so, on
 * SQLite, it does not).
 */
async function builderTables(history: "born-with" | "given-later") {
  await freshPushSchema("sqlite", db, getDialectTables("sqlite"));
  runBuilderSql(
    builder.generateMigrationSQL(AUTHORS, [
      { name: "name", type: "text" },
    ] as never)
  );
  if (history === "born-with") {
    runBuilderSql(builder.generateMigrationSQL(POSTS, [authorField] as never));
  } else {
    runBuilderSql(builder.generateMigrationSQL(POSTS, [] as never));
    runBuilderSql(
      builder.generateAlterTableMigration(POSTS, [], [authorField] as never)
    );
  }
}

/** A plugin-style contribution of an enum column — and so a check — to posts. */
async function contributeEnum() {
  const schema = await buildExtensionSchema({
    dialect: "sqlite",
    coreTableNames: [],
    entities: [
      {
        name: POSTS,
        slug: "fxkr_posts",
        entityKind: "collection",
        columns: [{ name: "id", kind: "varchar", nullable: false }],
      },
    ],
    pluginPrefixes: new Map(),
    plugins: [],
    app: {
      owner: { kind: "app" },
      extend: [
        ({ schema: draft }) => {
          draft.extendTable(POSTS, {
            columns: {
              reviewState: col.enum(["draft", "live"], { nullable: true }),
            },
          });
        },
      ],
    },
  });
  setActiveExtensionSchema("sqlite", schema);
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
        fxkr_posts: {
          slug: "fxkr_posts",
          tableName: POSTS,
          fields: [authorField] as never,
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

describe("a SQLite dev push rebuilding a Builder table through drizzle-kit", () => {
  it("refuses, before writing, when the rebuild would drop the table's foreign key", async () => {
    await builderTables("born-with");
    await contributeEnum();

    const result = await push();

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("PRECONDITION_FAILED");
    expect(result.error?.message).toContain(
      `rebuilding ${POSTS} would drop foreign keys its schema does not track`
    );
    // Nothing ran: the key is there, and so is the table without the column.
    expect(foreignKeysOfPosts()).toEqual([{ table: AUTHORS, from: "author" }]);
    const columns = sqlite
      .prepare(`SELECT name FROM pragma_table_info(?)`)
      .all(POSTS) as Array<{ name: string }>;
    expect(columns.map(c => c.name)).not.toContain("review_state");
  });

  it("applies the same change to a Builder table that holds no foreign key", async () => {
    // The control: the refusal above is the foreign key's, not the route's.
    await builderTables("given-later");
    await contributeEnum();

    const result = await push();

    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
    const stored = sqlite
      .prepare(`SELECT sql FROM sqlite_master WHERE name = ?`)
      .get(POSTS) as { sql: string };
    expect(stored.sql).toContain("review_state");
  });
});
