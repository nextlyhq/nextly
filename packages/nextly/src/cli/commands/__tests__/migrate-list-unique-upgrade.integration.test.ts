/**
 * The upgrade of a list relationship an earlier release made unique, from `nextly migrate` to the
 * file `nextly migrate:create` writes, on every configured dialect.
 *
 * An earlier release gave a relationship holding a list, marked unique, a unique index over its
 * stored list (`uq_<table>_<column>`) on PostgreSQL and SQLite, and the migration's snapshot
 * recorded it. MySQL refused the create, so it never held one. No relation holding a list is unique
 * any more, so the declared schema has no such index while the newest snapshot still records it:
 *
 * - `nextly migrate` refuses, naming the index as a change no migration records yet;
 * - `nextly migrate:create` writes the file that drops it;
 * - `nextly migrate` applies that file, the index is gone, and a row holding 300 related ids saves,
 *   which PostgreSQL refused while the index stood.
 *
 * The earlier release's state is planted as it left it: the snapshot gains the index and the
 * database the same index, after the table was created by the commands themselves.
 */
import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  defineCollection,
  defineConfig,
  relationship,
  text,
} from "../../../config";
import { createAdapter } from "../../../database/factory";
import { setNonInteractive } from "../../../domains/schema/migrate/can-prompt";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { _resetEnvCache } from "../../../shared/lib/env";
import { toCliError } from "../../errors/from-thrown";
import { formatCliError } from "../../errors/render";
import type { CommandContext } from "../../program";
import { createLogger } from "../../utils/logger";
import { runMigrate } from "../migrate";
import { runMigrateCreate } from "../migrate-create";

/** The config the commands load, set by each step before it runs them. */
const loaded = vi.hoisted(() => ({
  config: undefined as unknown,
}));
vi.mock("../../utils/config-loader", async importOriginal => ({
  ...(await importOriginal<typeof import("../../utils/config-loader")>()),
  loadConfig: async () => ({ config: loaded.config, dependencies: [] }),
}));

const TABLE = "dc_lu_posts";
const INDEX = `uq_${TABLE}_tags`;
// Random, as real ids are: ids that differ by a counter compress well enough for PostgreSQL to fit
// the whole list in an index row.
const IDS = Array.from({ length: 300 }, () => randomUUID());

let dir: string;
let instance: TestNextly | undefined;
let previousDialect: string | undefined;
let previousUrl: string | undefined;
let clock = 0;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nextly-list-unique-upgrade-"));
  mkdirSync(join(dir, "migrations"));
  previousDialect = process.env.DB_DIALECT;
  previousUrl = process.env.DATABASE_URL;
  // Each migration file is named by the clock; two runs inside one millisecond would otherwise
  // write the same name.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(Date.UTC(2026, 10, 16, 12, 0, 0, 0)));
});

afterEach(async () => {
  vi.useRealTimers();
  await instance?.destroy();
  instance = undefined;
  if (previousDialect === undefined) delete process.env.DB_DIALECT;
  else process.env.DB_DIALECT = previousDialect;
  if (previousUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousUrl;
  _resetEnvCache();
  rmSync(dir, { recursive: true, force: true });
});

/**
 * A booted instance the commands reach through `DATABASE_URL`, declaring no entity of its own: the
 * tables here come from migrations. SQLite runs on a file in the test's directory, since an
 * in-memory database is unreachable from the commands' connection.
 */
async function boot(dialect: TestDialect): Promise<TestNextly> {
  if (dialect !== "sqlite") return createTestNextly({ dialect });
  const url = `file:${join(dir, "test.db")}`;
  process.env.DB_DIALECT = "sqlite";
  process.env.DATABASE_URL = url;
  _resetEnvCache();
  const adapter = await createAdapter({ type: "sqlite", url } as Parameters<
    typeof createAdapter
  >[0]);
  return createTestNextly({ adapter });
}

/** A command's context, with everything it says captured. */
function command(): { context: CommandContext; said: string[] } {
  const said: string[] = [];
  const base = createLogger({ quiet: true });
  const capture = (message: string) => {
    said.push(message);
  };
  return {
    context: {
      logger: {
        ...base,
        info: capture,
        warn: capture,
        success: capture,
        error: capture,
      },
      options: {},
      cwd: dir,
    } as CommandContext,
    said,
  };
}

/** Run `fn`, turning `process.exit` into a thrown `exit <code>`. */
async function exiting(fn: () => Promise<void>): Promise<number | undefined> {
  const exit = vi.spyOn(process, "exit").mockImplementation(code => {
    throw new Error(`exit ${String(code)}`);
  });
  try {
    await fn();
    return undefined;
  } catch (error) {
    const match = /^exit (\d+)$/.exec((error as Error).message);
    if (match) return Number(match[1]);
    throw error;
  } finally {
    exit.mockRestore();
  }
}

/** The migration files `migrate:create` has written so far. */
const migrationFiles = (): string[] =>
  readdirSync(join(dir, "migrations")).filter(f => f.endsWith(".sql"));

/** `nextly migrate:create --name=<name> --non-interactive` over `config`: the file it wrote. */
async function migrateCreate(config: unknown, name: string): Promise<string> {
  loaded.config = config;
  clock += 1;
  vi.setSystemTime(new Date(Date.UTC(2026, 10, 16, 12, 0, 0, clock)));
  const { context, said } = command();
  const printed = vi.spyOn(console, "error").mockImplementation(message => {
    said.push(String(message));
  });
  setNonInteractive(true);
  const code = await exiting(() =>
    runMigrateCreate(name, { cwd: dir }, context)
  ).finally(() => {
    setNonInteractive(false);
    printed.mockRestore();
  });
  expect(code, said.join("\n")).toBeUndefined();
  const file = migrationFiles().find(f => f.endsWith(`_${name}.sql`));
  expect(file, `no migration named ${name}\n${said.join("\n")}`).toBeDefined();
  return file!;
}

/** `nextly migrate --non-interactive` over `config`: whether it was refused, and what it said. */
async function migrate(
  config: unknown
): Promise<{ refused: boolean; said: string }> {
  loaded.config = config;
  const { context, said } = command();
  setNonInteractive(true);
  try {
    await runMigrate({ cwd: dir, throwOnFailure: true }, context);
    return { refused: false, said: said.join("\n") };
  } catch (error) {
    said.push(formatCliError(toCliError(error)));
    return { refused: true, said: said.join("\n") };
  } finally {
    setNonInteractive(false);
  }
}

const q = (dialect: TestDialect, name: string): string =>
  dialect === "mysql" ? `\`${name}\`` : `"${name}"`;

/** The names of the live indexes on the posts table. */
async function liveIndexes(dialect: TestDialect): Promise<string[]> {
  const adapter = instance!.adapter;
  const sql =
    dialect === "postgresql"
      ? `SELECT indexname AS name FROM pg_indexes WHERE tablename = '${TABLE}'`
      : dialect === "mysql"
        ? `SELECT DISTINCT INDEX_NAME AS name FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${TABLE}'`
        : `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = '${TABLE}'`;
  const rows = (await adapter.executeQuery(sql)) as Array<{ name: string }>;
  return rows.map(row => row.name);
}

/** A row holding the 300 ids in its list, written straight to the table. */
function insertLongList(dialect: TestDialect): Promise<unknown> {
  return instance!.adapter.executeQuery(
    `INSERT INTO ${q(dialect, TABLE)} (${["id", "slug", "title", "tags"]
      .map(c => q(dialect, c))
      .join(", ")}) VALUES ('p1', 'p1', 'Long', '${JSON.stringify(IDS)}')`
  );
}

/**
 * Plants what an earlier release left: the newest snapshot records the unique index over the
 * list, and the database holds it. MySQL never held one: the earlier release refused the create.
 */
async function plantEarlierIndex(dialect: TestDialect): Promise<void> {
  const meta = join(dir, "migrations", "meta");
  const newest = readdirSync(meta)
    .filter(f => f.endsWith(".snapshot.json"))
    .sort()
    .at(-1)!;
  const path = join(meta, newest);
  const snapshot = JSON.parse(readFileSync(path, "utf-8")) as unknown;
  let found = false;
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (typeof node !== "object" || node === null) return;
    const table = node as {
      name?: unknown;
      columns?: Array<{ name: string }>;
      indexes?: unknown[];
    };
    if (table.name === TABLE && Array.isArray(table.columns)) {
      expect(table.columns.map(c => c.name)).toContain("tags");
      table.indexes = [
        ...(table.indexes ?? []),
        { name: INDEX, columns: ["tags"], unique: true },
      ];
      found = true;
      return;
    }
    Object.values(node).forEach(visit);
  };
  visit(snapshot);
  expect(found, `no ${TABLE} in ${newest}`).toBe(true);
  writeFileSync(path, JSON.stringify(snapshot, null, 2));
  await instance!.adapter.executeQuery(
    `CREATE UNIQUE INDEX ${q(dialect, INDEX)} ON ${q(dialect, TABLE)}(${q(dialect, "tags")})`
  );
}

/** The app: posts whose `tags` holds a list of links, no longer marked unique. */
const app = defineConfig({
  collections: [
    defineCollection({ slug: "lu_tags", fields: [text({ name: "label" })] }),
    defineCollection({
      slug: "lu_posts",
      fields: [
        text({ name: "title" }),
        relationship({ name: "tags", relationTo: "lu_tags", hasMany: true }),
      ],
    }),
  ],
  db: { migrationsDir: "./migrations" },
});

describe.each(getConfiguredTestDialects())(
  "a list relationship an earlier release made unique, after the upgrade (%s)",
  dialect => {
    beforeEach(async () => {
      instance = await boot(dialect);
      await migrateCreate(app, "create_posts");
      const created = await migrate(app);
      expect(created.refused, created.said).toBe(false);
    });

    it("is named by nextly migrate, dropped by the file migrate:create writes, and then holds 300 ids", async () => {
      if (dialect === "mysql") {
        // The earlier release refused the create here, so there is nothing to upgrade: the list
        // already saves, and nothing is pending.
        await insertLongList(dialect);
        const again = await migrate(app);
        expect(again.refused, again.said).toBe(false);
        return;
      }
      await plantEarlierIndex(dialect);
      expect(await liveIndexes(dialect)).toContain(INDEX);
      if (dialect === "postgresql") {
        // The planted index is the one that refused a long list.
        await expect(insertLongList(dialect)).rejects.toThrow();
      }

      const refused = await migrate(app);
      expect(refused.refused, refused.said).toBe(true);
      expect(refused.said).toContain(INDEX);
      expect(await liveIndexes(dialect)).toContain(INDEX);

      const file = await migrateCreate(app, "drop_list_unique");
      const written = readFileSync(join(dir, "migrations", file), "utf-8");
      expect(written).toContain(INDEX);
      expect(written).toMatch(/DROP INDEX/i);

      const applied = await migrate(app);
      expect(applied.refused, applied.said).toBe(false);
      expect(await liveIndexes(dialect)).not.toContain(INDEX);
      await insertLongList(dialect);

      // Nothing is left for a later run.
      const again = await migrate(app);
      expect(again.refused, again.said).toBe(false);
    });
  }
);
