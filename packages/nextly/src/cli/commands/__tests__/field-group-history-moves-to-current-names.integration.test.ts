/**
 * A project's migration history moves to the current field-group names in one explicit step, and
 * every command after it follows the history, on every configured dialect.
 *
 * The history records the names its field groups are kept under in each snapshot. A site whose
 * storage moved (`nextly migrate:field-groups`) runs `nextly migrate:create
 * --field-group-names=current`, which writes a migration with no statement whose snapshot is the
 * newest one under the current names. `nextly migrate` records it on a database that moved, and
 * refuses it, naming the storage migration, on one that has not. A migrated database behind a
 * legacy history is refused by name, rather than reported as missing every `comp_` table.
 *
 * Each run owns its database, reached by the commands through `DATABASE_URL` as an app's would: a
 * file on SQLite, a scratch database on the servers.
 */
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createScratchDatabase } from "../../../__tests__/helpers/fresh-database";
import {
  defineCollection,
  defineConfig,
  defineFieldGroup,
  fieldGroup,
  text,
} from "../../../config";
import { createAdapter } from "../../../database/factory";
import { clearServices, shutdownServices } from "../../../di/register";
import { runFieldGroupMigration } from "../../../domains/field-groups/migration/run";
import { forgetFieldGroupStorageNames } from "../../../domains/field-groups/storage/resolve-storage-names";
import { setNonInteractive } from "../../../domains/schema/migrate/can-prompt";
import { parseSqlSections } from "../../../domains/schema/migrate/sql-sections";
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
import { runMigrateCheck } from "../migrate-check";
import { runMigrateCreate } from "../migrate-create";

/** The configuration the commands load, set by each step before it runs them. */
const loaded = vi.hoisted(() => ({ config: undefined as unknown }));
vi.mock("../../utils/config-loader", async importOriginal => ({
  ...(await importOriginal<typeof import("../../utils/config-loader")>()),
  loadConfig: async () => ({ config: loaded.config, dependencies: [] }),
}));

const SILENT = createLogger({ quiet: true });

function declarations(cardFields: string[]) {
  const fieldGroups = [
    defineFieldGroup({
      slug: "fh_card",
      fields: cardFields.map(name => text({ name })),
    }),
  ];
  const collections = [
    defineCollection({
      slug: "fh_posts",
      fields: [
        text({ name: "title" }),
        fieldGroup({ name: "card", component: "fh_card" }),
      ],
    }),
  ];
  return { fieldGroups, collections };
}

const FIRST = declarations(["heading"]);
const WITH_SUBTITLE = declarations(["heading", "subtitle"]);
const configOf = (d: typeof FIRST) =>
  defineConfig({ ...d, db: { migrationsDir: "./migrations" } });

let dir: string;
let closers: Array<() => Promise<void>> = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nextly-fg-history-"));
  mkdirSync(join(dir, "migrations"));
});

afterEach(async () => {
  await shutdownServices().catch(() => {});
  for (const close of closers.splice(0)) await close();
  forgetFieldGroupStorageNames();
  vi.unstubAllEnvs();
  _resetEnvCache();
  setNonInteractive(false);
  rmSync(dir, { recursive: true, force: true });
});

/** A database of this test's own, which the commands reach through `DATABASE_URL`. */
async function openDatabase(dialect: TestDialect): Promise<string> {
  let url: string;
  if (dialect === "sqlite") {
    url = `file:${join(dir, "app.db")}`;
  } else {
    const scratch = await createScratchDatabase(dialect, "nextly_fg_history");
    url = scratch.url;
    closers.push(() => scratch.drop());
  }
  vi.stubEnv("DB_DIALECT", dialect);
  vi.stubEnv("DATABASE_URL", url);
  _resetEnvCache();
  return url;
}

/** An adapter of the test's own on the database at `url`. */
async function connect(
  dialect: TestDialect,
  url: string
): Promise<DrizzleAdapter> {
  const adapter = (await createAdapter({
    type: dialect,
    url,
  } as Parameters<typeof createAdapter>[0])) as unknown as DrizzleAdapter;
  closers.unshift(() => adapter.disconnect().catch(() => {}));
  return adapter;
}

/** Start the app over the database at `url`, declaring `declared`. */
async function start(
  dialect: TestDialect,
  url: string,
  declared: typeof FIRST
): Promise<TestNextly> {
  await shutdownServices().catch(() => {});
  clearServices();
  forgetFieldGroupStorageNames();
  return createTestNextly({
    adapter: (await connect(dialect, url)) as never,
    ...declared,
  });
}

function command(): { context: CommandContext; said: string[] } {
  const said: string[] = [];
  const capture = (message: string) => {
    said.push(message);
  };
  return {
    context: {
      logger: {
        ...SILENT,
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

/**
 * Run `fn`, turning `process.exit` into a thrown `exit <code>`, and say what it said: a refusal
 * the command throws rather than prints is part of what it said.
 */
async function run(
  fn: (context: CommandContext) => Promise<void>
): Promise<{ exit: number | undefined; said: string }> {
  const { context, said } = command();
  const exit = vi.spyOn(process, "exit").mockImplementation(code => {
    throw new Error(`exit ${String(code)}`);
  });
  // A refusal is printed in the error shape, on standard error rather than through the logger.
  const printed = vi
    .spyOn(process.stderr, "write")
    .mockImplementation(chunk => {
      said.push(String(chunk));
      return true;
    });
  const logged = vi.spyOn(console, "error").mockImplementation((...parts) => {
    said.push(parts.map(String).join(" "));
  });
  try {
    await fn(context);
    return { exit: undefined, said: said.join("\n") };
  } catch (error) {
    const match = /^exit (\d+)$/.exec((error as Error).message);
    if (match) return { exit: Number(match[1]), said: said.join("\n") };
    return { exit: -1, said: [...said, String(error)].join("\n") };
  } finally {
    exit.mockRestore();
    printed.mockRestore();
    logged.mockRestore();
    forgetFieldGroupStorageNames();
  }
}

/** `migrate:create`, non-interactively, with the given options. */
function create(
  name: string | undefined,
  options: Record<string, unknown> = {}
) {
  setNonInteractive(true);
  return run(context =>
    runMigrateCreate(
      name,
      { cwd: dir, ...options } as Parameters<typeof runMigrateCreate>[1],
      context
    )
  );
}

const migrate = () => run(context => runMigrate({ cwd: dir }, context));
const check = () =>
  run(context =>
    runMigrateCheck(
      { cwd: dir } as Parameters<typeof runMigrateCheck>[0],
      context
    )
  );

/** The files a run wrote, by name: `<name>.sql` and its snapshot. */
function written(name: string): { sql: string; snapshot: string } {
  const sql = readdirSync(join(dir, "migrations")).find(f =>
    f.endsWith(`_${name}.sql`)
  );
  if (sql === undefined) throw new Error(`no migration named ${name}`);
  return {
    sql: join(dir, "migrations", sql),
    snapshot: join(
      dir,
      "migrations",
      "meta",
      sql.replace(/\.sql$/, ".snapshot.json")
    ),
  };
}

/**
 * `nextly migrate:field-groups --apply --backup-confirmed`, on the database at `url`, through a
 * started app's adapter, whose schema registry holds every table the migration rewrites.
 */
async function migrateStorage(
  dialect: TestDialect,
  url: string
): Promise<void> {
  const app = await start(dialect, url, FIRST);
  const outcome = await runFieldGroupMigration({
    adapter: app.adapter as never,
    logger: SILENT as never,
    direction: "up",
    dryRun: false,
    // The test creates and drops this database itself.
    backupConfirmed: true,
  });
  forgetFieldGroupStorageNames();
  await shutdownServices().catch(() => {});
  expect(outcome).toMatchObject({ ran: true });
}

/** The files the ledger records applied, by file name. */
async function appliedNames(
  dialect: TestDialect,
  adapter: DrizzleAdapter
): Promise<string[]> {
  const q = (name: string) =>
    dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
  const rows = (await adapter.executeQuery(
    `SELECT ${q("filename")} AS filename FROM ${q("nextly_schema_events")} WHERE ${q("event_type")} = 'file_apply' AND ${q("status")} = 'applied'`
  )) as Array<{ filename: string }>;
  return rows.map(row => row.filename).sort();
}

describe.each(getConfiguredTestDialects())(
  "a migration history moving to the current field-group names (%s)",
  dialect => {
    /** A project on the legacy names with one post, its history applied. */
    async function legacyProject(): Promise<string> {
      const url = await openDatabase(dialect);
      loaded.config = configOf(FIRST);
      expect((await create("init")).exit).toBeUndefined();
      const applied = await migrate();
      expect(applied.exit, applied.said).toBeUndefined();
      const app = await start(dialect, url, FIRST);
      await app.nextly.create({
        collection: "fh_posts" as never,
        data: { title: "P", card: { heading: "H" } } as never,
      });
      await shutdownServices().catch(() => {});
      return url;
    }

    it("writes the transition with no statement, records it on a migrated database, and every later file follows the current names", async () => {
      const url = await legacyProject();
      await migrateStorage(dialect, url);

      const moved = await create(undefined, { fieldGroupNames: "current" });
      expect(moved.exit, moved.said).toBeUndefined();
      const transition = written("field_group_current_names");
      const sections = parseSqlSections(
        await readFile(transition.sql, "utf-8")
      );
      // No statement in UP: the storage moves through `migrate:field-groups` alone.
      expect(
        sections.upSql
          .split("\n")
          .map(line => line.trim())
          .filter(line => line !== "" && !line.startsWith("--"))
      ).toEqual([]);
      const snapshot = JSON.parse(
        await readFile(transition.snapshot, "utf-8")
      ) as {
        version: number;
        fieldGroupStorage?: string;
        snapshot: {
          tables: Array<{ name: string; columns: { name: string }[] }>;
        };
      };
      expect(snapshot).toMatchObject({
        version: 2,
        fieldGroupStorage: "current",
      });
      const card = snapshot.snapshot.tables.find(t => t.name === "fg_fh_card");
      expect(card?.columns.map(c => c.name)).toContain("_field_group_type");
      expect(snapshot.snapshot.tables.map(t => t.name)).not.toContain(
        "comp_fh_card"
      );

      const applied = await migrate();
      expect(applied.exit, applied.said).toBeUndefined();
      const adapter = await connect(dialect, url);
      expect(
        (await appliedNames(dialect, adapter)).some(name =>
          name.includes("_field_group_current_names")
        )
      ).toBe(true);

      // Offline, the history and the config agree: no drift, though the first file's own DOWN
      // still names the legacy table it created.
      const checked = await check();
      expect(checked.exit, checked.said).toBeUndefined();
      expect(checked.said).toMatch(/no drift/);

      // A code-first edit after the move is planned against the current names.
      loaded.config = configOf(WITH_SUBTITLE);
      const edit = await create("add_subtitle");
      expect(edit.exit, edit.said).toBeUndefined();
      const editSql = await readFile(written("add_subtitle").sql, "utf-8");
      expect(editSql).toMatch(/fg_fh_card/);
      expect(editSql).not.toMatch(/comp_fh_card/);
      const after = await migrate();
      expect(after.exit, after.said).toBeUndefined();

      const app = await start(dialect, url, WITH_SUBTITLE);
      const [post] = (
        await app.nextly.find({ collection: "fh_posts" as never })
      ).items as Array<{ card?: { heading?: string; subtitle?: unknown } }>;
      expect(post.card?.heading).toBe("H");
    });

    it("refuses the transition on a database whose field groups have not moved, and records nothing", async () => {
      const url = await legacyProject();

      const moved = await create(undefined, { fieldGroupNames: "current" });
      expect(moved.exit, moved.said).toBeUndefined();
      const refused = await migrate();

      expect(refused.exit).not.toBeUndefined();
      expect(refused.said).toMatch(
        /nextly migrate:field-groups --apply --backup-confirmed/
      );
      const adapter = await connect(dialect, url);
      expect(
        (await appliedNames(dialect, adapter)).some(name =>
          name.includes("_field_group_current_names")
        )
      ).toBe(false);
    });

    it("names the step a migrated database behind a legacy history needs, rather than every table as missing", async () => {
      const url = await legacyProject();
      await migrateStorage(dialect, url);

      const refused = await migrate();

      expect(refused.exit).not.toBeUndefined();
      expect(refused.said).toMatch(
        /nextly migrate:create --field-group-names=current/
      );
      expect(refused.said).not.toMatch(/table comp_fh_card/);
    });

    it("refuses the transition while the config has another change to migrate, before writing anything", async () => {
      await legacyProject();
      loaded.config = configOf(WITH_SUBTITLE);

      const moved = await create(undefined, { fieldGroupNames: "current" });

      expect(moved.exit, moved.said).not.toBeUndefined();
      expect(moved.said).toMatch(/changes to "comp_fh_card"/);
      expect(
        readdirSync(join(dir, "migrations")).filter(f =>
          f.endsWith("_field_group_current_names.sql")
        )
      ).toEqual([]);
    });
  }
);
