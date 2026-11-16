/**
 * Migrations at start (`db.runMigrationsOnBoot`) do at a production start what
 * `nextly migrate` does, and are the start's only writer of bookkeeping or
 * schema, on every configured dialect.
 *
 * Each case sets two databases up from the same migration files: one by
 * `nextly migrate` followed by a plain production start, as a deploy that
 * runs the command does, and one by a production start with migrations at
 * start turned on. The commands run for real (`runMigrateCreate`,
 * `runMigrate`); only the config file is not read from disk. Every statement
 * of the start is recorded at the driver (`record-statements`), the ones sent
 * from inside the migrations at start labelled by an AsyncLocalStorage store
 * the recorder reads, and the work after the start labelled the same way.
 *
 * - Against an empty database: the step sets it up as `nextly migrate` does,
 *   the ledger's record of the core schema included, and the start goes on.
 *   Nothing outside the step creates a table or takes a lock.
 * - Against a database behind the configuration, one migration pending: the
 *   step applies it, and the database matches the command's.
 * - In both, no write outside the step but the start's own: the setup token,
 *   SQLite's journal mode, and the work after the start.
 * - A migration that drops one of the app's permissions: the step marks it
 *   orphaned, as the command does.
 * - A field newly translated over a leftover translations column that cannot
 *   hold it: the step refuses it before the registry records the field, as
 *   the command does, and the start goes on.
 * - A migration that deletes data: refused without consent, applied under
 *   `NEXTLY_ACCEPT_DATA_LOSS` naming the table, as the command reads it.
 * - A first run whose migrations an earlier release wrote: the start gives
 *   its notice once, and a later `nextly migrate` gives none.
 * - A permission the configuration declares and no migration records: the
 *   start refuses it with the command's code.
 * - An older build, against a database a newer build migrated: the step
 *   writes nothing, a warning names the migration the build lacks, and the
 *   start goes on and serves what the database holds.
 */

// Set before anything reads it (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

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

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createScratchDatabase } from "../../__tests__/helpers/fresh-database";
import {
  recordStatements,
  type RecordedStatement,
} from "../../__tests__/helpers/record-statements";
import type { CommandContext } from "../../cli/program";
import type { mergeSetupResultIntoConfig as MergeSetupResultIntoConfig } from "../../cli/utils/config-loader";
import { createLogger } from "../../cli/utils/logger";
import { runMigrate } from "../../cli/commands/migrate";
import { runMigrateCreate } from "../../cli/commands/migrate-create";
import { defineCollection, defineConfig, text } from "../../config";
import { createAdapter } from "../../database/factory";
import { shutdownServices } from "../../di/register";
import { _resetPerLanguageStorage } from "../../domains/i18n/per-language-storage";
import { setNonInteractive } from "../../domains/schema/migrate/can-prompt";
import { getNextly, shutdownNextly, startSettled } from "../../init";
import {
  getConfiguredTestDialects,
  type TestDialect,
} from "../../plugins/test-nextly";
import { resetDispatcherForTests } from "../../route-handler/auth-handler";
import { _resetEnvCache } from "../../shared/lib/env";
import { sanitizeConfig } from "../../shared/types/config";
import { _resetBootMigrationsGateForTest } from "../boot-migrations-gate";

type LoadedConfig = Parameters<typeof MergeSetupResultIntoConfig>[0];

/** The config the commands load, and the folder they run in. */
const state = vi.hoisted(() => ({ config: undefined as unknown, dir: "" }));

/** Which step a statement was sent from, where it is not the start's own. */
const sentFrom = vi.hoisted(() => {
  const { AsyncLocalStorage } = process.getBuiltinModule(
    "node:async_hooks"
  ) as typeof import("node:async_hooks");
  return new AsyncLocalStorage<"migrations at start" | "after the start">();
});

vi.mock("../prod-migrations", async original => {
  const actual = await original<typeof import("../prod-migrations")>();
  return {
    ...actual,
    runProdMigrationsIfEnabled: (
      ...args: Parameters<typeof actual.runProdMigrationsIfEnabled>
    ) =>
      sentFrom.run("migrations at start", () =>
        actual.runProdMigrationsIfEnabled(...args)
      ),
  };
});
vi.mock("../post-init-tasks", async original => {
  const actual = await original<typeof import("../post-init-tasks")>();
  return {
    ...actual,
    runPostInitTasks: () =>
      sentFrom.run("after the start", () => actual.runPostInitTasks()),
  };
});

vi.mock("../../cli/utils/config-loader", async importOriginal => {
  const original =
    await importOriginal<typeof import("../../cli/utils/config-loader")>();
  return {
    ...original,
    loadConfig: async () => {
      const config = state.config as LoadedConfig;
      const merged = original.mergeSetupResultIntoConfig(
        config,
        config,
        config.plugins ?? []
      );
      // As the real loader does.
      const { adoptPerLanguageStorage } = await import(
        "../../domains/i18n/per-language-storage"
      );
      adoptPerLanguageStorage(merged.perLanguageStorage);
      return {
        config: merged,
        appConfig: config,
        pluginConsent: undefined,
        projectRoot: state.dir,
        dependencies: [],
      };
    },
  };
});

const POSTS = defineCollection({
  slug: "mas-posts",
  access: { read: () => true },
  fields: [text({ name: "title" })],
});
/** Declared by the newer configuration only. */
const ADDED = defineCollection({
  slug: "mas-added",
  access: { read: () => true },
  fields: [text({ name: "title" })],
});

/**
 * A statement that changes the database, and the table it names: rows,
 * structure, or SQLite's journal mode, which the file keeps.
 */
const WRITE =
  /^\s*(?:insert\s+(?:or\s+\w+\s+)?into|replace\s+into|update|delete\s+from|alter\s+table|create\s+(?:unique\s+)?(?:table|index|schema)(?:\s+if\s+not\s+exists)?|drop\s+(?:table|index)(?:\s+if\s+exists)?|truncate(?:\s+table)?)\s+(?:[`"]?\w+[`"]?\.)?[`"]?(\w+)[`"]?|^\s*pragma\s+(?:main\.)?(journal_mode)\s*=/i;

/** The table `call` writes (or `journal_mode`), or undefined when it writes nothing. */
function writtenTable(call: RecordedStatement): string | undefined {
  const match = WRITE.exec(call.text);
  return (match?.[1] ?? match?.[2])?.toLowerCase();
}

/** The setup token's key among the meta rows. */
const SETUP_TOKEN_KEY = "auth.setup-token";

/**
 * Whether `call` is one of the start's own writes outside the migrations at
 * start: the setup token, SQLite's journal mode, or the work after the start
 * (the email templates' reconciliation, with its media usage and meta rows,
 * and on SQLite the timestamp repair's meta row).
 */
function isStartsOwnWrite(call: RecordedStatement): boolean {
  if (call.context === "after the start") return true;
  const table = writtenTable(call);
  if (table === "journal_mode") return true;
  if (table === "nextly_meta") {
    return [call.text, ...call.values.map(String)].some(part =>
      part.includes(SETUP_TOKEN_KEY)
    );
  }
  return false;
}

/** `call`, short enough to read in a failure. */
const shown = (call: RecordedStatement): string =>
  call.text.replace(/\s+/g, " ").slice(0, 120);

/** The writes outside the migrations at start that are not the start's own. */
function writesOutsideTheStep(calls: readonly RecordedStatement[]): string[] {
  return calls
    .filter(
      call =>
        call.context !== "migrations at start" &&
        writtenTable(call) !== undefined &&
        !isStartsOwnWrite(call)
    )
    .map(shown);
}

describe.each(getConfiguredTestDialects())(
  "migrations at start do what nextly migrate does (%s)",
  (dialect: TestDialect) => {
    let drops: Array<() => Promise<void>> = [];
    let databases = 0;
    let clock = 0;

    beforeEach(() => {
      state.dir = mkdtempSync(join(tmpdir(), "nextly-migrations-at-start-"));
      mkdirSync(join(state.dir, "migrations"));
      drops = [];
      databases = 0;
      vi.stubEnv("DB_DIALECT", dialect);
      // Which a production start requires before it opens the database.
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
      vi.stubEnv("NODE_ENV", "test");
      _resetEnvCache();
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(Date.UTC(2026, 10, 16, 12, 0, 0, 0)));
    });

    afterEach(async () => {
      await shutdownNextly();
      await shutdownServices();
      resetDispatcherForTests();
      _resetPerLanguageStorage();
      _resetBootMigrationsGateForTest();
      vi.useRealTimers();
      vi.unstubAllEnvs();
      _resetEnvCache();
      for (const drop of drops) await drop().catch(() => undefined);
      rmSync(state.dir, { recursive: true, force: true });
    }, 60_000);

    /** A new, empty database of this dialect, and its address. */
    async function emptyDatabase(): Promise<string> {
      databases += 1;
      if (dialect === "sqlite") {
        return `file:${join(state.dir, `db${databases}.db`)}`;
      }
      const scratch = await createScratchDatabase(dialect, "nextly_mas");
      drops.push(scratch.drop);
      return scratch.url;
    }

    /** Point the commands and the start at `url`. */
    function use(url: string): void {
      vi.stubEnv("DATABASE_URL", url);
      _resetEnvCache();
    }

    function tick(): void {
      clock += 1;
      vi.setSystemTime(new Date(Date.UTC(2026, 10, 16, 12, 0, clock, 0)));
    }

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
          cwd: state.dir,
        } as CommandContext,
        said,
      };
    }

    async function exiting(
      fn: () => Promise<void>
    ): Promise<number | undefined> {
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

    /** `nextly migrate:create`, which must succeed. */
    async function migrateCreate(
      name: string,
      config: unknown,
      // Where nobody can be asked, a file that drops a table is written only
      // under consent naming it, as `--accept-data-loss` gives it.
      consent: { acceptDataLoss?: string } = {}
    ): Promise<void> {
      state.config = config;
      tick();
      const { context, said } = command();
      setNonInteractive(true);
      const code = await exiting(() =>
        runMigrateCreate(name, { cwd: state.dir, ...consent }, context)
      ).finally(() => setNonInteractive(false));
      expect(code, said.join("\n")).toBeUndefined();
    }

    /** `nextly migrate` against `url`: its exit code and what it said. */
    async function migrateRun(
      url: string,
      config: unknown
    ): Promise<{ code: number | undefined; said: string }> {
      use(url);
      state.config = config;
      tick();
      const { context, said } = command();
      // A refusal ends in the CLI's error shape, which goes to standard
      // error through `console.error`, not through the logger.
      const stderr = vi
        .spyOn(console, "error")
        .mockImplementation((...parts: unknown[]) => {
          said.push(parts.map(String).join(" "));
        });
      try {
        const code = await exiting(() =>
          runMigrate({ cwd: state.dir }, context)
        );
        return { code, said: said.join("\n") };
      } finally {
        stderr.mockRestore();
      }
    }

    /** `nextly migrate` against `url`, which must succeed. */
    async function migrate(url: string, config: unknown): Promise<void> {
      const { code, said } = await migrateRun(url, config);
      expect(code, said).toBeUndefined();
    }

    /** `collections`, migrated at start from the test's migrations folder. */
    function migratedAtStart(...collections: (typeof POSTS)[]) {
      return defineConfig({
        collections,
        db: {
          migrationsDir: join(state.dir, "migrations"),
          runMigrationsOnBoot: true,
        },
      });
    }

    /** `collections`, as a deploy that runs `nextly migrate` configures them. */
    function migratedByCommand(...collections: (typeof POSTS)[]) {
      return defineConfig({
        collections,
        db: { migrationsDir: "./migrations" },
      });
    }

    async function open(url: string): Promise<DrizzleAdapter> {
      return (await createAdapter({ type: dialect, url } as Parameters<
        typeof createAdapter
      >[0])) as unknown as DrizzleAdapter;
    }

    async function rowsOf(
      adapter: DrizzleAdapter,
      sql: string
    ): Promise<Record<string, unknown>[]> {
      const result = (await adapter.executeQuery(sql)) as unknown;
      if (Array.isArray(result)) return result as Record<string, unknown>[];
      return ((result as { rows?: unknown[] }).rows ?? []) as Record<
        string,
        unknown
      >[];
    }

    /** A column of `row` whatever case the dialect returned its name in. */
    function field(row: Record<string, unknown>, name: string): unknown {
      return row[name] ?? row[name.toUpperCase()];
    }

    /**
     * What a database holds, as far as a deploy can tell two apart: every
     * table with its columns and its row count, the registry rows, the
     * permissions, the roles and their grants, and the ledger's records.
     * Values that differ on every run (ids, times, the setup token) are left
     * out.
     */
    async function contents(url: string): Promise<Record<string, unknown>> {
      const adapter = await open(url);
      try {
        const q = dialect === "mysql" ? "`" : '"';
        const columns =
          dialect === "sqlite"
            ? await rowsOf(
                adapter,
                "SELECT m.name AS t, p.name AS c FROM sqlite_master m JOIN pragma_table_info(m.name) p WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite_%'"
              )
            : await rowsOf(
                adapter,
                `SELECT table_name AS t, column_name AS c FROM information_schema.columns WHERE table_schema = ${dialect === "postgresql" ? "current_schema()" : "DATABASE()"}`
              );
        const tables = new Map<string, string[]>();
        for (const row of columns) {
          const table = String(field(row, "t"));
          tables.set(table, [
            ...(tables.get(table) ?? []),
            String(field(row, "c")),
          ]);
        }
        const out: Record<string, unknown> = {};
        for (const [table, cols] of [...tables.entries()].sort()) {
          const [count] = await rowsOf(
            adapter,
            `SELECT COUNT(*) AS n FROM ${q}${table}${q}`
          );
          out[table] = {
            columns: [...cols].sort(),
            rows: Number(field(count ?? {}, "n")),
          };
        }
        out["registry"] = (
          await rowsOf(
            adapter,
            "SELECT slug, table_name, migration_status FROM dynamic_collections ORDER BY slug"
          )
        ).map(row => [
          field(row, "slug"),
          field(row, "table_name"),
          field(row, "migration_status"),
        ]);
        // Each with its orphan mark, set when an applied migration stops
        // declaring it.
        out["permissions"] = (
          await rowsOf(
            adapter,
            "SELECT slug, orphaned_at FROM permissions ORDER BY slug"
          )
        ).map(
          row =>
            `${String(field(row, "slug"))}${field(row, "orphaned_at") == null ? "" : " (orphaned)"}`
        );
        out["grants"] = (
          await rowsOf(
            adapter,
            "SELECT r.slug AS role, p.slug AS permission FROM role_permissions rp JOIN roles r ON r.id = rp.role_id JOIN permissions p ON p.id = rp.permission_id ORDER BY r.slug, p.slug"
          )
        ).map(
          row =>
            `${String(field(row, "role"))}:${String(field(row, "permission"))}`
        );
        out["ledger"] = (
          await rowsOf(
            adapter,
            "SELECT event_type, scope_kind, filename, status FROM nextly_schema_events"
          )
        )
          .map(row =>
            [
              field(row, "event_type"),
              field(row, "scope_kind"),
              field(row, "filename"),
              field(row, "status"),
            ]
              .map(String)
              .join(" ")
          )
          .sort();
        out["meta keys"] = (
          await rowsOf(adapter, `SELECT ${q}key${q} AS k FROM nextly_meta`)
        )
          .map(row => String(field(row, "k")))
          .sort();
        return out;
      } finally {
        await adapter.disconnect().catch(() => undefined);
      }
    }

    /**
     * One production start of `config` against `url` by the Direct API,
     * recorded until it and the work it leaves running have settled, then a
     * read of `read` through it. The warnings it logged are kept.
     */
    async function productionStart(
      url: string,
      config: unknown,
      /** A collection to read through the started app, where it has a table. */
      read?: string
    ): Promise<{
      calls: RecordedStatement[];
      warnings: string[];
      /** Every line the start logged, at any level. */
      logged: string[];
      refusal?: unknown;
    }> {
      use(url);
      vi.stubEnv("NODE_ENV", "production");
      _resetEnvCache();
      // Only to find the driver: the recorder patches its prototypes, so the
      // start's own connections are recorded too. On SQLite an in-memory one,
      // since opening the test's file would create it.
      const host = await open(dialect === "sqlite" ? "file::memory:" : url);
      const recorder = await recordStatements(host, dialect, {
        context: () => sentFrom.getStore(),
      });
      const warnings: string[] = [];
      const logged: string[] = [];
      const spies = (["log", "info", "warn", "error"] as const).map(level =>
        vi.spyOn(console, level).mockImplementation((...parts: unknown[]) => {
          const line = parts.map(String).join(" ");
          logged.push(line);
          if (level === "warn" || level === "error") warnings.push(line);
        })
      );
      try {
        const nextly = await getNextly({
          config: sanitizeConfig(config as never) as never,
        });
        await startSettled();
        if (read !== undefined) await nextly.find({ collection: read });
        return { calls: [...recorder.calls], warnings, logged };
      } catch (refusal) {
        return { calls: [...recorder.calls], warnings, logged, refusal };
      } finally {
        for (const spy of spies) spy.mockRestore();
        recorder.uninstall();
        await host.disconnect().catch(() => undefined);
        await shutdownNextly();
        await shutdownServices();
        resetDispatcherForTests();
        vi.stubEnv("NODE_ENV", "test");
        _resetEnvCache();
      }
    }

    it("sets an empty database up as nextly migrate does, and the start goes on", async () => {
      const viaStart = await emptyDatabase();
      const viaCommand = await emptyDatabase();
      use(viaCommand);
      await migrateCreate("initial", migratedAtStart(POSTS));

      const started = await productionStart(
        viaStart,
        migratedAtStart(POSTS),
        "mas-posts"
      );
      await migrate(viaCommand, migratedByCommand(POSTS));
      const plain = await productionStart(
        viaCommand,
        migratedByCommand(POSTS),
        "mas-posts"
      );

      expect(started.refusal).toBeUndefined();
      expect(plain.refusal).toBeUndefined();
      expect(
        started.calls.some(call => call.context === "migrations at start"),
        "the migrations at start ran"
      ).toBe(true);
      expect(writesOutsideTheStep(started.calls)).toEqual([]);
      expect(await contents(viaStart)).toEqual(await contents(viaCommand));
      // Nothing told the operator to run a command the start has just run.
      expect(
        started.warnings.filter(line => line.includes("Run `nextly migrate`"))
      ).toEqual([]);
    }, 600_000);

    it("applies a pending migration as nextly migrate does", async () => {
      const viaStart = await emptyDatabase();
      const viaCommand = await emptyDatabase();
      use(viaCommand);
      await migrateCreate("initial", migratedAtStart(POSTS));
      await migrate(viaStart, migratedByCommand(POSTS));
      await migrate(viaCommand, migratedByCommand(POSTS));
      await migrateCreate("added", migratedAtStart(POSTS, ADDED));

      const started = await productionStart(
        viaStart,
        migratedAtStart(POSTS, ADDED),
        "mas-added"
      );
      await migrate(viaCommand, migratedByCommand(POSTS, ADDED));
      const plain = await productionStart(
        viaCommand,
        migratedByCommand(POSTS, ADDED),
        "mas-added"
      );

      expect(started.refusal).toBeUndefined();
      expect(plain.refusal).toBeUndefined();
      expect(writesOutsideTheStep(started.calls)).toEqual([]);
      expect(await contents(viaStart)).toEqual(await contents(viaCommand));
      expect(
        started.warnings.filter(line => line.includes("Run `nextly migrate`"))
      ).toEqual([]);
    }, 600_000);

    it("orphans a permission an applied migration drops, as nextly migrate does", async () => {
      // The app's own permission, declared and then dropped by a recorded
      // migration: no table goes, so no data-loss consent is involved.
      const withExport = (atStart: boolean, exports: boolean) =>
        defineConfig({
          collections: [POSTS],
          permissions: exports
            ? [{ action: "export", resource: "mas-posts" }]
            : [],
          db: atStart
            ? {
                migrationsDir: join(state.dir, "migrations"),
                runMigrationsOnBoot: true,
              }
            : { migrationsDir: "./migrations" },
        });
      const viaStart = await emptyDatabase();
      const viaCommand = await emptyDatabase();
      use(viaCommand);
      await migrateCreate("initial", withExport(true, true));
      await migrate(viaStart, withExport(false, true));
      await migrate(viaCommand, withExport(false, true));
      await migrateCreate("dropped", withExport(true, false));

      const started = await productionStart(
        viaStart,
        withExport(true, false),
        "mas-posts"
      );
      await migrate(viaCommand, withExport(false, false));

      expect(started.refusal).toBeUndefined();
      const command = await contents(viaCommand);
      // The control: the command marks it, so there is a mark to compare.
      expect(command["permissions"]).toContain("export-mas-posts (orphaned)");
      expect((await contents(viaStart))["permissions"]).toEqual(
        command["permissions"]
      );
    }, 600_000);

    it("applies a migration that deletes data only under NEXTLY_ACCEPT_DATA_LOSS, as nextly migrate does", async () => {
      const viaStart = await emptyDatabase();
      const viaCommand = await emptyDatabase();
      use(viaCommand);
      await migrateCreate("initial", migratedAtStart(POSTS, ADDED));
      await migrate(viaStart, migratedByCommand(POSTS, ADDED));
      await migrate(viaCommand, migratedByCommand(POSTS, ADDED));
      await migrateCreate("dropped", migratedAtStart(POSTS), {
        acceptDataLoss: "dc_mas_added",
      });
      const tableThere = async (url: string): Promise<boolean> => {
        const adapter = await open(url);
        try {
          return await adapter.tableExists("dc_mas_added");
        } finally {
          await adapter.disconnect().catch(() => undefined);
        }
      };

      // Without consent the start refuses the file, as the command does, and
      // goes on: the table and its rows stay.
      const refused = await productionStart(
        viaStart,
        migratedAtStart(POSTS),
        "mas-posts"
      );
      expect(refused.refusal).toBeUndefined();
      expect(refused.warnings.join("\n")).toMatch(
        // The refusal's reason, which the start logs with its context.
        /data-loss-needs-consent/
      );
      expect(await tableThere(viaStart)).toBe(true);

      // With consent for the table, from the same variable the command reads.
      vi.stubEnv("NEXTLY_ACCEPT_DATA_LOSS", "dc_mas_added");
      const applied = await productionStart(
        viaStart,
        migratedAtStart(POSTS),
        "mas-posts"
      );
      await migrate(viaCommand, migratedByCommand(POSTS));
      await productionStart(viaCommand, migratedByCommand(POSTS), "mas-posts");

      expect(applied.refusal).toBeUndefined();
      expect(await tableThere(viaStart)).toBe(false);
      expect(await contents(viaStart)).toEqual(await contents(viaCommand));
    }, 600_000);

    it("refuses a field newly translated over a column that cannot hold it, as nextly migrate does", async () => {
      const slug = "mas-french";
      const companion = "dc_mas_french_locales";
      const q = (name: string) =>
        dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
      const translated = (code: boolean) =>
        defineConfig({
          localization: { locales: ["en", "fr"], defaultLocale: "en" },
          collections: [
            defineCollection({
              slug,
              localized: true,
              fields: [
                { name: "title", type: "text", localized: true },
                ...(code
                  ? [{ name: "code", type: "text", localized: true }]
                  : []),
              ] as never,
            }),
          ],
          db: {
            migrationsDir: join(state.dir, "migrations"),
            runMigrationsOnBoot: true,
          },
        });
      const refusal =
        /column \\?"code\\?" \(.+\) that cannot hold every value code allows/;
      const viaStart = await emptyDatabase();
      const viaCommand = await emptyDatabase();
      use(viaCommand);
      await migrateCreate("initial", translated(false));
      /** The registry's fields for the collection on `url`, after `run`. */
      const fieldsOf = async (url: string): Promise<unknown> => {
        const adapter = await open(url);
        try {
          const [row] = await rowsOf(
            adapter,
            `SELECT ${q("fields")} AS f FROM ${q("dynamic_collections")} WHERE ${q("slug")} = '${slug}'`
          );
          const value = field(row ?? {}, "f");
          return typeof value === "string" ? JSON.parse(value) : value;
        } finally {
          await adapter.disconnect().catch(() => undefined);
        }
      };
      for (const url of [viaStart, viaCommand]) {
        await migrate(url, translated(false));
        // Another field's leftover in the translations table, of a type the
        // newly translated text field does not fit.
        const adapter = await open(url);
        try {
          await adapter.executeQuery(
            `ALTER TABLE ${q(companion)} ADD COLUMN ${q("code")} INTEGER`
          );
        } finally {
          await adapter.disconnect().catch(() => undefined);
        }
      }
      const before = await fieldsOf(viaStart);
      await migrateCreate("code", translated(true));

      const started = await productionStart(viaStart, translated(true), slug);
      const command = await migrateRun(viaCommand, translated(true));

      // The control: the command refuses it, keeping the registry.
      expect(command.code).toBe(1);
      expect(command.said).toMatch(refusal);
      expect(await fieldsOf(viaCommand)).toEqual(before);
      // The start refuses it the same way, logs it, and goes on.
      expect(started.refusal).toBeUndefined();
      expect(started.warnings.join("\n")).toMatch(refusal);
      expect(await fieldsOf(viaStart)).toEqual(before);
    }, 600_000);

    it("gives the first run's notice once, at the start, and nextly migrate gives none after it", async () => {
      // A migration an earlier release's `migrate:create` wrote: its snapshot
      // carries no registry metadata, so the first run on this release writes
      // the registry rows from the configuration and says so, once; the record
      // it writes in the same commit makes every later run an ordinary one.
      const database = await emptyDatabase();
      use(database);
      await migrateCreate("initial", migratedAtStart(POSTS));
      const meta = join(state.dir, "migrations", "meta");
      for (const file of readdirSync(meta)) {
        if (!file.endsWith(".snapshot.json")) continue;
        const path = join(meta, file);
        const snapshot = JSON.parse(readFileSync(path, "utf-8")) as Record<
          string,
          unknown
        >;
        delete snapshot.entities;
        delete snapshot.permissions;
        writeFileSync(path, JSON.stringify(snapshot, null, 2));
      }
      const notice = /First run on this release/;

      const started = await productionStart(
        database,
        migratedAtStart(POSTS),
        "mas-posts"
      );
      const later = await migrateRun(database, migratedByCommand(POSTS));

      expect(started.refusal).toBeUndefined();
      expect(
        started.logged.filter(line => notice.test(line)),
        started.logged.join("\n")
      ).toHaveLength(1);
      expect(later.code, later.said).toBeUndefined();
      expect(later.said).not.toMatch(notice);
      // As `nextly migrate` does, the first run writes the permissions, roles
      // and preset grants in the one transaction that writes the registry rows
      // and the record, so a stop anywhere before it commits keeps none.
      const calls = started.calls;
      const recordAt = calls.findIndex(
        call =>
          writtenTable(call) === "nextly_meta" &&
          [call.text, ...call.values.map(String)].some(part =>
            part.includes("registry_record")
          )
      );
      expect(recordAt, "the record was written").toBeGreaterThan(-1);
      const isBegin = (call: RecordedStatement) =>
        /^\s*(begin|start transaction)\b/i.test(call.text);
      const isCommit = (call: RecordedStatement) =>
        /^\s*commit\b/i.test(call.text);
      let begun = recordAt;
      while (begun >= 0 && !isBegin(calls[begun]!)) begun -= 1;
      let committed = recordAt;
      while (committed < calls.length && !isCommit(calls[committed]!)) {
        committed += 1;
      }
      const accessWrites = calls
        .map((call, at) => ({ call, table: writtenTable(call), at }))
        // Rows, not the core schema's own tables being made.
        .filter(
          ({ call, table }) =>
            /^\s*(insert|update|delete)\b/i.test(call.text) &&
            ["permissions", "roles", "role_permissions"].includes(table ?? "")
        )
        .map(({ table, at }) => ({ table, at }));
      expect(accessWrites.length, "the access was written").toBeGreaterThan(0);
      expect(
        accessWrites.filter(({ at }) => at < begun || at > committed)
      ).toEqual([]);
    }, 600_000);

    it("refuses a permission no migration records, as nextly migrate does", async () => {
      // The app's own permission, declared in the configuration after its
      // last migration was written: both paths compare the whole
      // configuration, permissions included, with the newest snapshot.
      const withExport = (atStart: boolean, exports: boolean) =>
        defineConfig({
          collections: [POSTS],
          permissions: exports
            ? [{ action: "export", resource: "mas-posts" }]
            : [],
          db: atStart
            ? {
                migrationsDir: join(state.dir, "migrations"),
                runMigrationsOnBoot: true,
              }
            : { migrationsDir: "./migrations" },
        });
      const viaStart = await emptyDatabase();
      const viaCommand = await emptyDatabase();
      use(viaCommand);
      await migrateCreate("initial", withExport(true, false));
      await migrate(viaStart, withExport(false, false));
      await migrate(viaCommand, withExport(false, false));

      const command = await migrateRun(viaCommand, withExport(false, true));
      const started = await productionStart(viaStart, withExport(true, true));

      // The control: the command refuses it, naming the permission.
      expect(command.code, command.said).not.toBeUndefined();
      expect(command.said).toMatch(
        /export[^\n]*mas-posts|mas-posts[^\n]*export/
      );
      // The start refuses it with the same code.
      const code = (started.refusal as { code?: string } | undefined)?.code;
      expect(code, started.logged.join("\n")).toBeDefined();
      expect(command.said).toContain(String(code));
    }, 600_000);

    it("writes nothing for an older build, names the migration it lacks, and starts", async () => {
      const database = await emptyDatabase();
      use(database);
      await migrateCreate("initial", migratedAtStart(POSTS));
      await migrateCreate("added", migratedAtStart(POSTS, ADDED));
      await migrate(database, migratedByCommand(POSTS, ADDED));
      // The newer build's start, once, as the deployment that migrated it.
      await productionStart(
        database,
        migratedByCommand(POSTS, ADDED),
        "mas-added"
      );
      // The older build's folder lacks the newer build's migration.
      const newer = readdirSync(join(state.dir, "migrations")).filter(name =>
        name.includes("added")
      );
      expect(newer.length, "the newer migration was written").toBeGreaterThan(
        0
      );
      for (const name of newer) {
        rmSync(join(state.dir, "migrations", name), {
          recursive: true,
          force: true,
        });
      }
      const before = await contents(database);

      const older = await productionStart(
        database,
        migratedAtStart(POSTS),
        "mas-posts"
      );

      expect(older.refusal).toBeUndefined();
      expect(
        older.calls
          .filter(call => call.context === "migrations at start")
          .filter(call => writtenTable(call) !== undefined)
          .map(shown)
      ).toEqual([]);
      expect(writesOutsideTheStep(older.calls)).toEqual([]);
      const named = older.warnings.filter(line =>
        newer.some(name => name.endsWith(".sql") && line.includes(name))
      );
      expect(named.length, older.warnings.join("\n")).toBeGreaterThan(0);
      expect(await contents(database)).toEqual(before);
    }, 600_000);
  }
);
