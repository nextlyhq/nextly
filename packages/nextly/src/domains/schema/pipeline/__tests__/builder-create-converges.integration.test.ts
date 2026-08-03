/**
 * A table the Schema Builder just created must preview as unchanged.
 *
 * The create path and the preview path each build their own desired schema from the same registry
 * row. When they disagree about a single column, an operator who has changed nothing opens the
 * Builder and is shown a destructive type change against a table nobody touched — and confirming it
 * narrows a live column.
 *
 * Not hypothetical: resolving the Builder's text-width rule inside the create handler alone produced
 * exactly this, because preview builds its snapshot elsewhere and never applied the rule. A unit test
 * over either path passes while the pair disagrees, which is why this asserts across the two. It is
 * also invisible on PostgreSQL and SQLite, where both answers render `text`; only MySQL renders them
 * differently, and there they are 65 535 and 255 characters.
 */
import { drizzle as drizzleMysql } from "drizzle-orm/mysql2";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { createPool, type Pool as MysqlPool } from "mysql2";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { makeTestContext } from "../../../../database/__tests__/integration/helpers/test-db";
import { DrizzleStatementExecutor } from "../../services/drizzle-statement-executor";
import { introspectLiveSnapshot } from "../diff/introspect-live";
import { previewDesiredSchema } from "../preview";
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
import type { DesiredSchema } from "../types";

// Per-file prefixes so this suite cannot collide with another that creates a table of its own.
const PG = makeTestContext("postgresql");
const MYSQL = makeTestContext("mysql");
const PG_URL = PG.url ?? "";
const MYSQL_URL = MYSQL.url ?? "";

/** A Builder-authored single: unlocked, one plain text field stating no width anywhere. */
function builderSingle(tableName: string): DesiredSchema {
  return {
    collections: {},
    singles: {
      page: {
        slug: "page",
        tableName,
        fields: [{ name: "body", type: "text" }] as never,
        builderOwned: true,
      },
    },
    components: {},
  };
}

/**
 * Everything the diff reports about columns.
 *
 * Index operations are excluded because a created table genuinely lacks its secondary indexes: the
 * Drizzle schema handed to drizzle-kit declares none. Column shape is what this suite pins, and a
 * disagreement between the two builders shows up there.
 */
function columnOperations(
  operations: readonly { type: string }[]
): readonly { type: string }[] {
  return operations.filter(op => !op.type.endsWith("_index"));
}

function makePipeline(
  dialect: "postgresql" | "mysql",
  db: unknown
): PushSchemaPipeline {
  return new PushSchemaPipeline({
    executor: new DrizzleStatementExecutor(dialect, db),
    renameDetector: noopRenameDetector,
    classifier: noopClassifier,
    promptDispatcher: noopPromptDispatcher,
    preRenameExecutor: noopPreRenameExecutor,
    preCleanupExecutor: noopPreCleanupExecutor,
    migrationJournal: noopMigrationJournal,
    notifier: noopNotifier,
  });
}

describe.skipIf(!PG_URL)("builder-created table converges (postgres)", () => {
  const tableName = `${PG.prefix}_single_conv`;
  let pool: Pool;
  let db: ReturnType<typeof drizzlePg>;

  beforeAll(async () => {
    pool = new Pool({ connectionString: PG_URL });
    db = drizzlePg({ client: pool });
    await db.execute(`DROP TABLE IF EXISTS "${tableName}"`);
  });

  afterAll(async () => {
    await db.execute(`DROP TABLE IF EXISTS "${tableName}"`);
    await pool.end();
  });

  it("previews as unchanged immediately after being created", async () => {
    const desired = builderSingle(tableName);

    const applied = await makePipeline("postgresql", db).apply({
      desired,
      db,
      dialect: "postgresql",
      source: "ui",
      promptChannel: "browser",
      uiTargetSlug: "page",
      uiTargetKind: "single",
    });
    expect(applied.success).toBe(true);

    const preview = await previewDesiredSchema({
      desired,
      db,
      dialect: "postgresql",
    });

    // Scoped past index operations deliberately. The Drizzle tables drizzle-kit builds its DDL from
    // declare no secondary indexes, so a freshly created table has none and the next diff asks for
    // them back. That is a real gap with its own fix pending, and a blanket zero here would fail on
    // it forever — or, once someone relaxed the assertion, stop pinning the invariant this exists for.
    expect(columnOperations(preview.operations)).toEqual([]);
  });
});

describe.skipIf(!MYSQL_URL)("builder-created table converges (mysql)", () => {
  const tableName = `${MYSQL.prefix}_single_conv`;
  let pool: MysqlPool;
  let db: ReturnType<typeof drizzleMysql<Record<string, never>, MysqlPool>>;

  beforeAll(async () => {
    pool = createPool({ uri: MYSQL_URL });
    db = drizzleMysql({ client: pool });
    await pool.promise().query(`DROP TABLE IF EXISTS \`${tableName}\``);
  });

  afterAll(async () => {
    await pool.promise().query(`DROP TABLE IF EXISTS \`${tableName}\``);
    await new Promise<void>(res => pool.end(() => res()));
  });

  it("previews as unchanged immediately after being created", async () => {
    const desired = builderSingle(tableName);

    const applied = await makePipeline("mysql", db).apply({
      desired,
      db,
      dialect: "mysql",
      source: "ui",
      promptChannel: "browser",
      databaseName: new URL(MYSQL_URL).pathname.slice(1),
      uiTargetSlug: "page",
      uiTargetKind: "single",
    });
    expect(applied.success).toBe(true);

    const preview = await previewDesiredSchema({
      desired,
      db,
      dialect: "mysql",
    });

    expect(columnOperations(preview.operations)).toEqual([]);
  });

  // The dialect where the two possible answers are physically different, and where getting this
  // wrong truncates at 255 characters rather than merely reading as drift.
  it("gives an unstated builder text field an unbounded column", async () => {
    const desired = builderSingle(tableName);

    await makePipeline("mysql", db).apply({
      desired,
      db,
      dialect: "mysql",
      source: "ui",
      promptChannel: "browser",
      databaseName: new URL(MYSQL_URL).pathname.slice(1),
      uiTargetSlug: "page",
      uiTargetKind: "single",
    });

    const live = await introspectLiveSnapshot(db, "mysql", [tableName]);
    const body = live.tables
      .find(t => t.name === tableName)
      ?.columns.find(c => c.name === "body");

    expect(body?.type).toBe("text");
  });
});
