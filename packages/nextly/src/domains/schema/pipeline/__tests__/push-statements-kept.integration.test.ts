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
 * before it, as the database would. And pre-cleanup's statements are counted as they run: on MySQL,
 * one a trigger refuses, its first, leaves none kept. (SQLite refuses, before anything runs, to
 * rebuild a table with triggers its schema does not track, so a trigger cannot reach its
 * pre-cleanup; its statements are recorded by the same code.)
 */
import { drizzle as drizzleMysql } from "drizzle-orm/mysql2";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { createPool, type Pool as MysqlPool } from "mysql2";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { makeTestContext } from "../../../../database/__tests__/integration/helpers/test-db";
import {
  clearCachedSnapshot,
  clearLiveSnapshots,
} from "../../../../init/schema-snapshot-cache";
import { DrizzleStatementExecutor } from "../../services/drizzle-statement-executor";
import { RealClassifier } from "../classifier/classifier";
import { introspectLiveSnapshot } from "../diff/introspect-live";
import { RealPreCleanupExecutor } from "../pre-cleanup/executor";
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
import { RegexRenameDetector } from "../rename-detector";
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

/** A collection on `tableName` whose text field `total` is required or not. */
function orders(tableName: string, required: boolean): DesiredSchema {
  return {
    collections: {
      orders: {
        slug: "orders",
        tableName,
        fields: [{ name: "total", type: "text", required }] as never,
      },
    },
    singles: {},
    components: {},
  };
}

/** A pipeline that classifies and pre-cleans for real, answering `total`'s NULLs with a default. */
function fillingPipeline(
  dialect: "mysql",
  db: unknown,
  tableName: string
): PushSchemaPipeline {
  clearCachedSnapshot();
  clearLiveSnapshots();
  return new PushSchemaPipeline({
    executor: new DrizzleStatementExecutor(dialect, db),
    renameDetector: new RegexRenameDetector(),
    classifier: new RealClassifier(),
    promptDispatcher: {
      dispatch: () =>
        Promise.resolve({
          confirmedRenames: [],
          resolutions: [
            {
              kind: "provide_default",
              eventId: `add_not_null_with_nulls:${tableName}.total`,
              value: "0",
            },
          ],
          proceed: true,
        }),
    },
    preRenameExecutor: noopPreRenameExecutor,
    preCleanupExecutor: new RealPreCleanupExecutor(),
    migrationJournal: noopMigrationJournal,
    notifier: noopNotifier,
  });
}

/**
 * One row in `tableName` with `total` NULL, every other column that needs a value given one: a row
 * the change making `total` required must fill first.
 */
async function insertRowWithoutTotal(
  dialect: "mysql",
  db: unknown,
  tableName: string,
  run: (statement: string) => Promise<unknown>
): Promise<void> {
  const quote = (name: string) =>
    dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
  const live = await introspectLiveSnapshot(db, dialect, [tableName]);
  const columns = (
    live.tables.find(t => t.name === tableName)?.columns ?? []
  ).filter(
    column =>
      column.name !== "total" &&
      !column.nullable &&
      column.default === undefined
  );
  const value = (type: string) =>
    /int|numeric|decimal|double|real|float|bool/i.test(type)
      ? "0"
      : /date|time/i.test(type)
        ? "'2026-01-01 00:00:00'"
        : "'r1'";
  await run(
    `INSERT INTO ${quote(tableName)} (${columns.map(c => quote(c.name)).join(", ")}) VALUES (${columns.map(c => value(c.type)).join(", ")})`
  );
}

/**
 * `tableName` made with `total` optional and a row holding no total, a trigger refusing every
 * update of it, then the change making `total` required applied: its pre-cleanup's first
 * statement, the fill, is refused, so nothing of the change ran.
 */
async function fillRefusedByTrigger(
  dialect: "mysql",
  db: unknown,
  tableName: string,
  run: (statement: string) => Promise<unknown>,
  databaseName?: string
) {
  const target = {
    db,
    dialect,
    source: "code" as const,
    promptChannel: "terminal" as const,
    ...(databaseName === undefined ? {} : { databaseName }),
  };
  const made = await fillingPipeline(dialect, db, tableName).apply({
    ...target,
    desired: orders(tableName, false),
  });
  expect(made.success).toBe(true);
  await insertRowWithoutTotal(dialect, db, tableName, run);
  await run(
    dialect === "mysql"
      ? `CREATE TRIGGER \`${tableName}_refuse\` BEFORE UPDATE ON \`${tableName}\` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'refused by a trigger'`
      : `CREATE TRIGGER "${tableName}_refuse" BEFORE UPDATE ON "${tableName}" BEGIN SELECT RAISE(ABORT, 'refused by a trigger'); END`
  );
  return fillingPipeline(dialect, db, tableName).apply({
    ...target,
    desired: orders(tableName, true),
  });
}

/** `authors`, and `posts` relating to it by `author`, to one entry or to many. */
function postsRelating(
  postsTable: string,
  authorsTable: string,
  hasMany: boolean
): DesiredSchema {
  return {
    collections: {
      authors: {
        slug: "authors",
        tableName: authorsTable,
        fields: [{ name: "name", type: "text" }] as never,
      },
      posts: {
        slug: "posts",
        tableName: postsTable,
        fields: [
          {
            name: "author",
            type: "relationship",
            relationTo: "authors",
            hasMany,
          },
        ] as never,
      },
    },
    singles: {},
    components: {},
  };
}

/** A pipeline that classifies for real and asks nothing it is not answered. */
function classifyingPipeline(db: unknown): PushSchemaPipeline {
  clearCachedSnapshot();
  clearLiveSnapshots();
  return new PushSchemaPipeline({
    executor: new DrizzleStatementExecutor("mysql", db),
    renameDetector: new RegexRenameDetector(),
    classifier: new RealClassifier(),
    promptDispatcher: {
      dispatch: () =>
        Promise.resolve({
          confirmedRenames: [],
          resolutions: [],
          proceed: true,
        }),
    },
    preRenameExecutor: noopPreRenameExecutor,
    preCleanupExecutor: new RealPreCleanupExecutor(),
    migrationJournal: noopMigrationJournal,
    notifier: noopNotifier,
  });
}

describe.skipIf(!MYSQL_URL)("a failed apply's kept statements (mysql)", () => {
  const tableName = `${MYSQL.prefix}_kept_page`;
  // Made in `beforeAll`: a skipped describe still runs its body, where an unset URL would throw.
  let pool: MysqlPool;
  let db: ReturnType<typeof drizzleMysql<Record<string, never>, MysqlPool>>;
  let databaseName: string;

  beforeAll(() => {
    pool = createPool({ uri: MYSQL_URL });
    db = drizzleMysql({ client: pool });
    databaseName = new URL(MYSQL_URL).pathname.slice(1);
  });

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

  it("keeps none where pre-cleanup's first statement is refused, and says so", async () => {
    const orderTable = `${MYSQL.prefix}_kept_orders`;
    await pool.promise().query(`DROP TABLE IF EXISTS \`${orderTable}\``);
    try {
      const result = await fillRefusedByTrigger(
        "mysql",
        db,
        orderTable,
        statement => pool.promise().query(statement),
        databaseName
      );

      expect(result.success, JSON.stringify(result.error)).toBe(false);
      // Positive control: the fill reached the database, which refused it.
      expect(JSON.stringify(result.error)).toContain("refused by a trigger");
      expect(result.statementsKept).toBe(0);
      const [rows] = await pool
        .promise()
        .query(
          `SELECT COUNT(*) AS n FROM \`${orderTable}\` WHERE \`total\` IS NULL`
        );
      expect(Number((rows as { n: unknown }[])[0]?.n)).toBe(1);
    } finally {
      await pool.promise().query(`DROP TABLE IF EXISTS \`${orderTable}\``);
    }
  });

  // A relationship switched from one entry to many is one operation of three statements on MySQL:
  // the column made text, its values rewritten as lists, the column made the list type. The first
  // commits as it runs, so where the second is refused, one statement stays. Its key is dropped
  // first, so no lifted key runs before it and counts.
  it("counts each statement of an operation that runs several, where a later one fails", async () => {
    const postsTable = `${MYSQL.prefix}_kept_posts`;
    const authorsTable = `${MYSQL.prefix}_kept_authors`;
    const drop = async () => {
      await pool.promise().query(`DROP TABLE IF EXISTS \`${postsTable}\``);
      await pool.promise().query(`DROP TABLE IF EXISTS \`${authorsTable}\``);
    };
    await drop();
    try {
      const target = {
        db,
        dialect: "mysql" as const,
        source: "code" as const,
        promptChannel: "terminal" as const,
        databaseName,
      };
      const made = await classifyingPipeline(db).apply({
        ...target,
        desired: postsRelating(postsTable, authorsTable, false),
      });
      expect(made.success, JSON.stringify(made.error)).toBe(true);
      const [keys] = await pool
        .promise()
        .query(
          `SELECT CONSTRAINT_NAME AS name FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = 'author' AND REFERENCED_TABLE_NAME IS NOT NULL`,
          [postsTable]
        );
      for (const { name } of keys as { name: string }[]) {
        await pool
          .promise()
          .query(`ALTER TABLE \`${postsTable}\` DROP FOREIGN KEY \`${name}\``);
      }
      const run = (statement: string) => pool.promise().query(statement);
      await insertRowWithoutTotal("mysql", db, postsTable, run);
      // A value for the rewrite to change: a row holding no author is left as it is.
      await run(`UPDATE \`${postsTable}\` SET \`author\` = 'an-author'`);
      await run(
        `CREATE TRIGGER \`${postsTable}_refuse\` BEFORE UPDATE ON \`${postsTable}\` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'refused by a trigger'`
      );

      const result = await classifyingPipeline(db).apply({
        ...target,
        desired: postsRelating(postsTable, authorsTable, true),
      });

      expect(result.success, JSON.stringify(result.error)).toBe(false);
      // Positive control: the values' rewrite reached the database, which refused it.
      expect(JSON.stringify(result.error)).toContain("refused by a trigger");
      expect(result.statementsKept).toBe(1);
      // The statement that stayed: the column is text now.
      const [columns] = await pool
        .promise()
        .query(
          `SELECT DATA_TYPE AS t FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = 'author'`,
          [postsTable]
        );
      expect((columns as { t: string }[])[0]?.t).toBe("text");
    } finally {
      await drop();
    }
  });
});

describe.skipIf(!PG_URL)("a failed apply's kept statements (postgres)", () => {
  const tableName = `${PG.prefix}_kept_page`;
  let pool: Pool;
  let db: ReturnType<typeof drizzlePg>;

  beforeAll(() => {
    pool = new Pool({ connectionString: PG_URL });
    db = drizzlePg({ client: pool });
  });

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
