/**
 * A collection removed from the config, written by `nextly migrate:create`, on
 * every configured dialect: the run lists the table it would drop, with its
 * rows when the database can be read, and a run that cannot ask writes no file
 * without the data-loss consent. With consent naming the table it writes the
 * file, whose header names the table.
 *
 * Twice per dialect: once with `DATABASE_URL` naming the database the
 * migrations were applied to (the listing counts the rows), and once naming
 * one that is not there (names only, and the file written or refused just the
 * same: the counts never decide it).
 *
 * The commands are driven themselves (`runMigrateCreate`, `runMigrate`)
 * against a project directory and a database of the test's own, as
 * `migrate-create-required-field.integration.test.ts` drives them.
 */
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defineCollection, defineConfig, text } from "../../../config";
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

// This file's own tables.
const POSTS = "ld_posts";
const PAGES = "ld_pages";
const POSTS_TABLE = `dc_${POSTS}`;
const PAGES_TABLE = `dc_${PAGES}`;

let dir: string;
let instance: TestNextly | undefined;
let previousDialect: string | undefined;
let previousUrl: string | undefined;
let clock = 0;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nextly-lists-deletions-"));
  mkdirSync(join(dir, "migrations"));
  previousDialect = process.env.DB_DIALECT;
  previousUrl = process.env.DATABASE_URL;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(Date.UTC(2026, 10, 12, 12, 0, 0, 0)));
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
 * A booted instance the commands reach through `DATABASE_URL`. SQLite runs on
 * a file in the test's directory, since an in-memory database is unreachable
 * from the commands' connection.
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

/**
 * A `DATABASE_URL` of the same dialect naming no database that can be read:
 * a SQLite file that does not exist, or a server port nothing listens on.
 */
function unreachableUrl(dialect: TestDialect): string {
  if (dialect === "sqlite") return `file:${join(dir, "absent.db")}`;
  if (dialect === "mysql") return "mysql://nextly:nextly@127.0.0.1:1/absent";
  return "postgres://nextly:nextly@127.0.0.1:1/absent";
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
        item: capture,
      },
      options: {},
      cwd: dir,
    } as CommandContext,
    said,
  };
}

/** The migration files written so far, oldest first. */
function files(): string[] {
  return readdirSync(join(dir, "migrations"))
    .filter(f => f.endsWith(".sql"))
    .sort();
}

/**
 * `nextly migrate:create <name> --non-interactive`, with
 * `--accept-data-loss=<consent>` when given, over `config`: the code it
 * exited with (none when it wrote its file), and what it said, its refusal as
 * the CLI prints it included.
 */
async function migrateCreate(
  config: unknown,
  name: string,
  consent?: string
): Promise<{ code: number | undefined; said: string }> {
  loaded.config = config;
  clock += 1;
  vi.setSystemTime(new Date(Date.UTC(2026, 10, 12, 12, 0, 0, clock)));
  const { context, said } = command();
  const exit = vi.spyOn(process, "exit").mockImplementation(code => {
    throw new Error(`exit ${String(code)}`);
  });
  const printed = vi
    .spyOn(console, "error")
    .mockImplementation((...args: unknown[]) => {
      said.push(args.map(String).join(" "));
    });
  setNonInteractive(true);
  try {
    await runMigrateCreate(
      name,
      {
        cwd: dir,
        ...(consent === undefined ? {} : { acceptDataLoss: consent }),
      },
      context
    );
    return { code: undefined, said: said.join("\n") };
  } catch (error) {
    const match = /^exit (\d+)$/.exec((error as Error).message);
    if (match) return { code: Number(match[1]), said: said.join("\n") };
    said.push(formatCliError(toCliError(error)));
    return { code: -1, said: said.join("\n") };
  } finally {
    setNonInteractive(false);
    exit.mockRestore();
    printed.mockRestore();
  }
}

/** `nextly migrate --non-interactive` over `config`; whether it was refused. */
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

/** Rows written straight to `table`, as entries saved before the edit. */
async function insert(
  dialect: TestDialect,
  table: string,
  rows: ReadonlyArray<Record<string, string | null>>
): Promise<void> {
  for (const row of rows) {
    const columns = Object.keys(row);
    const values = columns.map(c =>
      row[c] === null ? "NULL" : `'${String(row[c])}'`
    );
    await instance!.adapter.executeQuery(
      `INSERT INTO ${q(dialect, table)} (${columns.map(c => q(dialect, c)).join(", ")}) VALUES (${values.join(", ")})`
    );
  }
}

const postsCollection = defineCollection({
  slug: POSTS,
  fields: [text({ name: "title" })],
});
const pagesCollection = (withSummary: boolean) =>
  defineCollection({
    slug: PAGES,
    fields: [
      text({ name: "title" }),
      ...(withSummary ? [text({ name: "summary" })] : []),
    ],
  });
const configOf = (collections: unknown[]) =>
  defineConfig({
    collections,
    db: { migrationsDir: "./migrations" },
  } as Parameters<typeof defineConfig>[0]);

describe.each(getConfiguredTestDialects())(
  "migrate:create lists every deletion, and writes it only with consent (%s)",
  dialect => {
    beforeEach(async () => {
      instance = await boot(dialect);
      const both = configOf([postsCollection, pagesCollection(true)]);
      const created = await migrateCreate(both, "create");
      expect(created.code, created.said).toBeUndefined();
      const applied = await migrate(both);
      expect(applied.refused, applied.said).toBe(false);
      await insert(dialect, POSTS_TABLE, [
        { id: "p1", slug: "p1", title: "One" },
        { id: "p2", slug: "p2", title: "Two" },
        { id: "p3", slug: "p3", title: "Three" },
      ]);
      await insert(dialect, PAGES_TABLE, [
        { id: "g1", slug: "g1", title: "A", summary: "kept" },
        { id: "g2", slug: "g2", title: "B", summary: null },
      ]);
    });

    it("lists the removed collection with its rows, and writes no file without consent", async () => {
      const removed = configOf([pagesCollection(true)]);
      const refused = await migrateCreate(removed, "remove_posts");
      expect(refused.code, refused.said).toBe(1);
      expect(files()).toHaveLength(1);
      expect(refused.said).toContain(
        `table ${POSTS_TABLE} (3 rows): no longer in the config`
      );
      expect(refused.said).toContain(`--accept-data-loss=${POSTS_TABLE}`);

      const written = await migrateCreate(removed, "remove_posts", POSTS_TABLE);
      expect(written.code, written.said).toBeUndefined();
      expect(files()).toHaveLength(2);
      const sql = readFileSync(join(dir, "migrations", files()[1]), "utf-8");
      expect(sql).toContain(
        `-- Deletes: table ${POSTS_TABLE}: no longer in the config`
      );
      // The header names no count: the file runs against other databases.
      expect(sql).not.toContain("3 rows");
    });

    it("counts a dropped column's non-empty values", async () => {
      const dropped = configOf([postsCollection, pagesCollection(false)]);
      const refused = await migrateCreate(dropped, "drop_summary");
      expect(refused.code, refused.said).toBe(1);
      expect(refused.said).toContain(
        `column ${PAGES_TABLE}.summary (1 non-empty value): no longer in the config`
      );
      expect(files()).toHaveLength(1);
    });

    it("with no database to read, lists by name only and decides the same", async () => {
      process.env.DATABASE_URL = unreachableUrl(dialect);
      _resetEnvCache();
      const removed = configOf([pagesCollection(true)]);

      const refused = await migrateCreate(removed, "remove_posts");
      expect(refused.code, refused.said).toBe(1);
      expect(files()).toHaveLength(1);
      expect(refused.said).toContain(
        `table ${POSTS_TABLE}: no longer in the config`
      );
      expect(refused.said).not.toContain("rows)");
      expect(refused.said).toContain(
        "Counts not shown: the database could not be read."
      );

      const written = await migrateCreate(removed, "remove_posts", POSTS_TABLE);
      expect(written.code, written.said).toBeUndefined();
      expect(files()).toHaveLength(2);
    });
  }
);
