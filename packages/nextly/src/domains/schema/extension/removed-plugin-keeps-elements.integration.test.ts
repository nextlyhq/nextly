/**
 * What a plugin added to a collection's table outlives the plugin's removal
 * from the configuration, through a development push, on every configured
 * dialect: its column with its values, and its index. A plugin that is still
 * configured and stops declaring one of its elements has that one removed.
 *
 * The boot is the code under test, so the same database is booted twice:
 * with the plugins, then without one of them. On PostgreSQL and MySQL the
 * database is created here rather than by the harness, because the harness
 * drops the database it provisioned when the next instance boots. SQLite's
 * in-memory database survives the restart on the adapter it is handed.
 */
import { randomBytes } from "node:crypto";

import { afterEach, expect, it } from "vitest";

import { defineCollection, text } from "../../../config";
import { createAdapter } from "../../../database/factory";
import {
  createDatabaseStatement,
  dropDatabaseStatement,
} from "../../../database/test-database-ddl";
import { clearServices } from "../../../di/register";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import { definePlugin } from "../../../plugins/plugin-context";
import {
  createTestNextly,
  type CreateTestNextlyOptions,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { _resetEnvCache } from "../../../shared/lib/env";
import { SchemaOwnersRepository } from "../ownership/schema-owners-repository";
import { applyDesiredSchema } from "../pipeline/index";

import { col } from "./dsl";

const POSTS = "dc_ke_posts";
const NOTES = "dc_ke_notes";

/** Adds a column and an index on it to the posts table, then is removed. */
const removed = definePlugin({
  name: "kept-elements-removed",
  version: "0.0.0",
  nextly: "*",
  contributes: {
    schema: {
      extend: [
        ({ schema }) => {
          schema.extendTable(POSTS, {
            columns: { stamp: col.shortText({ nullable: true }) },
            indexes: [{ columns: ["stamp"] }],
          });
        },
      ],
    },
  },
});

/**
 * Stays configured. Its first version adds a column and an index on it; its
 * second keeps the column and stops declaring the index.
 */
const staying = (withIndex: boolean) =>
  definePlugin({
    name: "kept-elements-staying",
    version: "0.0.0",
    nextly: "*",
    contributes: {
      schema: {
        extend: [
          ({ schema }) => {
            schema.extendTable(POSTS, {
              columns: { mark: col.shortText({ nullable: true }) },
              ...(withIndex ? { indexes: [{ columns: ["mark"] }] } : {}),
            });
          },
        ],
      },
    },
  });

/**
 * The app's two collections, each field required at the first boot and
 * optional when a test changes it: a change only a real schema apply makes,
 * which on MySQL and SQLite reaches drizzle-kit's whole-database apply.
 */
const posts = (required: boolean) =>
  defineCollection({
    slug: "ke_posts",
    fields: [text({ name: "headline", required })],
  });
const notes = (required: boolean) =>
  defineCollection({
    slug: "ke_notes",
    fields: [text({ name: "body", required })],
  });

type Adapter = TestNextly["adapter"];

const ROW = "018f2c2e-0000-7000-8000-00000000b001";

let handle: TestNextly | undefined;
let cleanup: (() => Promise<void>) | undefined;

afterEach(async () => {
  await handle?.destroy();
  handle = undefined;
  await cleanup?.();
  cleanup = undefined;
});

/**
 * The first boot, with both plugins, on a database the restart will find: the
 * harness's own for SQLite, one created here for a server dialect.
 */
async function firstBoot(dialect: TestDialect): Promise<Adapter> {
  const options = {
    plugins: [removed, staying(true)],
    collections: [posts(true), notes(true)],
  };
  if (dialect === "sqlite") {
    handle = await createTestNextly({ dialect, ...options });
    return handle.adapter;
  }
  const serverUrl =
    process.env[
      dialect === "postgresql" ? "TEST_POSTGRES_URL" : "TEST_MYSQL_URL"
    ];
  if (serverUrl === undefined) throw new Error(`no URL for ${dialect}`);
  const server = await createAdapter({ type: dialect, url: serverUrl });
  const name = `nextly_t_${randomBytes(12).toString("hex")}`;
  const databaseUrl = new URL(serverUrl);
  databaseUrl.pathname = `/${name}`;
  const previousUrl = process.env.DATABASE_URL;
  const previousDialect = process.env.DB_DIALECT;
  await server.executeQuery(createDatabaseStatement(dialect, name));
  cleanup = async () => {
    await server.executeQuery(dropDatabaseStatement(dialect, name));
    await server.disconnect();
    if (previousUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousUrl;
    if (previousDialect === undefined) delete process.env.DB_DIALECT;
    else process.env.DB_DIALECT = previousDialect;
    _resetEnvCache();
  };
  process.env.DATABASE_URL = databaseUrl.toString();
  process.env.DB_DIALECT = dialect;
  _resetEnvCache();
  const adapter = await createAdapter({
    type: dialect,
    url: databaseUrl.toString(),
  });
  handle = await createTestNextly({ adapter, ...options });
  return adapter;
}

/** Restart on the same database with `plugins`, then push the collections. */
async function restartAndPush(
  adapter: Adapter,
  plugins: CreateTestNextlyOptions["plugins"],
  postsRequired: boolean,
  notesRequired: boolean
) {
  // Not destroyed first: that would disconnect the adapter the restart
  // boots on, and SQLite's in-memory database with it.
  clearServices();
  handle = await createTestNextly({
    adapter,
    plugins,
    collections: [posts(true), notes(true)],
  });
  return applyDesiredSchema(
    {
      collections: {
        ke_posts: {
          slug: "ke_posts",
          tableName: POSTS,
          fields: posts(postsRequired).fields,
        },
        ke_notes: {
          slug: "ke_notes",
          tableName: NOTES,
          fields: notes(notesRequired).fields,
        },
      },
      singles: {},
      components: {},
    },
    "code",
    { promptChannel: "terminal" }
  );
}

/** The live column names of a table. */
async function columnsOf(
  adapter: Adapter,
  dialect: TestDialect,
  table: string
): Promise<string[]> {
  if (dialect === "sqlite") {
    const rows = await adapter.executeQuery<{ name: string }>(
      `PRAGMA table_info("${table}")`
    );
    return rows.map(row => row.name);
  }
  const rows = await adapter.executeQuery<Record<string, unknown>>(
    `SELECT column_name AS c FROM information_schema.columns
      WHERE table_name = '${table}'
        AND table_schema = ${dialect === "mysql" ? "DATABASE()" : "current_schema()"}`
  );
  return rows.map(row => String(row.c ?? row.C));
}

/** The live index names of a table, lower-cased. */
async function indexesOf(
  adapter: Adapter,
  dialect: TestDialect,
  table: string
): Promise<string[]> {
  const rows = await adapter.executeQuery<Record<string, unknown>>(
    dialect === "postgresql"
      ? `SELECT indexname AS n FROM pg_indexes WHERE tablename = '${table}'`
      : dialect === "mysql"
        ? `SELECT DISTINCT index_name AS n FROM information_schema.statistics WHERE table_name = '${table}' AND table_schema = DATABASE()`
        : `SELECT name AS n FROM sqlite_master WHERE type = 'index' AND tbl_name = '${table}'`
  );
  return rows.map(row => String(row.n ?? row.N).toLowerCase());
}

/** Whether a column is NOT NULL, read from the database. */
async function isNotNull(
  adapter: Adapter,
  dialect: TestDialect,
  table: string,
  column: string
): Promise<boolean> {
  if (dialect === "sqlite") {
    const rows = await adapter.executeQuery<{ name: string; notnull: number }>(
      `PRAGMA table_info("${table}")`
    );
    return Number(rows.find(row => row.name === column)?.notnull) === 1;
  }
  const rows = await adapter.executeQuery<Record<string, unknown>>(
    `SELECT is_nullable AS nullable FROM information_schema.columns
      WHERE table_name = '${table}' AND column_name = '${column}'
        AND table_schema = ${dialect === "mysql" ? "DATABASE()" : "current_schema()"}`
  );
  const value = rows[0]?.nullable ?? rows[0]?.NULLABLE;
  return String(value).toUpperCase() === "NO";
}

/** The stamp the removed plugin's column holds for the test row. */
async function stampOf(adapter: Adapter): Promise<string[]> {
  const rows = await adapter.executeQuery<{ stamp: string }>(
    `SELECT stamp FROM ${POSTS} WHERE id = '${ROW}'`
  );
  return rows.map(row => row.stamp);
}

/** The test row, its value in the removed plugin's column set. */
function insertPost(dialect: TestDialect): string {
  const now = dialect === "postgresql" ? "now()" : "CURRENT_TIMESTAMP";
  return `INSERT INTO ${POSTS} (id, title, slug, headline, stamp, created_at, updated_at) VALUES ('${ROW}', 't', 's', 'h', 'kept', ${now}, ${now})`;
}

describeEachDialect("a plugin removed from the configuration", dialect => {
  it("keeps the column and index it added to a collection's table through a push", async () => {
    const adapter = await firstBoot(dialect);
    await adapter.executeQuery(
      insertPost(dialect)
    );
    // The premise: the first boot's push made both, and recorded whose they
    // are.
    expect(await columnsOf(adapter, dialect, POSTS)).toContain("stamp");
    const stampIndex = (await indexesOf(adapter, dialect, POSTS)).find(name =>
      name.includes("stamp")
    );
    expect(stampIndex).toBeDefined();
    const rows = await new SchemaOwnersRepository(
      adapter.getDrizzle(),
      dialect
    ).read([POSTS]);
    expect(
      rows
        .filter(row => row.ownerId === "kept-elements-removed")
        .map(row => `${row.elementKind}:${row.elementName}`)
        .sort()
    ).toEqual(["column:stamp", `index:${stampIndex}`].sort());

    // A push that changes another table, without the plugin.
    const pushed = await restartAndPush(adapter, [staying(true)], true, false);
    expect(pushed.success, JSON.stringify(pushed)).toBe(true);
    // It reached a real apply, not the shortcut for no change.
    expect(await isNotNull(adapter, dialect, NOTES, "body")).toBe(false);

    expect(await columnsOf(adapter, dialect, POSTS)).toContain("stamp");
    expect(await stampOf(adapter)).toEqual(["kept"]);
    expect(await indexesOf(adapter, dialect, POSTS)).toContain(stampIndex);
  });

  it("keeps them through a change to the table they are on, or refuses it on SQLite", async () => {
    const adapter = await firstBoot(dialect);
    await adapter.executeQuery(
      insertPost(dialect)
    );

    const pushed = await restartAndPush(adapter, [staying(true)], false, true);
    if (dialect === "sqlite") {
      // SQLite makes the change by rebuilding the table from a definition
      // that no longer has the column, so the push is refused, naming the
      // plugin and the column, before anything runs.
      const message = pushed.success ? "" : pushed.error.message;
      expect(message).toContain('the plugin "kept-elements-removed" added');
      expect(message).toContain('the column "stamp"');
      expect(await isNotNull(adapter, dialect, POSTS, "headline")).toBe(true);
    } else {
      expect(pushed.success, JSON.stringify(pushed)).toBe(true);
      expect(await isNotNull(adapter, dialect, POSTS, "headline")).toBe(false);
    }
    expect(await columnsOf(adapter, dialect, POSTS)).toContain("stamp");
    expect(await stampOf(adapter)).toEqual(["kept"]);
    expect(
      (await indexesOf(adapter, dialect, POSTS)).some(name =>
        name.includes("stamp")
      )
    ).toBe(true);
  });
});

describeEachDialect("a plugin still configured", dialect => {
  it("has the index it stops declaring removed, and nothing else", async () => {
    const adapter = await firstBoot(dialect);
    expect(
      (await indexesOf(adapter, dialect, POSTS)).some(name =>
        name.includes("mark")
      )
    ).toBe(true);

    const pushed = await restartAndPush(
      adapter,
      [removed, staying(false)],
      true,
      false
    );
    expect(pushed.success, JSON.stringify(pushed)).toBe(true);
    const indexes = await indexesOf(adapter, dialect, POSTS);
    expect(indexes.some(name => name.includes("mark"))).toBe(false);
    expect(indexes.some(name => name.includes("stamp"))).toBe(true);
    expect(await columnsOf(adapter, dialect, POSTS)).toContain("mark");
  });
});
