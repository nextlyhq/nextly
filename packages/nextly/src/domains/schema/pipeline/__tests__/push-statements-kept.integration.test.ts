/**
 * A failed apply says how many of its statements stay applied (`PipelineResult.statementsKept`), on
 * a real database: what a Schema Builder save reads to keep its migration files only when something
 * of the change stayed (`landingPush`).
 *
 * - MySQL commits each schema statement as it runs: an apply whose first statement fails keeps
 *   none, and says so, with the table as it was; one whose second fails keeps the first.
 * - PostgreSQL's apply runs in one transaction that a failure rolls back whole, so it says nothing.
 *
 * The apply adds two columns to a table it made, with nothing before the executor's statements that
 * runs one (no key lifted, no pre-cleanup). The executor fails the chosen statement and runs each
 * before it, as the database would.
 */
import { drizzle as drizzleMysql } from "drizzle-orm/mysql2";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { createPool, type Pool as MysqlPool } from "mysql2";
import { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { makeTestContext } from "../../../../database/__tests__/integration/helpers/test-db";
import {
  clearCachedSnapshot,
  clearLiveSnapshots,
} from "../../../../init/schema-snapshot-cache";
import { DrizzleStatementExecutor } from "../../services/drizzle-statement-executor";
import { introspectLiveSnapshot } from "../diff/introspect-live";
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

const PG = makeTestContext("postgresql");
const MYSQL = makeTestContext("mysql");
const PG_URL = PG.url ?? "";
const MYSQL_URL = MYSQL.url ?? "";

/** A Builder-authored single on `tableName` with text fields named `fields`. */
function single(tableName: string, fields: readonly string[]): DesiredSchema {
  return {
    collections: {},
    singles: {
      page: {
        slug: "page",
        tableName,
        fields: fields.map(name => ({ name, type: "text" })) as never,
        builderOwned: true,
      },
    },
    components: {},
  };
}

/**
 * A pipeline whose executor fails the `failAt`th statement it is handed (from 1, counting across
 * calls), running each before it; undefined runs every statement.
 */
function pipelineFailingAt(
  dialect: "postgresql" | "mysql",
  db: unknown,
  failAt?: number
): { pipeline: PushSchemaPipeline; sent: () => number } {
  // Each apply reads the database as it stands: the pipeline would otherwise skip one whose desired
  // schema matches the last it applied, and read a table from a snapshot taken before a drop.
  clearCachedSnapshot();
  clearLiveSnapshots();
  const real = new DrizzleStatementExecutor(dialect, db);
  let sent = 0;
  const executor = {
    executeStatements: async (tx: unknown, statements: string[]) => {
      for (const statement of statements) {
        sent += 1;
        if (failAt !== undefined && sent >= failAt) {
          throw new Error(`statement ${String(failAt)} failed`);
        }
        await real.executeStatements(tx, [statement]);
      }
    },
  };
  return {
    pipeline: new PushSchemaPipeline({
      executor: executor as unknown as DrizzleStatementExecutor,
      renameDetector: noopRenameDetector,
      classifier: noopClassifier,
      promptDispatcher: noopPromptDispatcher,
      preRenameExecutor: noopPreRenameExecutor,
      preCleanupExecutor: noopPreCleanupExecutor,
      migrationJournal: noopMigrationJournal,
      notifier: noopNotifier,
    }),
    sent: () => sent,
  };
}

describe.skipIf(!MYSQL_URL)("a failed apply's kept statements (mysql)", () => {
  const tableName = `${MYSQL.prefix}_kept_page`;
  const pool: MysqlPool = createPool({ uri: MYSQL_URL });
  const db = drizzleMysql({ client: pool });
  const databaseName = new URL(MYSQL_URL).pathname.slice(1);

  const apply = (desired: DesiredSchema, failAt?: number) => {
    const made = pipelineFailingAt("mysql", db, failAt);
    return made.pipeline
      .apply({
        desired,
        db,
        dialect: "mysql",
        source: "ui",
        promptChannel: "browser",
        databaseName,
        uiTargetSlug: "page",
        uiTargetKind: "single",
      })
      .then(result => ({ result, sent: made.sent() }));
  };

  const columns = async () =>
    (await introspectLiveSnapshot(db, "mysql", [tableName])).tables
      .find(table => table.name === tableName)
      ?.columns.map(column => column.name)
      .sort();

  beforeEach(async () => {
    await pool.promise().query(`DROP TABLE IF EXISTS \`${tableName}\``);
    const made = await apply(single(tableName, ["title"]));
    expect(made.result.success).toBe(true);
  });

  afterAll(async () => {
    await pool.promise().query(`DROP TABLE IF EXISTS \`${tableName}\``);
    await new Promise<void>(resolve => pool.end(() => resolve()));
  });

  it("keeps none where the first statement fails, and says so, with the table as it was", async () => {
    const before = await columns();

    const { result, sent } = await apply(
      single(tableName, ["title", "summary", "body"]),
      1
    );

    // Positive control: the apply reached its first statement, and failed there.
    expect(sent).toBe(1);
    expect(result.success).toBe(false);
    expect(result.statementsKept).toBe(0);
    expect(await columns()).toEqual(before);
  });

  it("keeps the first where the second fails", async () => {
    const before = await columns();

    const { result, sent } = await apply(
      single(tableName, ["title", "summary", "body"]),
      2
    );

    expect(sent).toBe(2);
    expect(result.success).toBe(false);
    expect(result.statementsKept).toBe(1);
    // The statement that stayed changed the table.
    expect(await columns()).not.toEqual(before);
  });
});

describe.skipIf(!PG_URL)("a failed apply's kept statements (postgres)", () => {
  const tableName = `${PG.prefix}_kept_page`;
  const pool = new Pool({ connectionString: PG_URL });
  const db = drizzlePg({ client: pool });

  afterAll(async () => {
    await db.execute(`DROP TABLE IF EXISTS "${tableName}"`);
    await pool.end();
  });

  it("says nothing, as the apply rolls back whole", async () => {
    await db.execute(`DROP TABLE IF EXISTS "${tableName}"`);
    const made = pipelineFailingAt("postgresql", db);
    const created = await made.pipeline.apply({
      desired: single(tableName, ["title"]),
      db,
      dialect: "postgresql",
      source: "ui",
      promptChannel: "browser",
      uiTargetSlug: "page",
      uiTargetKind: "single",
    });
    expect(created.success).toBe(true);

    const failing = pipelineFailingAt("postgresql", db, 1);
    const result = await failing.pipeline.apply({
      desired: single(tableName, ["title", "summary", "body"]),
      db,
      dialect: "postgresql",
      source: "ui",
      promptChannel: "browser",
      uiTargetSlug: "page",
      uiTargetKind: "single",
    });

    expect(failing.sent()).toBe(1);
    expect(result.success).toBe(false);
    expect(result.statementsKept).toBeUndefined();
  });
});
