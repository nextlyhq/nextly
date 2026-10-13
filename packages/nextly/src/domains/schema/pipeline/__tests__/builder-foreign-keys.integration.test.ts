/**
 * A Schema Builder collection keeps its foreign keys, and gets the key of a
 * relationship added to it.
 *
 * A Builder table is created by the Builder's own DDL, with each
 * relationship's key; every later save goes through the push pipeline, as the
 * Builder's save does (`source: "ui"`, the entity Builder-owned). That
 * pipeline described no key, so:
 *
 * - a relationship added to an existing Builder collection got no key, on
 *   any dialect;
 * - on SQLite, which holds a key only in `CREATE TABLE` and changes a column's
 *   type by rebuilding the table, a rebuild dropped the table's own key, and a
 *   rebuild of its parent was refused outright, because drizzle-kit, reading
 *   the whole database, saw the child's key as one to drop.
 *
 * The SQLite cases also check that no delete action fires during a rebuild:
 * the child cascades on delete, so a rebuild that dropped the parent with
 * foreign keys enforced would take the child's rows with it.
 *
 * Against real databases, the Builder's DDL generator and the real pipeline:
 * SQLite in memory with foreign keys enforced, and PostgreSQL and MySQL where
 * their URLs are set, each in tables of this file's own prefix.
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

/** Two Builder collections: authors, and posts that point at them. */
interface Pair {
  /** The authors' slug; the Builder keys a relationship to `dc_<slug>`. */
  authorsSlug: string;
  authors: string;
  posts: string;
}

const pairNamed = (stem: string): Pair => ({
  authorsSlug: `${stem}_authors`,
  authors: `dc_${stem}_authors`,
  posts: `dc_${stem}_posts`,
});

/**
 * A many-to-one to the authors, deleted with its author. Named in camelCase,
 * so its column (`lead_author`) is not spelled like the field: the runtime
 * table keys its columns by field name and the spec by column name.
 */
const authorField = (pair: Pair) => ({
  name: "leadAuthor",
  type: "relationship",
  options: {
    target: pair.authorsSlug,
    relationType: "manyToOne",
    onDelete: "cascade",
  },
});

const authorFields = (rank: "text" | "number") => [
  { name: "name", type: "text" },
  { name: "rank", type: rank },
];
const postFields = (
  pair: Pair,
  score: "text" | "number",
  withAuthor = true
) => [
  { name: "title", type: "text" },
  { name: "score", type: score },
  ...(withAuthor ? [authorField(pair)] : []),
];

interface Target {
  db: unknown;
  dialect: SupportedDialect;
  /** MySQL's pushSchema needs it. */
  databaseName?: string;
}

/** The Builder's own DDL for one table, one statement at a time. */
function builderStatements(
  dialect: SupportedDialect,
  table: string,
  fields: unknown[]
): string[] {
  return new DynamicCollectionSchemaService(undefined, dialect)
    .generateMigrationSQL(table, fields as never)
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

/** The desired schema a Schema Builder save of both collections applies. */
function desiredFor(
  pair: Pair,
  authors: unknown[],
  posts: unknown[]
): DesiredSchema {
  return {
    collections: {
      authors: {
        slug: pair.authorsSlug,
        tableName: pair.authors,
        fields: authors as never,
        builderOwned: true,
      },
      posts: {
        slug: `${pair.authorsSlug}_posts`,
        tableName: pair.posts,
        fields: posts as never,
        builderOwned: true,
      },
    },
    singles: {},
    components: {},
  };
}

/** One Schema Builder save, as the Builder's save applies it. */
function save(target: Target, desired: DesiredSchema) {
  return new PushSchemaPipeline({
    executor: new DrizzleStatementExecutor(target.dialect, target.db),
    renameDetector: noopRenameDetector,
    classifier: noopClassifier,
    promptDispatcher: noopPromptDispatcher,
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

/** The posts table's keys, as the diff reads them. */
async function postKeys(target: Target, pair: Pair) {
  const live = await introspectLiveSnapshot(target.db, target.dialect, [
    pair.posts,
  ]);
  return (live.tables[0]?.foreignKeys ?? []).map(fk => ({
    columns: fk.columns,
    referencesTable: fk.referencesTable,
    onDelete: fk.onDelete,
  }));
}

const keyTo = (pair: Pair) => ({
  columns: ["lead_author"],
  referencesTable: pair.authors,
  onDelete: "cascade",
});

describe("a Schema Builder collection's foreign keys (sqlite)", () => {
  const pair = pairNamed("bfk");
  let sqlite: Database.Database;
  let target: Target;

  beforeEach(async () => {
    clearCachedSnapshot();
    sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");
    const db = drizzleSqlite({ client: sqlite });
    target = { db, dialect: "sqlite" };
    await freshPushSchema("sqlite", db, getDialectTables("sqlite"));
  });
  afterEach(() => {
    clearCachedSnapshot();
    sqlite.close();
  });

  function createTables(postsBornWithAuthor: boolean) {
    for (const statement of [
      ...builderStatements("sqlite", pair.authors, authorFields("text")),
      ...builderStatements(
        "sqlite",
        pair.posts,
        postFields(pair, "text", postsBornWithAuthor)
      ),
    ]) {
      sqlite.exec(statement);
    }
  }

  function seed() {
    sqlite
      .prepare(
        `INSERT INTO "${pair.authors}" (id, title, slug, name, rank) VALUES ('a1', 'A', 'a', 'Ada', '1')`
      )
      .run();
    sqlite
      .prepare(
        `INSERT INTO "${pair.posts}" (id, title, slug, score, lead_author) VALUES ('p1', 'P', 'p', '5', 'a1')`
      )
      .run();
  }

  const columnType = (table: string, column: string) =>
    (
      sqlite
        .prepare(`SELECT name, type FROM pragma_table_info(?)`)
        .all(table) as Array<{
        name: string;
        type: string;
      }>
    )
      .find(row => row.name === column)
      ?.type.toLowerCase();

  it("gets the key of a relationship added to it after it was created", async () => {
    createTables(false);
    expect(await postKeys(target, pair)).toEqual([]);

    const result = await save(
      target,
      desiredFor(pair, authorFields("text"), postFields(pair, "text"))
    );

    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
    expect(await postKeys(target, pair)).toEqual([keyTo(pair)]);
  });

  it("keeps a child's rows and key when a type change rebuilds the parent", async () => {
    createTables(true);
    seed();
    expect(await postKeys(target, pair)).toEqual([keyTo(pair)]);

    const result = await save(
      target,
      desiredFor(pair, authorFields("number"), postFields(pair, "text"))
    );

    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
    // The rebuild ran: SQLite changes a column's type only by rebuilding.
    expect(columnType(pair.authors, "rank")).not.toBe("text");
    // No delete action fired: the child row survived the parent's rebuild.
    expect(
      sqlite.prepare(`SELECT id, lead_author FROM "${pair.posts}"`).all()
    ).toEqual([{ id: "p1", lead_author: "a1" }]);
    expect(await postKeys(target, pair)).toEqual([keyTo(pair)]);
    expect(sqlite.prepare(`PRAGMA foreign_key_check`).all()).toEqual([]);
  });

  it("keeps a table's own key when a type change rebuilds it", async () => {
    createTables(true);
    seed();

    const result = await save(
      target,
      desiredFor(pair, authorFields("text"), postFields(pair, "number"))
    );

    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
    expect(columnType(pair.posts, "score")).not.toBe("text");
    expect(await postKeys(target, pair)).toEqual([keyTo(pair)]);
    expect(sqlite.prepare(`SELECT id FROM "${pair.posts}"`).all()).toEqual([
      { id: "p1" },
    ]);
    // The key is enforced, not merely listed: a post naming no author is
    // refused, and deleting the author still cascades.
    expect(() =>
      sqlite
        .prepare(
          `INSERT INTO "${pair.posts}" (id, title, slug, score, lead_author) VALUES ('p2', 'Q', 'q', 1, 'nobody')`
        )
        .run()
    ).toThrow(/FOREIGN KEY/);
    sqlite.prepare(`DELETE FROM "${pair.authors}" WHERE id = 'a1'`).run();
    expect(sqlite.prepare(`SELECT id FROM "${pair.posts}"`).all()).toEqual([]);
  });
});

/**
 * The same added relationship on the server dialects, which take a key with a
 * statement of its own; and the next preview plans nothing for it, so the key
 * the save created is the key the diff expects.
 */
const SERVERS: Array<{
  dialect: "postgresql" | "mysql";
  open: (url: string) => {
    target: Target;
    run: (sql: string) => Promise<unknown>;
    close: () => Promise<void>;
  };
}> = [
  {
    dialect: "postgresql",
    open: url => {
      const pool = new Pool({ connectionString: url });
      return {
        target: { db: drizzlePg({ client: pool }), dialect: "postgresql" },
        run: statement => pool.query(statement),
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
        run: statement => pool.promise().query(statement),
        close: () => new Promise<void>(done => pool.end(() => done())),
      };
    },
  },
];

for (const server of SERVERS) {
  const context = makeTestContext(server.dialect);
  describe.skipIf(!context.url)(
    `a Schema Builder collection's foreign keys (${server.dialect})`,
    () => {
      const pair = pairNamed(`${context.prefix}_bfk`);
      const quote = (name: string) =>
        server.dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
      let connection: ReturnType<(typeof server)["open"]>;

      const dropTables = async () => {
        await connection.run(`DROP TABLE IF EXISTS ${quote(pair.posts)}`);
        await connection.run(`DROP TABLE IF EXISTS ${quote(pair.authors)}`);
      };

      beforeAll(async () => {
        connection = server.open(context.url ?? "");
        await dropTables();
      });
      beforeEach(() => {
        clearCachedSnapshot();
      });
      afterAll(async () => {
        await dropTables();
        await connection.close();
        clearCachedSnapshot();
      });

      it("gets the key of a relationship added to it after it was created", async () => {
        for (const statement of [
          ...builderStatements(
            server.dialect,
            pair.authors,
            authorFields("text")
          ),
          ...builderStatements(
            server.dialect,
            pair.posts,
            postFields(pair, "text", false)
          ),
        ]) {
          await connection.run(statement);
        }
        expect(await postKeys(connection.target, pair)).toEqual([]);

        const desired = desiredFor(
          pair,
          authorFields("text"),
          postFields(pair, "text")
        );
        const result = await save(connection.target, desired);

        expect(result.error).toBeUndefined();
        expect(result.success).toBe(true);
        expect(await postKeys(connection.target, pair)).toEqual([keyTo(pair)]);
        // Enforced: a post naming no author is refused.
        await expect(
          connection.run(
            `INSERT INTO ${quote(pair.posts)} (id, title, slug, score, lead_author) VALUES ('p2', 'Q', 'q', '1', 'nobody')`
          )
        ).rejects.toThrow();
        // And the next diff expects exactly that key.
        const preview = await previewDesiredSchema({
          desired,
          db: connection.target.db,
          dialect: server.dialect,
        });
        expect(
          preview.operations.filter(op => op.type.endsWith("foreign_key"))
        ).toEqual([]);
      });
    }
  );
}
