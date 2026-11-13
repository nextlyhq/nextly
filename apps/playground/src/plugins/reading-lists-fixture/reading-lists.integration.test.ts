/**
 * The reading-lists fixture plugin through its whole life on a site, with the
 * commands a deployment runs, on each dialect.
 *
 * A scratch site configures a `posts` collection and the plugin, and runs the
 * real `nextly` command against a database made for this file: the app's
 * migration is generated, then `migrate`, `plugins install` and
 * `plugins uninstall`, each way, run in the order a site meets them. After each
 * command the test reads the database's own catalog and the records Nextly
 * keeps, and boots the site in production over it, so every step is checked
 * against what the plugin and production-migration docs say it does, not
 * against what the command prints. Between commands the booted site uses the
 * plugin as its code does: lists and items through `ctx.db`, the `items`
 * relation, and the hidden `savedCount` through `ctx.db.contributed`.
 *
 * Which dialects run: PostgreSQL when TEST_POSTGRES_URL is set, MySQL when
 * TEST_MYSQL_URL is set, and SQLite, on a file, when neither is, which is how
 * the integration legs divide the dialects between them. Each server dialect
 * gets a database of its own, created here and dropped at the end, so nothing
 * another suite wrote can answer for this one.
 */
import { execFile } from "node:child_process";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import Sqlite from "better-sqlite3";
import mysql from "mysql2/promise";
import pg from "pg";

import {
  NextlyError,
  type PluginContext,
  type PluginDefinition,
} from "@nextlyhq/plugin-sdk";
import { createTestNextly } from "@nextlyhq/plugin-sdk/testing";
import { defineCollection, text } from "nextly/config";
import { createAdapter } from "nextly/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createList,
  readList,
  removePost,
  savedCount,
  savePost,
} from "./lists";
import { READING_LISTS_PLUGIN, readingListsFixturePlugin } from "./plugin";

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const playground = resolve(here, "../../..");

type Dialect = "sqlite" | "postgresql" | "mysql";

/** The plugin's own tables, as the database names them. */
const OWN_TABLES = ["reading__list_items", "reading__lists"];

/** The posts collection the site declares, and the plugin adds a column to. */
const Posts = defineCollection({
  slug: "posts",
  fields: [
    text({ name: "title", required: true }),
    text({ name: "slug", required: true, unique: true }),
  ],
});

/** The dialects this run has a database for; see the file's header. */
function dialects(): Dialect[] {
  const servers: Dialect[] = [];
  if (process.env.TEST_POSTGRES_URL) servers.push("postgresql");
  if (process.env.TEST_MYSQL_URL) servers.push("mysql");
  return servers.length > 0 ? servers : ["sqlite"];
}

/**
 * A database made for this file, with the few reads the steps make of it,
 * each on a connection of its own so none is held while a command runs.
 */
interface Database {
  url: string;
  rows(sql: string): Promise<Record<string, unknown>[]>;
  tables(): Promise<string[]>;
  columns(table: string): Promise<string[]>;
  drop(): Promise<void>;
}

/** The server URL with its database name replaced. */
function withDatabase(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

async function makeDatabase(
  dialect: Dialect,
  scratch: string
): Promise<Database> {
  if (dialect === "sqlite") {
    const file = join(scratch, "site.sqlite");
    const rows = async (sql: string) => {
      const db = new Sqlite(file);
      try {
        const statement = db.prepare(sql);
        // A statement that returns no rows (an UPDATE) is run, not read.
        if (!statement.reader) {
          statement.run();
          return [];
        }
        return statement.all() as Record<string, unknown>[];
      } finally {
        db.close();
      }
    };
    return {
      url: `file:${file}`,
      rows,
      tables: async () =>
        (await rows("SELECT name FROM sqlite_master WHERE type = 'table'")).map(
          row => String(row.name)
        ),
      columns: async table =>
        (await rows(`PRAGMA table_info("${table}")`)).map(row =>
          String(row.name)
        ),
      drop: async () => {},
    };
  }

  const server =
    dialect === "postgresql"
      ? process.env.TEST_POSTGRES_URL!
      : process.env.TEST_MYSQL_URL!;
  const base = new URL(server).pathname.slice(1) || "nextly_test";
  const name = `${base}_reading_lists`.slice(0, 63);
  const url = withDatabase(server, name);

  if (dialect === "postgresql") {
    const admin = async (sql: string) => {
      const client = new pg.Client({ connectionString: server });
      await client.connect();
      try {
        await client.query(sql);
      } finally {
        await client.end();
      }
    };
    await admin(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin(`CREATE DATABASE "${name}"`);
    const rows = async (sql: string) => {
      const client = new pg.Client({ connectionString: url });
      await client.connect();
      try {
        return (await client.query(sql)).rows as Record<string, unknown>[];
      } finally {
        await client.end();
      }
    };
    return {
      url,
      rows,
      tables: async () =>
        (
          await rows(
            "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = 'public'"
          )
        ).map(row => String(row.name)),
      columns: async table =>
        (
          await rows(
            `SELECT column_name AS name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '${table}'`
          )
        ).map(row => String(row.name)),
      drop: () => admin(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`),
    };
  }

  const admin = async (sql: string) => {
    const connection = await mysql.createConnection(server);
    try {
      await connection.query(sql);
    } finally {
      await connection.end();
    }
  };
  await admin(`DROP DATABASE IF EXISTS \`${name}\``);
  await admin(`CREATE DATABASE \`${name}\``);
  const rows = async (sql: string) => {
    const connection = await mysql.createConnection(url);
    try {
      const [result] = await connection.query(sql);
      return result as Record<string, unknown>[];
    } finally {
      await connection.end();
    }
  };
  return {
    url,
    rows,
    tables: async () =>
      (
        await rows(
          "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE()"
        )
      ).map(row => String(row.name)),
    columns: async table =>
      (
        await rows(
          `SELECT column_name AS name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = '${table}'`
        )
      ).map(row => String(row.name)),
    drop: () => admin(`DROP DATABASE IF EXISTS \`${name}\``),
  };
}

/** What a command ended with, failure included, so a step can assert either. */
interface Outcome {
  code: number;
  output: string;
}

/**
 * A scratch site whose config imports the fixture plugin from this folder,
 * linked to the playground's dependencies, and the `nextly` command run in it.
 */
function makeSite(scratch: string, databaseUrl: string) {
  symlinkSync(join(playground, "node_modules"), join(scratch, "node_modules"));
  const writeConfig = (withPlugin: boolean) =>
    writeFileSync(
      join(scratch, "nextly.config.ts"),
      [
        'import { defineCollection, defineConfig, text } from "nextly/config";',
        `import { readingListsFixturePlugin } from ${JSON.stringify(join(here, "plugin.ts"))};`,
        "const Posts = defineCollection({",
        '  slug: "posts",',
        "  fields: [",
        '    text({ name: "title", required: true }),',
        '    text({ name: "slug", required: true, unique: true }),',
        "  ],",
        "});",
        `export default defineConfig({ collections: [Posts], plugins: [${withPlugin ? "readingListsFixturePlugin" : ""}] });`,
        "",
      ].join("\n")
    );
  writeConfig(true);
  // This process's environment, pointed at the scratch site's database and
  // out of vitest's `test` mode: the commands run as a developer's do, and
  // the dialect is read from the URL.
  const environment: NodeJS.ProcessEnv = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(([key]) => key !== "DB_DIALECT")
    ),
    NODE_ENV: "development",
    DATABASE_URL: databaseUrl,
  };
  return {
    writeConfig,
    migrationsDir: join(scratch, "src/db/migrations"),
    nextly: (...args: string[]): Promise<Outcome> =>
      run(join(playground, "node_modules/.bin/nextly"), args, {
        cwd: scratch,
        env: environment,
        timeout: 150_000,
        maxBuffer: 32 * 1024 * 1024,
      }).then(
        ({ stdout, stderr }) => ({ code: 0, output: `${stdout}\n${stderr}` }),
        (error: { code?: number; stdout?: string; stderr?: string }) => ({
          code: typeof error.code === "number" ? error.code : -1,
          output: `${error.stdout ?? ""}\n${error.stderr ?? ""}`,
        })
      ),
  };
}

/** The error code a refusal carries, or `undefined` for a boot that started. */
function codeOf(failure: unknown): string | undefined {
  if (failure === undefined) return undefined;
  if (NextlyError.is(failure)) return failure.code;
  return failure instanceof Error ? failure.message : JSON.stringify(failure);
}

describe.each(dialects())("the reading-lists fixture on %s", dialect => {
  let scratch: string;
  let db: Database;
  let site: ReturnType<typeof makeSite>;
  /** The post the booted site saves, by id, once the install step made it. */
  let postId: string;

  beforeAll(async () => {
    scratch = mkdtempSync(join(tmpdir(), "reading-lists-"));
    db = await makeDatabase(dialect, scratch);
    site = makeSite(scratch, db.url);
  });

  afterAll(async () => {
    await db?.drop();
    if (scratch) rmSync(scratch, { recursive: true, force: true });
  });

  /**
   * Boot the site in production over the database, as a deployment's start
   * does, with the plugin's context handed to `steps`. Resolves to the error
   * the boot stopped with, or `undefined` once `steps` have run.
   */
  async function boot(
    steps?: (
      ctx: PluginContext,
      nextly: Awaited<ReturnType<typeof createTestNextly>>
    ) => Promise<void>,
    plugins: PluginDefinition[] = [readingListsFixturePlugin]
  ): Promise<unknown> {
    // A throwaway secret for these boots alone, never a real one.
    const production: Record<string, string> = {
      NODE_ENV: "production",
      NEXTLY_SECRET: "test-only-secret-for-the-reading-lists-boot-0123456789",
      NEXT_PUBLIC_APP_URL: "http://localhost",
      DATABASE_URL: db.url,
    };
    const previous = Object.fromEntries(
      Object.keys(production).map(key => [key, process.env[key]])
    );
    Object.assign(process.env, production);
    let context: PluginContext | undefined;
    const withContext = plugins.map(plugin =>
      plugin.name === READING_LISTS_PLUGIN
        ? {
            ...plugin,
            init: async (ctx: PluginContext) => {
              context = ctx;
              await plugin.init?.(ctx);
            },
          }
        : plugin
    );
    try {
      const adapter = await createAdapter({ type: dialect, url: db.url });
      const booted = await createTestNextly({
        adapter,
        collections: [Posts],
        plugins: withContext,
      });
      try {
        if (steps) {
          // A boot that never initialised the plugin would skip every check
          // `steps` make, so that is a failure of its own.
          if (context === undefined) {
            throw new Error("The plugin was not initialised by the boot.");
          }
          await steps(context, booted);
        }
      } finally {
        await booted.destroy();
      }
      return undefined;
    } catch (error) {
      return error;
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  }

  /** How many rows a count query finds. */
  async function count(sql: string): Promise<number> {
    const [row] = await db.rows(sql);
    return Number(row?.n ?? 0);
  }

  const ownerRows = () =>
    count(
      `SELECT COUNT(*) AS n FROM nextly_schema_owners WHERE owner_id = '${READING_LISTS_PLUGIN}'`
    );
  const moduleRows = () =>
    count(
      `SELECT COUNT(*) AS n FROM nextly_schema_events WHERE event_type = 'file_apply' AND filename LIKE 'plugin:${READING_LISTS_PLUGIN}/%'`
    );
  const lifecycleEvents = () =>
    count(
      `SELECT COUNT(*) AS n FROM nextly_schema_events WHERE event_type = 'plugin_lifecycle' AND filename = 'plugin-lifecycle:${READING_LISTS_PLUGIN}'`
    );
  const ownTables = async () =>
    (await db.tables()).filter(name => OWN_TABLES.includes(name)).sort();
  const savedCountStored = async () => {
    const [row] = await db.rows(
      `SELECT saved_count AS n FROM dc_posts WHERE id = '${postId}'`
    );
    return row === undefined ? undefined : Number(row.n);
  };

  it("generates the app's migration with the hidden column, and none of the plugin's tables", async () => {
    const outcome = await site.nextly(
      "migrate:create",
      "--name",
      "init",
      "--non-interactive"
    );
    expect(outcome.code, outcome.output).toBe(0);

    const files = readdirSync(site.migrationsDir).filter(name =>
      name.endsWith(".sql")
    );
    expect(files).toHaveLength(1);
    const sql = readFileSync(join(site.migrationsDir, files[0]), "utf8");
    // A plugin's addition to a collection's table travels with the app's
    // migrations, and its own tables with its own modules.
    expect(sql).toMatch(/saved_count/);
    expect(sql).toMatch(/dc_posts_saved_count/);
    expect(sql).not.toMatch(/reading__/);
  });

  it("migrate applies the plugin's module and the app's migration, but does not install the plugin", async () => {
    const outcome = await site.nextly("migrate");
    expect(outcome.code, outcome.output).toBe(0);

    expect(await ownTables()).toEqual(OWN_TABLES);
    expect(await db.columns("dc_posts")).toContain("saved_count");
    expect(await moduleRows()).toBe(1);
    expect(await lifecycleEvents()).toBe(0);
    expect(codeOf(await boot())).toBe("PLUGIN_NOT_INSTALLED");
  });

  it("install records the plugin, and the site then boots and uses its tables", async () => {
    const outcome = await site.nextly(
      "plugins",
      "install",
      READING_LISTS_PLUGIN
    );
    expect(outcome.code, outcome.output).toBe(0);
    expect(await ownerRows()).toBe(OWN_TABLES.length);
    expect(await lifecycleEvents()).toBe(1);

    const failure = await boot(async (ctx, t) => {
      const user = await t.nextly.users.create({
        email: "reader@example.com",
        password: "Password123!",
        data: { name: "Reader", isActive: true },
      });
      const post = await t.nextly.create({
        collection: "posts",
        data: { title: "Saved", slug: "saved" },
      });
      postId = String(post.item.id);

      const list = await createList(ctx.db, user.item.id, "Weekend");
      await savePost(ctx.db, list.id, postId);

      // The relation reads the list with its item in one query.
      const read = await readList(ctx.db, list.id);
      expect(read?.items.map(item => item.postId)).toEqual([postId]);
      // The hidden column holds the count, and no entry read shows it.
      expect(await savedCount(ctx.db, postId)).toBe(1);
      const entry = (await t.nextly.findByID({
        collection: "posts",
        id: postId,
      })) as Record<string, unknown>;
      // The read is the post itself, so the absence below is about the column.
      expect(entry.title).toBe("Saved");
      expect(entry).not.toHaveProperty("savedCount");
      expect(entry).not.toHaveProperty("saved_count");
      // The table's unique index refuses the same post twice on a list.
      await expect(savePost(ctx.db, list.id, postId)).rejects.toThrow();
      // Taking it off recounts the post, and saving it again counts it back.
      await removePost(ctx.db, list.id, postId);
      expect(await savedCount(ctx.db, postId)).toBe(0);
      expect((await readList(ctx.db, list.id))?.items).toEqual([]);
      await savePost(ctx.db, list.id, postId);
      expect(await savedCount(ctx.db, postId)).toBe(1);
    });
    expect(codeOf(failure)).toBeUndefined();
    expect(await savedCountStored()).toBe(1);
  });

  it("an install run again changes nothing and records no second install", async () => {
    const outcome = await site.nextly(
      "plugins",
      "install",
      READING_LISTS_PLUGIN
    );
    expect(outcome.code, outcome.output).toBe(0);
    expect(await lifecycleEvents()).toBe(1);
    expect(await moduleRows()).toBe(1);
  });

  it("a full uninstall without consent is refused and changes nothing", async () => {
    const outcome = await site.nextly(
      "plugins",
      "uninstall",
      READING_LISTS_PLUGIN
    );
    expect(outcome.code).not.toBe(0);
    expect(outcome.output).toContain("PLUGIN_UNINSTALL_UNCONFIRMED");
    expect(await ownTables()).toEqual(OWN_TABLES);
    expect(await count("SELECT COUNT(*) AS n FROM reading__list_items")).toBe(
      1
    );
  });

  it("uninstall --keep-data keeps the tables, their rows and the hidden column's values", async () => {
    const outcome = await site.nextly(
      "plugins",
      "uninstall",
      READING_LISTS_PLUGIN,
      "--keep-data"
    );
    expect(outcome.code, outcome.output).toBe(0);
    expect(await ownTables()).toEqual(OWN_TABLES);
    expect(await count("SELECT COUNT(*) AS n FROM reading__list_items")).toBe(
      1
    );
    expect(await savedCountStored()).toBe(1);
    expect(await moduleRows()).toBe(1);
    // Still in the config, so a start refuses it until it is installed again
    // or removed.
    expect(codeOf(await boot())).toBe("PLUGIN_SCHEMA_UNINSTALLED");
  });

  it("an install after it is a full install: onInstall runs and finds the kept rows", async () => {
    // Put the count out of step while the plugin is uninstalled, so only the
    // install hook's recount can bring it back.
    await db.rows(`UPDATE dc_posts SET saved_count = 0 WHERE id = '${postId}'`);
    expect(await savedCountStored()).toBe(0);

    const outcome = await site.nextly(
      "plugins",
      "install",
      READING_LISTS_PLUGIN
    );
    expect(outcome.code, outcome.output).toBe(0);
    expect(await savedCountStored()).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM reading__list_items")).toBe(
      1
    );
    expect(codeOf(await boot())).toBeUndefined();
  });

  it("a full uninstall with consent drops the tables and forgets the plugin, and leaves the app's column", async () => {
    const outcome = await site.nextly(
      "plugins",
      "uninstall",
      READING_LISTS_PLUGIN,
      `--accept-data-loss=${OWN_TABLES.join(",")}`
    );
    expect(outcome.code, outcome.output).toBe(0);
    expect(await ownTables()).toEqual([]);
    expect(await ownerRows()).toBe(0);
    expect(await moduleRows()).toBe(0);
    // The hidden column came with the app's migration, so it stays until the
    // app's own migrations remove it.
    expect(await db.columns("dc_posts")).toContain("saved_count");
    // Its items went with the tables, so the uninstall hook has set the count
    // they made to none rather than leave it naming lists that are gone.
    expect(await savedCountStored()).toBe(0);
    expect(codeOf(await boot())).toBe("PLUGIN_SCHEMA_UNINSTALLED");
  });

  it("an install after a full uninstall creates the tables again from the first module", async () => {
    const outcome = await site.nextly(
      "plugins",
      "install",
      READING_LISTS_PLUGIN
    );
    expect(outcome.code, outcome.output).toBe(0);
    expect(await ownTables()).toEqual(OWN_TABLES);
    expect(await moduleRows()).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM reading__list_items")).toBe(
      0
    );
    // A fresh install finds no items, and the post counts none.
    expect(await savedCountStored()).toBe(0);

    const failure = await boot(async ctx => {
      const [owner] = await db.rows("SELECT id FROM users");
      const list = await createList(ctx.db, String(owner?.id), "Again");
      await savePost(ctx.db, list.id, postId);
      expect((await readList(ctx.db, list.id))?.items).toHaveLength(1);
    });
    expect(codeOf(failure)).toBeUndefined();
  });

  it("once the plugin is uninstalled and removed, the app's next migration drops its column", async () => {
    const uninstall = await site.nextly(
      "plugins",
      "uninstall",
      READING_LISTS_PLUGIN,
      `--accept-data-loss=${OWN_TABLES.join(",")}`
    );
    expect(uninstall.code, uninstall.output).toBe(0);
    site.writeConfig(false);

    const create = await site.nextly(
      "migrate:create",
      "--name",
      "remove_reading_lists",
      "--non-interactive",
      "--accept-data-loss=dc_posts.saved_count"
    );
    expect(create.code, create.output).toBe(0);
    const migrate = await site.nextly(
      "migrate",
      "--accept-data-loss=dc_posts.saved_count"
    );
    expect(migrate.code, migrate.output).toBe(0);
    expect(await db.columns("dc_posts")).not.toContain("saved_count");
    expect(codeOf(await boot(undefined, []))).toBeUndefined();
  });
});
