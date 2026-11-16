/**
 * A field made required, and a field renamed, in code, written by
 * `nextly migrate:create` and applied by `nextly migrate`, on every configured
 * dialect.
 *
 * MySQL has no statement that changes only a column's nullability or only its
 * name while keeping the rest of its definition, so `migrate:create` writes
 * each as a four-statement run that builds the `ALTER` from the catalog when
 * the file runs (`SET @nextly_ddl = ...; PREPARE; EXECUTE; DEALLOCATE`). The
 * checks `nextly migrate` makes before it runs a file read statements by their
 * text, and read that run as what it amounts to (`mysqlLiveRunAt`):
 *
 * - a field made required over rows that all hold a value: on MySQL the
 *   `MODIFY ... NOT NULL` a server not in strict mode answers by blanking
 *   NULLs, so it needs the consent that names the column, from
 *   `migrate:create`, which judges the file it writes the same way, as from
 *   `nextly migrate`; PostgreSQL's `SET NOT NULL` and SQLite's rebuild delete
 *   nothing and need none;
 * - a field made required over a row holding no value: refused before any
 *   statement runs, on every dialect, and the column stays optional;
 * - a field renamed: deletes nothing, needs no consent, and keeps its values.
 *
 * The commands are driven themselves (`runMigrateCreate`, `runMigrate`)
 * against a project directory and a database of the test's own, as
 * `migrate-settings-only.integration.test.ts` drives them. Read as text, the
 * MySQL run is a PREPARE that could do anything: the data-loss check refused
 * it unless every deletion was consented to, and the required-column check
 * never saw the NOT NULL, so the NULL row reached the server.
 */
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { defineCollection, defineConfig, text } from "../../../config";
import { createAdapter } from "../../../database/factory";
import { SchemaEventsRepository } from "../../../domains/schema/events/schema-events-repository";
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

const SLUG = "rq_posts";
const TABLE = `dc_${SLUG}`;

let dir: string;
let instance: TestNextly | undefined;
let previousDialect: string | undefined;
let previousUrl: string | undefined;
let clock = 0;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nextly-required-field-"));
  mkdirSync(join(dir, "migrations"));
  previousDialect = process.env.DB_DIALECT;
  previousUrl = process.env.DATABASE_URL;
  // Each migration file is named by the clock; two runs inside one
  // millisecond would otherwise write the same name.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(Date.UTC(2026, 10, 11, 12, 0, 0, 0)));
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
 * A booted instance the commands reach through `DATABASE_URL`, declaring no
 * entity of its own: the table here comes from a migration. SQLite runs on a
 * file in the test's directory, since an in-memory database is unreachable
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

/** What `migrate:create` is run with beyond the name. */
interface CreateOptions {
  /** `--accept-renames`. */
  acceptRenames?: boolean;
  /** `--accept-data-loss=<consent>`. */
  acceptDataLoss?: string;
}

/**
 * `nextly migrate:create --name=<name> --non-interactive` over `config`,
 * with `options`: its exit code, if it exited, and what it said.
 */
async function tryMigrateCreate(
  config: unknown,
  name: string,
  options: CreateOptions = {}
): Promise<{ code: number | undefined; said: string }> {
  loaded.config = config;
  clock += 1;
  vi.setSystemTime(new Date(Date.UTC(2026, 10, 11, 12, 0, 0, clock)));
  const { context, said } = command();
  // A refusal is printed in the CLI's error shape on standard error, past
  // the logger.
  const printed = vi.spyOn(console, "error").mockImplementation(message => {
    said.push(String(message));
  });
  setNonInteractive(true);
  const code = await exiting(() =>
    runMigrateCreate(name, { cwd: dir, ...options }, context)
  ).finally(() => {
    setNonInteractive(false);
    printed.mockRestore();
  });
  return { code, said: said.join("\n") };
}

/** The migration files `migrate:create` has written so far. */
const migrationFiles = (): string[] =>
  readdirSync(join(dir, "migrations")).filter(f => f.endsWith(".sql"));

/**
 * {@link tryMigrateCreate}, which must write the migration: the file's name.
 */
async function migrateCreate(
  config: unknown,
  name: string,
  options: CreateOptions = {}
): Promise<string> {
  const { code, said } = await tryMigrateCreate(config, name, options);
  expect(code, said).toBeUndefined();
  const file = migrationFiles().find(f => f.endsWith(`_${name}.sql`));
  expect(file, `no migration named ${name}\n${said}`).toBeDefined();
  return file!;
}

/**
 * The consent a MySQL file making `subtitle` required needs where nobody can
 * be asked, from `migrate:create` as from `nextly migrate`: its
 * `MODIFY ... NOT NULL` is judged as able to blank values. None elsewhere.
 */
const requiredConsent = (dialect: TestDialect): CreateOptions =>
  dialect === "mysql" ? { acceptDataLoss: `${TABLE}.subtitle` } : {};

/**
 * `nextly migrate --non-interactive`, with `--accept-data-loss=<consent>` when
 * given, over `config`: whether it was refused, and the refusal as the CLI
 * prints it (`formatCliError`), after what the run said before it. The run
 * throws its refusal (`throwOnFailure`) instead of exiting, so the test reads
 * the error the command would have ended with.
 */
async function migrate(
  config: unknown,
  consent?: string
): Promise<{ refused: boolean; said: string }> {
  loaded.config = config;
  const { context, said } = command();
  setNonInteractive(true);
  try {
    await runMigrate(
      {
        cwd: dir,
        throwOnFailure: true,
        ...(consent === undefined ? {} : { acceptDataLoss: consent }),
      },
      context
    );
    return { refused: false, said: said.join("\n") };
  } catch (error) {
    said.push(formatCliError(toCliError(error)));
    return { refused: true, said: said.join("\n") };
  } finally {
    setNonInteractive(false);
  }
}

/** Whether the ledger records `file` applied. */
function applied(dialect: TestDialect, file: string): Promise<boolean> {
  return new SchemaEventsRepository(
    (instance!.adapter as unknown as DrizzleAdapter).getDrizzle(),
    dialect
  ).isFileApplied(file);
}

/**
 * Every attempt the ledger records for `file`, applied or not: a file that
 * fails part-way records a failed attempt, one refused before it runs none.
 */
function attempts(dialect: TestDialect, file: string): Promise<unknown[]> {
  return new SchemaEventsRepository(
    (instance!.adapter as unknown as DrizzleAdapter).getDrizzle(),
    dialect
  ).findFileApplies(file);
}

const q = (dialect: TestDialect, name: string): string =>
  dialect === "mysql" ? `\`${name}\`` : `"${name}"`;

/** Rows written straight to the table, as entries saved before the edit. */
async function insert(
  dialect: TestDialect,
  column: string,
  rows: ReadonlyArray<{ id: string; value: string | null }>
): Promise<void> {
  const values = rows
    .map(
      r =>
        `('${r.id}', '${r.id}', 'T', ${r.value === null ? "NULL" : `'${r.value}'`})`
    )
    .join(", ");
  await instance!.adapter.executeQuery(
    `INSERT INTO ${q(dialect, TABLE)} (${["id", "slug", "title", column]
      .map(c => q(dialect, c))
      .join(", ")}) VALUES ${values}`
  );
}

/** Each row's value in `column`, by id. */
async function values(
  dialect: TestDialect,
  column: string
): Promise<Record<string, string | null>> {
  const rows = (await instance!.adapter.executeQuery(
    `SELECT ${q(dialect, "id")} AS id, ${q(dialect, column)} AS v FROM ${q(dialect, TABLE)}`
  )) as Array<{ id: string; v: string | null }>;
  return Object.fromEntries(rows.map(r => [r.id, r.v]));
}

const posts = (field: { name: string; required?: boolean }) =>
  defineConfig({
    collections: [
      defineCollection({
        slug: SLUG,
        fields: [text({ name: "title" }), text(field)],
      }),
    ],
    db: { migrationsDir: "./migrations" },
  });

describe.each(getConfiguredTestDialects())(
  "a field made required or renamed, from migrate:create to migrate (%s)",
  dialect => {
    beforeEach(async () => {
      instance = await boot(dialect);
      await migrateCreate(posts({ name: "subtitle" }), "create_posts");
      const created = await migrate(posts({ name: "subtitle" }));
      expect(created.refused, created.said).toBe(false);
    });

    it("a field made required over rows that all hold a value: MySQL asks consent for that column, the others none", async () => {
      await insert(dialect, "subtitle", [
        { id: "r1", value: "one" },
        { id: "r2", value: "two" },
      ]);
      const config = posts({ name: "subtitle", required: true });

      // migrate:create judges the file it would write as `nextly migrate`
      // judges it: on MySQL, with nobody to ask, it writes nothing until the
      // column's consent is given.
      if (dialect === "mysql") {
        const before = migrationFiles();
        const unconsented = await tryMigrateCreate(config, "require_subtitle");
        expect(unconsented.code, unconsented.said).toBe(1);
        expect(unconsented.said).toContain(`- column ${TABLE}.subtitle`);
        expect(unconsented.said).toContain(
          `--accept-data-loss=${TABLE}.subtitle`
        );
        expect(migrationFiles()).toEqual(before);
      }
      const file = await migrateCreate(
        config,
        "require_subtitle",
        requiredConsent(dialect)
      );

      if (dialect === "mysql") {
        const refused = await migrate(config);
        expect(refused.refused, refused.said).toBe(true);
        expect(refused.said).toContain("(DATA_LOSS_CONSENT_REQUIRED)");
        expect(refused.said).toContain(`- column ${TABLE}.subtitle`);
        expect(refused.said).toContain(`--accept-data-loss=${TABLE}.subtitle`);
        expect(await applied(dialect, file)).toBe(false);
        // The consent naming the column covers the run; consent to another
        // column of the same table would not.
        const other = await migrate(config, `${TABLE}.title`);
        expect(other.refused, other.said).toBe(true);
        expect(other.said).toContain("(DATA_LOSS_CONSENT_NOT_COVERED)");
        expect(other.said).toContain(`- column ${TABLE}.subtitle`);
        expect(await applied(dialect, file)).toBe(false);

        const run = await migrate(config, `${TABLE}.subtitle`);
        expect(run.refused, run.said).toBe(false);
      } else {
        const run = await migrate(config);
        expect(run.refused, run.said).toBe(false);
      }

      expect(await applied(dialect, file)).toBe(true);
      expect(await values(dialect, "subtitle")).toEqual({
        r1: "one",
        r2: "two",
      });
      // The column is NOT NULL now: a row without a value is refused.
      await expect(
        insert(dialect, "subtitle", [{ id: "r3", value: null }])
      ).rejects.toThrow();
    });

    it("a field made required over a row holding no value: refused before any statement runs", async () => {
      await insert(dialect, "subtitle", [
        { id: "r1", value: "one" },
        { id: "r2", value: null },
      ]);
      const config = posts({ name: "subtitle", required: true });
      const file = await migrateCreate(
        config,
        "require_subtitle",
        requiredConsent(dialect)
      );

      // With the column's consent given, so that what stops the run is the
      // NULL row and not the consent.
      const refused = await migrate(config, `${TABLE}.subtitle`);
      expect(refused.refused, refused.said).toBe(true);
      expect(refused.said).toContain("(REQUIRED_COLUMN_HAS_NULLS)");
      // Named as the collection's field: the first `nextly migrate` wrote the
      // collection's registry row, which maps the table to its entity.
      expect(refused.said).toContain(
        `Collection '${SLUG}': field 'subtitle' cannot become required while 1 row holds no value in it`
      );
      // Refused before it ran, not failed part-way: no attempt is recorded,
      // where a server refusing the ALTER mid-file would leave a failed one.
      expect(await attempts(dialect, file)).toEqual([]);
      // Nothing ran: the NULL is still there, no server blanked it, and the
      // column still takes one.
      expect(await values(dialect, "subtitle")).toEqual({
        r1: "one",
        r2: null,
      });
      await insert(dialect, "subtitle", [{ id: "r3", value: null }]);
    });

    it("a field renamed: no consent asked, every value kept", async () => {
      await insert(dialect, "subtitle", [
        { id: "r1", value: "one" },
        { id: "r2", value: null },
      ]);
      const config = posts({ name: "strapline" });
      const file = await migrateCreate(config, "rename_subtitle", {
        acceptRenames: true,
      });

      const run = await migrate(config);
      expect(run.refused, run.said).toBe(false);
      expect(await applied(dialect, file)).toBe(true);
      expect(await values(dialect, "strapline")).toEqual({
        r1: "one",
        r2: null,
      });
    });
  }
);
