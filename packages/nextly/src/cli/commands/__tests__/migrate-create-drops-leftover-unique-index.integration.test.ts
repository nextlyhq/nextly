/**
 * A field that stops being unique, written by `nextly migrate:create` and run by `nextly migrate`
 * on other databases, on every configured dialect, where an older table holds the field's column
 * unique under a second index Nextly did not name (`lu_posts_code_key`):
 *
 * - `migrate:create` reads that index from the database it can read, says it will drop it, by
 *   name, as one the user may have made, and writes its drop into the file;
 * - a database that holds the index under that name ends with the column no longer unique, as
 *   the database the change was made on does;
 * - the drop is guarded by the name: a database without that index runs the file all the same.
 *
 * The commands are driven themselves (`runMigrateCreate`, `runMigrate`) against a project
 * directory, as `migrate-create-lists-deletions.integration.test.ts` drives them. The databases
 * the file is replayed on are made for the test: a second SQLite file, or a scratch database on
 * the server.
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

import { createScratchDatabase } from "../../../__tests__/helpers/fresh-database";
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
const loaded = vi.hoisted(() => ({ config: undefined as unknown }));
vi.mock("../../utils/config-loader", async importOriginal => ({
  ...(await importOriginal<typeof import("../../utils/config-loader")>()),
  loadConfig: async () => ({ config: loaded.config, dependencies: [] }),
}));

// This file's own table, and the index an older table holds beside Nextly's own.
const POSTS = "lu_posts";
const TABLE = `dc_${POSTS}`;
const LEFTOVER = "lu_posts_code_key";

/** A database the test can reach and drop. */
interface Target {
  url: string;
  drop: () => Promise<void>;
}

let dir: string;
let instance: TestNextly | undefined;
const made: Target[] = [];
let previousDialect: string | undefined;
let previousUrl: string | undefined;
let clock = 0;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nextly-leftover-unique-"));
  mkdirSync(join(dir, "migrations"));
  previousDialect = process.env.DB_DIALECT;
  previousUrl = process.env.DATABASE_URL;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(Date.UTC(2026, 10, 20, 12, 0, 0, 0)));
});

afterEach(async () => {
  vi.useRealTimers();
  await instance?.destroy();
  instance = undefined;
  for (const target of made.splice(0)) await target.drop();
  if (previousDialect === undefined) delete process.env.DB_DIALECT;
  else process.env.DB_DIALECT = previousDialect;
  if (previousUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousUrl;
  _resetEnvCache();
  rmSync(dir, { recursive: true, force: true });
});

/** Points the commands at `url`. */
function use(dialect: TestDialect, url: string): void {
  process.env.DB_DIALECT = dialect;
  process.env.DATABASE_URL = url;
  _resetEnvCache();
}

/**
 * The database the change is made against, booted, and the URL the commands reach it through.
 * SQLite runs on a file in the test's directory, since an in-memory database is unreachable from
 * the commands' connection.
 */
async function boot(dialect: TestDialect): Promise<string> {
  if (dialect !== "sqlite") {
    instance = await createTestNextly({ dialect });
    return String(process.env.DATABASE_URL);
  }
  const url = `file:${join(dir, "made-on.db")}`;
  use(dialect, url);
  const adapter = await createAdapter({ type: "sqlite", url } as Parameters<
    typeof createAdapter
  >[0]);
  instance = await createTestNextly({ adapter });
  return url;
}

/** Another database the file is replayed on, empty, removed after the test. */
async function another(dialect: TestDialect, name: string): Promise<string> {
  if (dialect === "sqlite") {
    const url = `file:${join(dir, `${name}.db`)}`;
    made.push({ url, drop: () => Promise.resolve() });
    return url;
  }
  const scratch = await createScratchDatabase(dialect, `lu_${name}`);
  made.push(scratch);
  return scratch.url;
}

/** A statement on the database `url` names, through an adapter of its own. */
async function on(
  dialect: TestDialect,
  url: string,
  statement: string
): Promise<void> {
  const adapter = await createAdapter({
    type: dialect,
    url,
  } as Parameters<typeof createAdapter>[0]);
  try {
    await (
      adapter as unknown as { executeQuery(sql: string): Promise<unknown> }
    ).executeQuery(statement);
  } finally {
    await (adapter as unknown as { disconnect(): Promise<void> }).disconnect();
  }
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

/** `nextly migrate:create <name> --non-interactive` over `config`: its exit code, and what it said. */
async function migrateCreate(
  config: unknown,
  name: string
): Promise<{ code: number | undefined; said: string }> {
  loaded.config = config;
  clock += 1;
  vi.setSystemTime(new Date(Date.UTC(2026, 10, 20, 12, 0, 0, clock)));
  const { context, said } = command();
  const exit = vi.spyOn(process, "exit").mockImplementation(code => {
    throw new Error(`exit ${String(code)}`);
  });
  setNonInteractive(true);
  try {
    await runMigrateCreate(name, { cwd: dir }, context);
    return { code: undefined, said: said.join("\n") };
  } catch (error) {
    const match = /^exit (\d+)$/.exec((error as Error).message);
    if (match) return { code: Number(match[1]), said: said.join("\n") };
    said.push(formatCliError(toCliError(error)));
    return { code: -1, said: said.join("\n") };
  } finally {
    setNonInteractive(false);
    exit.mockRestore();
  }
}

/** `nextly migrate --non-interactive` over `config`; whether it was refused, and what it said. */
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

/** Whether the database `url` names takes a second row with the first's code. */
async function takesARepeat(
  dialect: TestDialect,
  url: string
): Promise<boolean> {
  const row = (id: string) =>
    `INSERT INTO ${q(dialect, TABLE)} (${q(dialect, "id")}, ${q(dialect, "slug")}, ${q(dialect, "title")}, ${q(dialect, "code")}) VALUES ('${id}', '${id}', 'T', 'same')`;
  await on(dialect, url, row("r1"));
  return on(dialect, url, row("r2")).then(
    () => true,
    () => false
  );
}

const configWith = (unique: boolean) =>
  defineConfig({
    collections: [
      defineCollection({
        slug: POSTS,
        fields: [
          text({ name: "title" }),
          text({ name: "code", unique, maxLength: 64 }),
        ],
      }),
    ],
    db: { migrationsDir: "./migrations" },
  } as Parameters<typeof defineConfig>[0]);

describe.each(getConfiguredTestDialects())(
  "a field that stops being unique drops the older unique index on its column, by name (%s)",
  dialect => {
    it("names the index it drops, and every database holding it under that name ends with the column no longer unique", async () => {
      const madeOn = await boot(dialect);
      const elsewhere = await another(dialect, "elsewhere");
      const without = await another(dialect, "without");
      const before = configWith(true);

      // The field made unique, applied to each database, and the older index added beside
      // Nextly's on the two whose table is an older one.
      const created = await migrateCreate(before, "create");
      expect(created.code, created.said).toBeUndefined();
      for (const url of [madeOn, elsewhere, without]) {
        use(dialect, url);
        const applied = await migrate(before);
        expect(applied.refused, applied.said).toBe(false);
      }
      for (const url of [madeOn, elsewhere]) {
        await on(
          dialect,
          url,
          `CREATE UNIQUE INDEX ${q(dialect, LEFTOVER)} ON ${q(dialect, TABLE)} (${q(dialect, "code")})`
        );
      }

      // Unique turned off, written against the database the change is made on.
      use(dialect, madeOn);
      const after = configWith(false);
      const written = await migrateCreate(after, "code_not_unique");
      expect(written.code, written.said).toBeUndefined();
      expect(files()).toHaveLength(2);
      // It says which index it drops, as one the user may have made.
      expect(written.said).toContain(LEFTOVER);
      expect(
        readFileSync(join(dir, "migrations", files()[1]), "utf-8")
      ).toContain(LEFTOVER);

      // Replayed on a database that holds the older index under that name: the column is no
      // longer unique there.
      use(dialect, elsewhere);
      const replayed = await migrate(after);
      expect(replayed.refused, replayed.said).toBe(false);
      expect(await takesARepeat(dialect, elsewhere)).toBe(true);

      // And on one without it: the drop is guarded by the name, so the file runs all the same.
      use(dialect, without);
      const guarded = await migrate(after);
      expect(guarded.refused, guarded.said).toBe(false);
      expect(await takesARepeat(dialect, without)).toBe(true);
    }, 240_000);
  }
);
