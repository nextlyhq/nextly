/**
 * A code-first apply's field type change that keeps its column is judged over the values the
 * column holds before anything runs (`refuseConfiguredTypeChanges`): no statement, and so no other
 * rule, sees it. A change that alters the column's type is the conversion rule's, and is left to
 * it; a Schema Builder entity is the Builder save's, and is left to that. `db:sync`'s own apply,
 * through the pipeline with its real classifier, refuses the same change and changes nothing.
 *
 * Against real databases: SQLite in memory, and PostgreSQL and MySQL where their URLs are set,
 * each in a table of this file's own prefix.
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import Database from "better-sqlite3";
import { drizzle as drizzleSqlite } from "drizzle-orm/better-sqlite3";
import { drizzle as drizzleMysql } from "drizzle-orm/mysql2";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { createPool, type Pool as MysqlPool } from "mysql2";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { getDialectTables } from "../../../../database/index";
import { makeTestContext } from "../../../../database/__tests__/integration/helpers/test-db";
import { clearCachedSnapshot } from "../../../../init/schema-snapshot-cache";
import { DrizzleStatementExecutor } from "../../services/drizzle-statement-executor";
import { getColumnDescriptor } from "../../services/field-column-descriptor";
import { RealClassifier } from "../classifier/classifier";
import { freshPushSchema } from "../fresh-push";
import { PushSchemaPipeline } from "../pushschema-pipeline";
import {
  noopMigrationJournal,
  noopNotifier,
  noopPreCleanupExecutor,
  noopPreRenameExecutor,
  noopPromptDispatcher,
  noopRenameDetector,
} from "../pushschema-pipeline-stubs";
import type { DesiredSchema } from "../types";
import { refuseConfiguredTypeChanges } from "../ui-type-changes";

const TEXT = { name: "heading", type: "text" };
const SELECT = {
  name: "heading",
  type: "select",
  options: [{ label: "A", value: "a" }],
};
const NUMBER = { name: "heading", type: "number" };

/** A code-first apply of `table` from `before` to `after`, stating the fields it changes from. */
function applying(
  table: string,
  before: object,
  after: object,
  builderOwned = false
): DesiredSchema {
  return {
    collections: {
      [table]: {
        slug: table,
        tableName: table,
        fields: [after] as never,
        recordedFields: [before] as never,
        ...(builderOwned ? { builderOwned: true } : {}),
      },
    },
    singles: {},
    components: {},
  };
}

interface Connection {
  db: unknown;
  dialect: SupportedDialect;
  run: (sql: string) => Promise<unknown>;
  /** The rows a query returns. */
  rows: (sql: string) => Promise<Record<string, unknown>[]>;
  close: () => Promise<void>;
  /** MySQL's pushSchema needs it. */
  databaseName?: string;
}

/**
 * `db:sync`'s apply of `desired`: the pipeline it builds, with its own classifier, from code. Only
 * the prompts, renames and journal are stubbed, as no case here asks or records one.
 */
function sync(connection: Connection, desired: DesiredSchema) {
  return new PushSchemaPipeline({
    executor: new DrizzleStatementExecutor(connection.dialect, connection.db),
    renameDetector: noopRenameDetector,
    classifier: new RealClassifier(),
    promptDispatcher: noopPromptDispatcher,
    preRenameExecutor: noopPreRenameExecutor,
    preCleanupExecutor: noopPreCleanupExecutor,
    migrationJournal: noopMigrationJournal,
    notifier: noopNotifier,
  }).apply({
    desired,
    db: connection.db,
    dialect: connection.dialect,
    source: "code",
    promptChannel: "terminal",
    ...(connection.databaseName !== undefined
      ? { databaseName: connection.databaseName }
      : {}),
  });
}

const TITLE = { name: "title", type: "text" };

/**
 * `db:sync`'s cases: a first sync creates the table as code configures it, rows are written, and a
 * second sync changes `heading` from text to a select, stating the old fields as `db:sync` reads
 * them from the registry before its collection sync replaces them.
 */
function syncCases(open: () => { connection: Connection; table: string }) {
  async function created(values: Record<string, string>) {
    const { connection, table } = open();
    const q = (n: string) =>
      connection.dialect === "mysql" ? `\`${n}\`` : `"${n}"`;
    await connection.run(`DROP TABLE IF EXISTS ${q(table)}`);
    clearCachedSnapshot();
    const first = await sync(connection, {
      collections: {
        [table]: {
          slug: table,
          tableName: table,
          fields: [TITLE, TEXT] as never,
        },
      },
      singles: {},
      components: {},
    });
    expect(first.error).toBeUndefined();
    for (const [id, value] of Object.entries(values)) {
      await connection.run(
        `INSERT INTO ${q(table)} (${q("id")}, ${q("title")}, ${q("slug")}, ${q("heading")}) VALUES ('${id}', 'T', '${id}', '${value}')`
      );
    }
    clearCachedSnapshot();
    const headings = async () =>
      Object.fromEntries(
        (
          await connection.rows(
            `SELECT ${q("id")}, ${q("heading")} FROM ${q(table)} ORDER BY ${q("id")}`
          )
        ).map(row => [String(row.id), String(row.heading)])
      );
    const changed: DesiredSchema = {
      collections: {
        [table]: {
          slug: table,
          tableName: table,
          fields: [TITLE, SELECT] as never,
          recordedFields: [TITLE, TEXT] as never,
        },
      },
      singles: {},
      components: {},
    };
    return { connection, headings, changed };
  }

  it("refuses db:sync's apply of the change over a value the new type cannot read, and changes nothing", async () => {
    const { connection, headings, changed } = await created({
      r1: "a",
      r2: "Hello",
    });

    const result = await sync(connection, changed);

    expect(result.success).toBe(false);
    expect(result.error).toMatchObject({
      code: "PRECONDITION_FAILED",
      details: {
        errors: [{ path: "fields.heading", code: "TYPE_CHANGE_LOSES_VALUES" }],
      },
    });
    expect(await headings()).toEqual({ r1: "a", r2: "Hello" });
  });

  it("lets db:sync apply the same change where every value is one the new type reads", async () => {
    const { connection, headings, changed } = await created({
      r1: "a",
      r2: "a",
    });

    const result = await sync(connection, changed);

    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
    expect(await headings()).toEqual({ r1: "a", r2: "a" });
  });
}

/** The cases, given a table holding `heading` values by row id, created as code-first creates it. */
function cases(open: () => { connection: Connection; table: string }) {
  async function holding(values: Record<string, string>) {
    const { connection, table } = open();
    const q = (n: string) =>
      connection.dialect === "mysql" ? `\`${n}\`` : `"${n}"`;
    const column = getColumnDescriptor(
      TEXT as never,
      connection.dialect,
      "codeFirst"
    );
    await connection.run(`DROP TABLE IF EXISTS ${q(table)}`);
    await connection.run(
      `CREATE TABLE ${q(table)} (${q("id")} varchar(36) PRIMARY KEY, ${q("heading")} ${column?.dialectType ?? "text"})`
    );
    for (const [id, value] of Object.entries(values)) {
      await connection.run(
        `INSERT INTO ${q(table)} (${q("id")}, ${q("heading")}) VALUES ('${id}', '${value}')`
      );
    }
    return { connection, table };
  }

  it("refuses a change that keeps its column over a value the new type cannot read", async () => {
    const { connection, table } = await holding({ r1: "a", r2: "Hello" });

    await expect(
      refuseConfiguredTypeChanges(
        applying(table, TEXT, SELECT),
        connection.db,
        connection.dialect
      )
    ).rejects.toMatchObject({
      publicData: {
        errors: [{ path: "fields.heading", code: "TYPE_CHANGE_LOSES_VALUES" }],
      },
    });
  });

  it("lets the same change go ahead where every value is one the new type reads", async () => {
    const { connection, table } = await holding({ r1: "a", r2: "a" });

    await expect(
      refuseConfiguredTypeChanges(
        applying(table, TEXT, SELECT),
        connection.db,
        connection.dialect
      )
    ).resolves.toBeUndefined();
  });

  it("leaves a change of the column's type to the conversion rule", async () => {
    // A text becoming a number changes the column's type: the classifier's conversion rule judges
    // it, so this precondition does not, whatever the values hold.
    const { connection, table } = await holding({ r1: "abc" });

    await expect(
      refuseConfiguredTypeChanges(
        applying(table, TEXT, NUMBER),
        connection.db,
        connection.dialect
      )
    ).resolves.toBeUndefined();
  });

  it("leaves a Schema Builder entity to the Builder save", async () => {
    const { connection, table } = await holding({ r1: "Hello" });

    await expect(
      refuseConfiguredTypeChanges(
        applying(table, TEXT, SELECT, true),
        connection.db,
        connection.dialect
      )
    ).resolves.toBeUndefined();
  });
}

describe("a code-first type change that keeps its column (sqlite)", () => {
  let sqlite: Database.Database;
  let connection: Connection;
  beforeEach(async () => {
    clearCachedSnapshot();
    sqlite?.close();
    sqlite = new Database(":memory:");
    const db = drizzleSqlite({ client: sqlite });
    connection = {
      db,
      dialect: "sqlite",
      run: sql => Promise.resolve(sqlite.exec(sql)),
      rows: sql =>
        Promise.resolve(sqlite.prepare(sql).all() as Record<string, unknown>[]),
      close: () => Promise.resolve(),
    };
    // The system tables a sync reads and writes, as a fresh install has them.
    await freshPushSchema("sqlite", db, getDialectTables("sqlite"));
  });
  afterAll(() => {
    clearCachedSnapshot();
    sqlite?.close();
  });

  cases(() => ({ connection, table: "dc_cfg_items" }));
  syncCases(() => ({ connection, table: "dc_cfg_items" }));
});

const SERVERS: Array<{
  dialect: "postgresql" | "mysql";
  open: (url: string) => Connection;
}> = [
  {
    dialect: "postgresql",
    open: url => {
      const pool = new Pool({ connectionString: url });
      return {
        db: drizzlePg({ client: pool }),
        dialect: "postgresql",
        run: sql => pool.query(sql),
        rows: async sql => (await pool.query(sql)).rows,
        close: () => pool.end(),
      };
    },
  },
  {
    dialect: "mysql",
    open: url => {
      const pool: MysqlPool = createPool({ uri: url });
      return {
        db: drizzleMysql({ client: pool }),
        dialect: "mysql",
        run: sql => pool.promise().query(sql),
        rows: async sql => {
          const [rows] = await pool.promise().query(sql);
          return rows as Record<string, unknown>[];
        },
        close: () => new Promise<void>(done => pool.end(() => done())),
        databaseName: new URL(url).pathname.slice(1),
      };
    },
  },
];

for (const server of SERVERS) {
  const context = makeTestContext(server.dialect);
  describe.skipIf(!context.url)(
    `a code-first type change that keeps its column (${server.dialect})`,
    () => {
      const table = `dc_${context.prefix}_cfg_items`;
      let connection: Connection;
      beforeAll(() => {
        connection = server.open(context.url ?? "");
      });
      beforeEach(() => clearCachedSnapshot());
      afterAll(async () => {
        await connection.run(
          `DROP TABLE IF EXISTS ${server.dialect === "mysql" ? `\`${table}\`` : `"${table}"`}`
        );
        await connection.close();
        clearCachedSnapshot();
      });

      cases(() => ({ connection, table }));
      syncCases(() => ({ connection, table }));
    }
  );
}
