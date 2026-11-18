/**
 * A Schema Builder save that changes a field's type is judged over the values its column holds
 * before the push plans or runs anything (`refuseUiTypeChanges`): a change that would clear a
 * value, with no consent naming the field, refuses the save naming the field, both types and the
 * row, and leaves the column and its values as they were; a change every value survives goes ahead
 * as before.
 *
 * Against real databases, the Builder's DDL generator and the real pipeline: SQLite in memory, and
 * PostgreSQL and MySQL where their URLs are set, each in a table of this file's own prefix.
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import Database from "better-sqlite3";
import { drizzle as drizzleSqlite } from "drizzle-orm/better-sqlite3";
import { drizzle as drizzleMysql } from "drizzle-orm/mysql2";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { createPool, type Pool as MysqlPool } from "mysql2";
import { Pool } from "pg";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import { getDialectTables } from "../../../../database/index";
import { makeTestContext } from "../../../../database/__tests__/integration/helpers/test-db";
import { clearCachedSnapshot } from "../../../../init/schema-snapshot-cache";
import { DynamicCollectionSchemaService } from "../../../dynamic-collections/services/dynamic-collection-schema-service";
import { DrizzleStatementExecutor } from "../../services/drizzle-statement-executor";
import { introspectLiveSnapshot } from "../diff/introspect-live";
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
import { RegexRenameDetector } from "../rename-detector";
import type { DesiredSchema } from "../types";

interface Target {
  db: unknown;
  dialect: SupportedDialect;
  /** MySQL's pushSchema needs it. */
  databaseName?: string;
}

const scoreFields = (score: "text" | "number") => [
  { name: "title", type: "text" },
  { name: "score", type: score },
];

/** The Builder's own DDL for one table, one statement at a time. */
function builderStatements(dialect: SupportedDialect, table: string): string[] {
  return new DynamicCollectionSchemaService(undefined, dialect)
    .generateMigrationSQL(table, scoreFields("text") as never)
    .split("--> statement-breakpoint")
    .map(part =>
      part
        .split("\n")
        .filter(line => !line.trim().startsWith("--"))
        .join("\n")
        .trim()
    )
    .filter(statement => statement.length > 0);
}

/** A Schema Builder save turning the score into a number, stating the fields it changes from. */
function scoreToNumber(slug: string, table: string): DesiredSchema {
  return {
    collections: {
      [slug]: {
        slug,
        tableName: table,
        fields: scoreFields("number") as never,
        builderOwned: true,
        recordedFields: scoreFields("text") as never,
      },
    },
    singles: {},
    components: {},
  };
}

/**
 * One Schema Builder save, as the Builder's save applies it. With `confirmRenames`, a dropped
 * column and an added one are paired as a rename and the author confirms it, as the Builder's
 * dialog does.
 */
function save(
  target: Target,
  desired: DesiredSchema,
  { confirmRenames = false }: { confirmRenames?: boolean } = {}
) {
  return new PushSchemaPipeline({
    executor: new DrizzleStatementExecutor(target.dialect, target.db),
    renameDetector: confirmRenames
      ? new RegexRenameDetector()
      : noopRenameDetector,
    classifier: noopClassifier,
    promptDispatcher: confirmRenames
      ? {
          dispatch: ({ candidates }) =>
            Promise.resolve({
              confirmedRenames: [...candidates],
              resolutions: [],
              proceed: true,
            }),
        }
      : noopPromptDispatcher,
    preRenameExecutor: noopPreRenameExecutor,
    preCleanupExecutor: noopPreCleanupExecutor,
    migrationJournal: noopMigrationJournal,
    notifier: noopNotifier,
  }).apply({
    desired,
    db: target.db,
    dialect: target.dialect,
    source: "ui",
    promptChannel: "browser",
    ...(target.databaseName !== undefined
      ? { databaseName: target.databaseName }
      : {}),
  });
}

/** The score renamed to `points` and turned into a number, in one save. */
function scoreToPoints(slug: string, table: string): DesiredSchema {
  const desired = scoreToNumber(slug, table);
  desired.collections[slug].fields = [
    { name: "title", type: "text" },
    { name: "points", type: "number" },
  ] as never;
  return desired;
}

/** The table's columns, by name, with the type the diff reads for each. */
async function columnTypes(target: Target, table: string) {
  const live = await introspectLiveSnapshot(target.db, target.dialect, [table]);
  return Object.fromEntries(
    (live.tables.find(t => t.name === table)?.columns ?? []).map(column => [
      column.name,
      column.type,
    ])
  );
}

/** The score column's type, as the diff reads it. */
async function scoreType(target: Target, table: string) {
  return (await columnTypes(target, table)).score;
}

/** Each case, given a table holding `scores` by row id and a way to read them back. */
function cases(
  open: () => {
    target: Target;
    slug: string;
    table: string;
    seed: (scores: Record<string, string>) => Promise<void>;
    scores: () => Promise<Record<string, unknown>>;
  }
) {
  it("refuses a change that would clear a value, naming the field and the row, and changes nothing", async () => {
    const { target, slug, table, seed, scores } = open();
    await seed({ p1: "5", p2: "xyz" });
    const before = await scoreType(target, table);

    const result = await save(target, scoreToNumber(slug, table));

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("PRECONDITION_FAILED");
    expect(result.error?.message).toContain(
      `Collection '${slug}': field 'score' cannot change from text to number`
    );
    expect(result.error?.message).toContain(
      "values that are not a number would be cleared"
    );
    expect(result.error?.message).toContain("p2");
    expect(result.error?.message).not.toContain("xyz");
    expect(result.error?.details).toMatchObject({
      errors: [{ path: "fields.score", code: "TYPE_CHANGE_LOSES_VALUES" }],
    });
    expect(await scoreType(target, table)).toBe(before);
    expect(await scores()).toEqual({ p1: "5", p2: "xyz" });
  });

  it("judges a field renamed and retyped in one save over the values its old column holds", async () => {
    const { target, slug, table, seed, scores } = open();
    await seed({ p1: "5", p2: "xyz" });
    const before = await columnTypes(target, table);

    const result = await save(target, scoreToPoints(slug, table), {
      confirmRenames: true,
    });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("PRECONDITION_FAILED");
    expect(result.error?.message).toContain(
      `Collection '${slug}': field 'points' cannot change from text to number`
    );
    expect(result.error?.message).toContain("p2");
    expect(await columnTypes(target, table)).toEqual(before);
    expect(await scores()).toEqual({ p1: "5", p2: "xyz" });
  });

  it("refuses a change that would round a value, as blocked", async () => {
    // The Builder's number keeps whole numbers: 12.5 would be stored rounded.
    const { target, slug, table, seed, scores } = open();
    await seed({ p1: "5", p2: "12.5" });
    const before = await scoreType(target, table);

    const result = await save(target, scoreToNumber(slug, table));

    expect(result.success).toBe(false);
    expect(result.error?.message).toContain(
      `Collection '${slug}': field 'score' cannot change from text to number (blocked:`
    );
    expect(result.error?.message).toContain(
      "values the new type holds only rounded (1 row: id p2)"
    );
    expect(result.error?.details).toMatchObject({
      errors: [{ path: "fields.score", code: "TYPE_CHANGE_BLOCKED" }],
    });
    expect(await scoreType(target, table)).toBe(before);
    expect(await scores()).toEqual({ p1: "5", p2: "12.5" });
  });

  it("goes ahead with a change every value survives", async () => {
    const { target, slug, table, seed } = open();
    await seed({ p1: "5", p2: "12" });
    const before = await scoreType(target, table);

    const result = await save(target, scoreToNumber(slug, table));

    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
    expect(await scoreType(target, table)).not.toBe(before);
  });
}

describe("a Schema Builder save's field type change (sqlite)", () => {
  const slug = "utc_items";
  const table = `dc_${slug}`;
  let sqlite: Database.Database;
  let target: Target;

  beforeEach(async () => {
    clearCachedSnapshot();
    sqlite = new Database(":memory:");
    const db = drizzleSqlite({ client: sqlite });
    target = { db, dialect: "sqlite" };
    await freshPushSchema("sqlite", db, getDialectTables("sqlite"));
    for (const statement of builderStatements("sqlite", table)) {
      sqlite.exec(statement);
    }
  });
  afterEach(() => {
    clearCachedSnapshot();
    sqlite.close();
  });

  cases(() => ({
    target,
    slug,
    table,
    seed: scores => {
      for (const [id, score] of Object.entries(scores)) {
        sqlite
          .prepare(
            `INSERT INTO "${table}" (id, title, slug, score) VALUES (?, 'T', ?, ?)`
          )
          .run(id, id, score);
      }
      return Promise.resolve();
    },
    scores: () =>
      Promise.resolve(
        Object.fromEntries(
          (
            sqlite.prepare(`SELECT id, score FROM "${table}"`).all() as {
              id: string;
              score: unknown;
            }[]
          ).map(row => [row.id, row.score])
        )
      ),
  }));
});

const SERVERS: Array<{
  dialect: "postgresql" | "mysql";
  open: (url: string) => {
    target: Target;
    query: (sql: string) => Promise<Record<string, unknown>[]>;
    close: () => Promise<void>;
  };
}> = [
  {
    dialect: "postgresql",
    open: url => {
      const pool = new Pool({ connectionString: url });
      return {
        target: { db: drizzlePg({ client: pool }), dialect: "postgresql" },
        query: async statement => (await pool.query(statement)).rows,
        close: () => pool.end(),
      };
    },
  },
  {
    dialect: "mysql",
    open: url => {
      const pool: MysqlPool = createPool({ uri: url });
      return {
        target: {
          db: drizzleMysql({ client: pool }),
          dialect: "mysql",
          databaseName: new URL(url).pathname.slice(1),
        },
        query: async statement => {
          const [rows] = await pool.promise().query(statement);
          return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
        },
        close: () => new Promise<void>(done => pool.end(() => done())),
      };
    },
  },
];

for (const server of SERVERS) {
  const context = makeTestContext(server.dialect);
  describe.skipIf(!context.url)(
    `a Schema Builder save's field type change (${server.dialect})`,
    () => {
      const slug = `${context.prefix}_utc_items`;
      const table = `dc_${slug}`;
      const quote = (name: string) =>
        server.dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
      let connection: ReturnType<(typeof server)["open"]>;

      beforeAll(() => {
        connection = server.open(context.url ?? "");
      });
      beforeEach(async () => {
        clearCachedSnapshot();
        await connection.query(`DROP TABLE IF EXISTS ${quote(table)}`);
        for (const statement of builderStatements(server.dialect, table)) {
          await connection.query(statement);
        }
      });
      afterAll(async () => {
        await connection.query(`DROP TABLE IF EXISTS ${quote(table)}`);
        await connection.close();
        clearCachedSnapshot();
      });

      cases(() => ({
        target: connection.target,
        slug,
        table,
        seed: async scores => {
          for (const [id, score] of Object.entries(scores)) {
            await connection.query(
              `INSERT INTO ${quote(table)} (id, title, slug, score) VALUES ('${id}', 'T', '${id}', '${score}')`
            );
          }
        },
        scores: async () =>
          Object.fromEntries(
            (
              await connection.query(`SELECT id, score FROM ${quote(table)}`)
            ).map(row => [row.id, row.score])
          ),
      }));
    }
  );
}
