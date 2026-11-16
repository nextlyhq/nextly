/**
 * `nextly migrate` never reports a database as up to date while the
 * configuration holds a change no migration records: it names each one, says
 * to run `migrate:create`, and exits with a failure before changing anything —
 * on every configured dialect.
 *
 * The commands are driven themselves (`runMigrateCreate`, `runMigrate`)
 * against a project directory and a database of the test's own; only the
 * config file is not read from disk.
 *
 * Without the refusal, each run below printed "Nothing to migrate. Database is
 * up to date." and exited 0, the edit reaching no database.
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { defineCollection, defineConfig, number, text } from "../../../config";
import { createAdapter } from "../../../database/factory";
import { loadedDialect } from "../../../database/dialect-tables";
import { setNonInteractive } from "../../../domains/schema/migrate/can-prompt";
import { liveColumnNames } from "../../../domains/schema/pipeline/diff/introspect-live";
import { definePlugin } from "../../../plugins/plugin-context";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { _resetEnvCache } from "../../../shared/lib/env";
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

const SLUG = "uw_posts";
const TABLE = `dc_${SLUG}`;
const TAGS = "uw_tags";
const PLUGIN = "@acme/uw-forms";

let dir: string;
let instance: TestNextly | undefined;
let previousDialect: string | undefined;
let previousUrl: string | undefined;
let clock = 0;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nextly-unwritten-"));
  mkdirSync(join(dir, "migrations"));
  previousDialect = process.env.DB_DIALECT;
  previousUrl = process.env.DATABASE_URL;
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

/** A booted instance declaring no entity of its own, reached through `DATABASE_URL`. */
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

/** Run `fn`, turning `process.exit` into its code. */
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

/** `nextly migrate:create --name=<name> --non-interactive` over `config`. */
async function migrateCreate(
  config: unknown,
  name: string,
  options: { acceptDataLoss?: boolean } = {}
): Promise<void> {
  loaded.config = config;
  clock += 1;
  vi.setSystemTime(new Date(Date.UTC(2026, 10, 16, 12, 0, 0, clock)));
  const { context, said } = command();
  setNonInteractive(true);
  const code = await exiting(() =>
    runMigrateCreate(name, { cwd: dir, ...options }, context)
  ).finally(() => setNonInteractive(false));
  expect(code, said.join("\n")).toBeUndefined();
}

/** An error's text as the command's error shape prints it: what, why and next. */
function errorText(error: unknown): string {
  const e = error as {
    message?: string;
    publicMessage?: string;
    why?: string;
    next?: string;
  };
  return [e.publicMessage ?? e.message, e.why, e.next]
    .filter(part => typeof part === "string")
    .join("\n");
}

/**
 * `nextly migrate` over `config`: 1 where it failed (undefined for success), and what it said,
 * the error it ended with included.
 */
async function migrate(
  config: unknown,
  options: { dryRun?: boolean; acceptDataLoss?: boolean } = {}
): Promise<{ code: number | undefined; said: string }> {
  loaded.config = config;
  const { context, said } = command();
  setNonInteractive(true);
  let code: number | undefined;
  try {
    code = await exiting(() =>
      runMigrate(
        { cwd: dir, throwOnFailure: true, ...options } as Parameters<
          typeof runMigrate
        >[0],
        context
      )
    );
  } catch (error) {
    code = 1;
    said.push(errorText(error));
  } finally {
    setNonInteractive(false);
  }
  return { code, said: said.join("\n") };
}

const UP_TO_DATE = "Nothing to migrate. Database is up to date.";

/** The live columns of the content table, or undefined where it is absent. */
async function columns(t: TestNextly, dialect: TestDialect) {
  const db = (t.adapter as unknown as DrizzleAdapter).getDrizzle();
  return (await liveColumnNames(db, dialect, [TABLE])).get(TABLE);
}

/** The permission rows, as a sorted list of `slug:owner:orphaned`. */
async function permissionRows(t: TestNextly, dialect: TestDialect) {
  const { permissions } = loadedDialect(dialect).tables;
  const db = (t.adapter as unknown as DrizzleAdapter).getDrizzle() as {
    select(f: unknown): {
      from(t: unknown): Promise<Record<string, unknown>[]>;
    };
  };
  const rows = await db
    .select({
      slug: permissions.slug,
      owner: permissions.owner,
      orphanedAt: permissions.orphanedAt,
    })
    .from(permissions);
  return rows
    .map(
      r =>
        `${String(r.slug)}:${String(r.owner)}:${r.orphanedAt === null ? "live" : "orphaned"}`
    )
    .sort();
}

type Field = ReturnType<typeof text> | ReturnType<typeof number>;

const config = (
  fields: Field[],
  extra: {
    description?: string;
    permissions?: string[];
    noPosts?: boolean;
  } = {}
) =>
  defineConfig({
    collections: extra.noPosts
      ? []
      : [
          defineCollection({
            slug: SLUG,
            ...(extra.description === undefined
              ? {}
              : { description: extra.description }),
            fields,
          }),
        ],
    ...(extra.permissions === undefined
      ? {}
      : {
          plugins: [
            definePlugin({
              name: PLUGIN,
              version: "1.0.0",
              nextly: ">=0.0.1",
              contributes: {
                permissions: extra.permissions.map(action => ({
                  action,
                  resource: "uw_submissions",
                })),
              },
            }),
          ],
        }),
    db: { migrationsDir: "./migrations" },
  });

const TITLE = text({ name: "title" });
const BODY = text({ name: "body" });

describe.each(getConfiguredTestDialects())(
  "nextly migrate refuses changes no migration records (%s)",
  dialect => {
    beforeEach(async () => {
      instance = await boot(dialect);
    });

    it("an empty database and no migration: names each table, creates none", async () => {
      const run = await migrate(config([TITLE]));
      expect(run.code).toBe(1);
      expect(run.said).toContain(`+ add_table ${TABLE}`);
      expect(run.said).toContain("nextly migrate:create");
      expect(run.said).not.toContain(UP_TO_DATE);
      expect(await columns(instance!, dialect)).toBeUndefined();
    });

    it("a dry run names them and fails the same way", async () => {
      const run = await migrate(config([TITLE]), { dryRun: true });
      expect(run.code).toBe(1);
      expect(run.said).toContain(`+ add_table ${TABLE}`);
    });

    it.each([
      ["a field removed", [TITLE], `- drop_column ${TABLE}.body`],
      [
        "a field's type changed",
        [TITLE, number({ name: "body" })],
        `~ change_column_type ${TABLE}.body`,
      ],
      [
        "a field made required",
        [TITLE, text({ name: "body", required: true })],
        `~ change_column_nullable ${TABLE}.body`,
      ],
    ])("%s: names it and changes nothing", async (_what, fields, line) => {
      await migrateCreate(config([TITLE, BODY]), "create_posts");
      expect((await migrate(config([TITLE, BODY]))).code).toBeUndefined();
      const before = await columns(instance!, dialect);

      const run = await migrate(config(fields as Field[]));

      expect(run.code).toBe(1);
      expect(run.said).toContain(line);
      expect(run.said).toContain("nextly migrate:create");
      expect(await columns(instance!, dialect)).toEqual(before);
    });

    it("a collection removed: named, then its migration asks for consent", async () => {
      await migrateCreate(config([TITLE]), "create_posts");
      expect((await migrate(config([TITLE]))).code).toBeUndefined();

      const run = await migrate(config([], { noPosts: true }));
      expect(run.code).toBe(1);
      expect(run.said).toContain(`- drop_table ${TABLE}`);
      expect(await columns(instance!, dialect)).toBeDefined();

      await migrateCreate(config([], { noPosts: true }), "drop_posts", {
        acceptDataLoss: true,
      });
      const unconsented = await migrate(config([], { noPosts: true }));
      expect(unconsented.code).not.toBeUndefined();
      expect(unconsented.said).toContain("--accept-data-loss");
      expect(await columns(instance!, dialect)).toBeDefined();
    });

    it("up to date once migrate:create has written the change", async () => {
      await migrateCreate(config([TITLE]), "create_posts");
      const run = await migrate(config([TITLE]));
      expect(run.code, run.said).toBeUndefined();
      expect(run.said).toContain("applied");
      const again = await migrate(config([TITLE]));
      expect(again.code, again.said).toBeUndefined();
      expect(again.said).toContain(UP_TO_DATE);
    });

    it("a settings-only edit, and a description cleared, fail naming the entity", async () => {
      await migrateCreate(
        config([TITLE], { description: "Posts" }),
        "create_posts"
      );
      expect(
        (await migrate(config([TITLE], { description: "Posts" }))).code
      ).toBeUndefined();

      const edited = await migrate(
        config([TITLE], { description: "Articles" })
      );
      expect(edited.code).toBe(1);
      expect(edited.said).toContain(`~ settings ${SLUG}: description`);

      const cleared = await migrate(config([TITLE]));
      expect(cleared.code).toBe(1);
      expect(cleared.said).toContain(
        `~ settings ${SLUG}: description (cleared)`
      );
    });

    it("a plugin permission added, then one removed: named, permission rows unchanged", async () => {
      await migrateCreate(
        config([TITLE], { permissions: ["export"] }),
        "create_posts"
      );
      expect(
        (await migrate(config([TITLE], { permissions: ["export"] }))).code
      ).toBeUndefined();
      const before = await permissionRows(instance!, dialect);

      const added = await migrate(
        config([TITLE], { permissions: ["export", "archive"] })
      );
      expect(added.code).toBe(1);
      expect(added.said).toContain(
        `~ permissions ${PLUGIN}: + archive-uw_submissions`
      );
      expect(await permissionRows(instance!, dialect)).toEqual(before);

      const removed = await migrate(config([TITLE], { permissions: [] }));
      expect(removed.code).toBe(1);
      expect(removed.said).toContain(
        `~ permissions ${PLUGIN}: - export-uw_submissions`
      );
      expect(await permissionRows(instance!, dialect)).toEqual(before);
    });

    it("a Builder collection its migration records is never reported removed", async () => {
      await writeFile(
        join(dir, "ui-schema.json"),
        `${JSON.stringify({
          version: 1,
          collections: [
            { slug: "uw_notes", fields: [{ name: "note", type: "text" }] },
          ],
        })}\n`
      );
      const builderOnly = config([], { noPosts: true });
      await migrateCreate(builderOnly, "create_notes");
      expect((await migrate(builderOnly)).code).toBeUndefined();
      const again = await migrate(builderOnly);
      expect(again.code, again.said).toBeUndefined();
      expect(again.said).toContain(UP_TO_DATE);
    });

    it("a table and a column its applied migrations made, dropped by hand: names both and the migration that made each", async () => {
      const both = (fields: Field[]) =>
        defineConfig({
          collections: [
            defineCollection({ slug: SLUG, fields }),
            defineCollection({ slug: TAGS, fields: [text({ name: "label" })] }),
          ],
          db: { migrationsDir: "./migrations" },
        });
      await migrateCreate(both([TITLE]), "create_posts");
      await migrateCreate(both([TITLE, BODY]), "add_body");
      expect((await migrate(both([TITLE, BODY]))).code).toBeUndefined();
      const db = instance!.adapter as unknown as {
        executeQuery(sql: string): Promise<unknown>;
      };
      const q = dialect === "mysql" ? "`" : '"';
      await db.executeQuery(`DROP TABLE ${q}dc_${TAGS}${q}`);
      await db.executeQuery(
        `ALTER TABLE ${q}${TABLE}${q} DROP COLUMN ${q}body${q}`
      );

      const run = await migrate(both([TITLE, BODY]));

      expect(run.code).toBe(1);
      expect(run.said).toMatch(
        new RegExp(
          `- table dc_${TAGS} \\(created by \\d+_\\d+_\\d+_create_posts\\)`
        )
      );
      expect(run.said).toMatch(
        new RegExp(
          `- column ${TABLE}\\.body \\(created by \\d+_\\d+_\\d+_add_body\\)`
        )
      );
      expect(run.said).toContain("no longer matches its ledger");
      expect(run.said).not.toContain(UP_TO_DATE);
      // Nothing was changed: the column stays dropped, nothing re-created it.
      expect((await columns(instance!, dialect))?.has("body")).toBe(false);
    });

    it("a table and a column a later migration dropped, with consent, are not missing", async () => {
      const both = (fields: Field[], tags: boolean) =>
        defineConfig({
          collections: [
            defineCollection({ slug: SLUG, fields }),
            ...(tags
              ? [
                  defineCollection({
                    slug: TAGS,
                    fields: [text({ name: "label" })],
                  }),
                ]
              : []),
          ],
          db: { migrationsDir: "./migrations" },
        });
      await migrateCreate(both([TITLE, BODY], true), "create_both");
      expect((await migrate(both([TITLE, BODY], true))).code).toBeUndefined();
      await migrateCreate(both([TITLE], false), "drop_them", {
        acceptDataLoss: true,
      });
      const dropped = await migrate(both([TITLE], false), {
        acceptDataLoss: true,
      });
      expect(dropped.code, dropped.said).toBeUndefined();

      const again = await migrate(both([TITLE], false));
      expect(again.code, again.said).toBeUndefined();
      expect(again.said).toContain(UP_TO_DATE);
    });

    it("a database db:sync made, with no migration yet, is told migrate:baseline", async () => {
      const db = instance!.adapter as unknown as {
        executeQuery(sql: string): Promise<unknown>;
      };
      await db.executeQuery(
        `CREATE TABLE ${TABLE} (id varchar(36) PRIMARY KEY)`
      );
      const run = await migrate(config([TITLE]));
      expect(run.code).toBe(1);
      expect(run.said).toContain("nextly migrate:baseline");
    });
  }
);
