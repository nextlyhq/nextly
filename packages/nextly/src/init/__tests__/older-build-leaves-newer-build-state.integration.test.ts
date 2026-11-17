/**
 * An older build leaves what a newer build wrote exactly as it found it, on
 * every configured dialect: its production starts change nothing, and its
 * `nextly migrate` stops before it writes.
 *
 * One app, two builds, one database, through the real commands
 * (`migrate:create`, `migrate`, `plugins install`) and the real entry points
 * (`getNextly`, the route handlers); only the config file is not read from
 * disk.
 *
 * - The older build declares a collection with one field. It writes its
 *   migration, migrates and starts.
 * - The newer build adds a field to that collection and a plugin whose
 *   permission the admin role holds. It writes its migration, migrates,
 *   installs the plugin and starts.
 * - The older build, whose folder lacks the newer build's migration, then
 *   starts twice with migrations at start off and twice with them on, each
 *   pair begun once by the Direct API and once by a request. After each, the
 *   database is compared with a copy taken before the first: every table's
 *   columns and indexes, every row of every table, and where each
 *   generated key stands.
 * - The older build runs `nextly migrate`: it stops with exit code 3 naming
 *   the migration its folder lacks, and the database, the ledger included,
 *   still matches the copy.
 *
 * The comparison leaves nothing out. What a start may write of its own (the
 * setup token, the email templates' reconciliation, SQLite's one-time
 * timestamp repair) was written by the starts before the copy, and a later
 * start has none of it left to write.
 *
 * Three controls show the comparison sees a write. A row inserted into a
 * table with a generated key and deleted again leaves every row as it was
 * and the next key moved on, which the copy shows. A development start of the
 * older build, which still syncs the registry from its configuration, leaves
 * the collection's registry row different from the copy. And with the newer
 * build's files back in its folder and a migration of its own written, the
 * older build's `nextly migrate` goes ahead and the database differs.
 */

// Set before anything reads it (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createScratchDatabase } from "../../__tests__/helpers/fresh-database";
import { runMigrate } from "../../cli/commands/migrate";
import { runMigrateCreate } from "../../cli/commands/migrate-create";
import { runPluginInstall } from "../../cli/commands/plugin-lifecycle-runner";
import type { CommandContext } from "../../cli/program";
import type { mergeSetupResultIntoConfig as MergeSetupResultIntoConfig } from "../../cli/utils/config-loader";
import { createLogger } from "../../cli/utils/logger";
import { defineCollection, defineConfig, text } from "../../config";
import { createAdapter } from "../../database/factory";
import { shutdownServices } from "../../di/register";
import { _resetPerLanguageStorage } from "../../domains/i18n/per-language-storage";
import { setNonInteractive } from "../../domains/schema/migrate/can-prompt";
import { getNextly, shutdownNextly, startSettled } from "../../init";
import { definePlugin } from "../../plugins/plugin-context";
import {
  getConfiguredTestDialects,
  type TestDialect,
} from "../../plugins/test-nextly";
import { resetDispatcherForTests } from "../../route-handler/auth-handler";
import { createDynamicHandlers } from "../../routeHandler";
import { _resetEnvCache } from "../../shared/lib/env";
import { sanitizeConfig } from "../../shared/types/config";
import { _resetBootMigrationsGateForTest } from "../boot-migrations-gate";

type LoadedConfig = Parameters<typeof MergeSetupResultIntoConfig>[0];

/** The config the commands load, and the folder they run in. */
const state = vi.hoisted(() => ({ config: undefined as unknown, dir: "" }));

// The config as the loader returns it: the plugins' contributions folded in
// by the loader's own fold, as they reach the commands from a config file.
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

const SLUG = "obl-posts";
const PLUGIN_NAME = "@test/obl-forms";
/** The plugin's permission, as stored. */
const PLUGIN_PERMISSION = "export-obl-submissions";

/** Readable by anyone, so a request reads the entries as a visitor. */
const READABLE = { read: () => true };

/** The collection as the older build declares it. */
const POSTS_OLDER = defineCollection({
  slug: SLUG,
  access: READABLE,
  fields: [text({ name: "title" })],
});
/** The collection as the newer build declares it: one field more. */
const POSTS_NEWER = defineCollection({
  slug: SLUG,
  access: READABLE,
  fields: [text({ name: "title" }), text({ name: "summary" })],
});

/** The newer build's plugin: one permission, which the admin role holds. */
const PLUGIN = definePlugin({
  name: PLUGIN_NAME,
  version: "1.0.0",
  nextly: "*",
  contributes: {
    permissions: [{ action: "export", resource: "obl-submissions" }],
  },
});

/** The copy's entry for where the generated keys stand, beside the tables. */
const GENERATED_KEYS = "(generated keys)";

/** How a start is begun. */
type Entry = "the Direct API" | "a request";

/** What a database holds: each table's columns, indexes and rows. */
type Copy = Record<
  string,
  { columns: string[]; indexes: string[]; rows: string[] }
>;

describe.each(getConfiguredTestDialects())(
  "an older build leaves a newer build's state as it found it (%s)",
  (dialect: TestDialect) => {
    let url: string;
    let drop: () => Promise<void> = async () => {};
    let clock = 0;
    const q = dialect === "mysql" ? "`" : '"';

    beforeEach(async () => {
      state.dir = mkdtempSync(join(tmpdir(), "nextly-older-build-"));
      mkdirSync(join(state.dir, "migrations"));
      if (dialect === "sqlite") {
        url = `file:${join(state.dir, "app.db")}`;
        drop = async () => {};
      } else {
        const scratch = await createScratchDatabase(dialect, "nextly_obl");
        url = scratch.url;
        drop = () => scratch.drop();
      }
      // The commands, and a start begun by a request, open the database the
      // environment names.
      vi.stubEnv("DB_DIALECT", dialect);
      vi.stubEnv("DATABASE_URL", url);
      // Which a production start requires before it opens the database.
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
      vi.stubEnv("NODE_ENV", "test");
      _resetEnvCache();
      // Each migration file is named by the clock.
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(Date.UTC(2026, 10, 17, 12, 0, 0, 0)));
    }, 180_000);

    afterEach(async () => {
      await shutdownNextly();
      await shutdownServices();
      resetDispatcherForTests();
      _resetPerLanguageStorage();
      _resetBootMigrationsGateForTest();
      vi.useRealTimers();
      vi.unstubAllEnvs();
      _resetEnvCache();
      await drop().catch(() => undefined);
      drop = async () => {};
      rmSync(state.dir, { recursive: true, force: true });
    }, 60_000);

    function tick(): void {
      clock += 1;
      vi.setSystemTime(new Date(Date.UTC(2026, 10, 17, 12, 0, clock, 0)));
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
          cwd: state.dir,
        } as CommandContext,
        said,
      };
    }

    /** Run `fn`, turning `process.exit` into the code it was called with. */
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
      // Where nobody can be asked, a file that drops a column is written only
      // under consent naming its table, as `--accept-data-loss` gives it.
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

    /** `nextly migrate`: its exit code and what it said. */
    async function migrateRun(
      config: unknown
    ): Promise<{ code: number | undefined; said: string }> {
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

    /** `nextly migrate`, which must succeed. */
    async function migrate(config: unknown): Promise<void> {
      const { code, said } = await migrateRun(config);
      expect(code, said).toBeUndefined();
    }

    /** `nextly plugins install <name>`, which must succeed. */
    async function pluginInstall(name: string, config: unknown): Promise<void> {
      state.config = config;
      tick();
      const { context, said } = command();
      const code = await exiting(() =>
        runPluginInstall(name, { cwd: state.dir }, context)
      );
      expect(code, said.join("\n")).toBeUndefined();
    }

    /** The older build's configuration. */
    function older(migrationsAtStart = false) {
      return defineConfig({
        collections: [POSTS_OLDER],
        db: {
          migrationsDir: join(state.dir, "migrations"),
          runMigrationsOnBoot: migrationsAtStart,
        },
      });
    }

    /** The newer build's: the field and the plugin added. */
    function newer() {
      return defineConfig({
        collections: [POSTS_NEWER],
        plugins: [PLUGIN],
        db: { migrationsDir: join(state.dir, "migrations") },
      });
    }

    async function open(): Promise<DrizzleAdapter> {
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

    /**
     * `row` as one line that reads the same however the driver returned it:
     * its columns by name in order, their names in lower case.
     */
    function line(row: Record<string, unknown>): string {
      return JSON.stringify(
        Object.entries(row)
          .map(([name, value]) => [name.toLowerCase(), value] as const)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
        (_key, value: unknown) =>
          typeof value === "bigint"
            ? value.toString()
            : value instanceof Uint8Array
              ? Buffer.from(value).toString("hex")
              : value
      );
    }

    /**
     * The statements that list the database's structure: every column with
     * its full type, and every index, constraint and (on SQLite) table
     * definition.
     */
    function structureQueries(): { columns: string; indexes: string } {
      if (dialect === "sqlite") {
        return {
          columns:
            "SELECT m.name AS t, p.name AS c, p.type AS ty, p.\"notnull\" AS nn, p.dflt_value AS df, p.pk AS pk FROM sqlite_master m JOIN pragma_table_info(m.name) p WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite_%'",
          // A table's own statement carries its foreign keys and checks.
          indexes:
            "SELECT tbl_name AS t, name AS i, sql AS d FROM sqlite_master WHERE tbl_name NOT LIKE 'sqlite_%'",
        };
      }
      if (dialect === "postgresql") {
        return {
          columns:
            "SELECT c.relname::text AS t, a.attname::text AS c, format_type(a.atttypid, a.atttypmod) AS ty, a.attnotnull AS nn, pg_get_expr(d.adbin, d.adrelid) AS df FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE n.nspname = current_schema() AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped",
          indexes:
            "SELECT tablename::text AS t, indexname::text AS i, indexdef AS d FROM pg_indexes WHERE schemaname = current_schema() UNION ALL SELECT c.relname::text AS t, con.conname::text AS i, pg_get_constraintdef(con.oid) AS d FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = current_schema()",
        };
      }
      return {
        columns:
          "SELECT table_name AS t, column_name AS c, column_type AS ty, is_nullable AS nn, column_default AS df FROM information_schema.columns WHERE table_schema = DATABASE()",
        indexes:
          "SELECT table_name AS t, index_name AS i, CONCAT(seq_in_index, ' ', COALESCE(column_name, ''), ' ', non_unique) AS d FROM information_schema.statistics WHERE table_schema = DATABASE() UNION ALL SELECT table_name AS t, constraint_name AS i, CONCAT('to ', referenced_table_name, ' ', update_rule, ' ', delete_rule) AS d FROM information_schema.referential_constraints WHERE constraint_schema = DATABASE() UNION ALL SELECT tc.table_name AS t, tc.constraint_name AS i, CONCAT(tc.constraint_type, ' ', COALESCE(cc.check_clause, '')) AS d FROM information_schema.table_constraints tc LEFT JOIN information_schema.check_constraints cc ON cc.constraint_schema = tc.constraint_schema AND cc.constraint_name = tc.constraint_name WHERE tc.table_schema = DATABASE()",
      };
    }

    /**
     * Everything the database holds: each table's columns, indexes and
     * constraints as the dialect describes them, and every row of every
     * table, whole, and where each generated key stands. Nothing is left out: the setup token included, which the
     * older build's first start issued and no later start replaces.
     */
    async function copy(): Promise<Copy> {
      const adapter = await open();
      try {
        const out: Copy = {};
        const of = (table: string) =>
          (out[table] ??= { columns: [], indexes: [], rows: [] });
        const text = (row: Record<string, unknown>, name: string) =>
          String(row[name] ?? row[name.toUpperCase()]);
        const { columns, indexes } = structureQueries();
        for (const row of await rowsOf(adapter, columns)) {
          const { t: _t, T: _T, ...rest } = row;
          of(text(row, "t")).columns.push(line(rest));
        }
        for (const row of await rowsOf(adapter, indexes)) {
          const { t: _t, T: _T, ...rest } = row;
          of(text(row, "t")).indexes.push(line(rest));
        }
        for (const [table, held] of Object.entries(out)) {
          const rows = await rowsOf(adapter, `SELECT * FROM ${q}${table}${q}`);
          held.rows = rows.map(line).sort();
          held.columns.sort();
          held.indexes.sort();
        }
        out[GENERATED_KEYS] = {
          columns: [],
          indexes: [],
          rows: await generatedKeys(adapter, Object.keys(out)),
        };
        return out;
      } finally {
        await adapter.disconnect().catch(() => undefined);
      }
    }

    /**
     * Where each generated key stands: the next id a table hands out, which
     * a row inserted and then deleted moves on though no row shows it.
     * PostgreSQL keeps it in sequences, SQLite in `sqlite_sequence`, and
     * MySQL in each table's own statement.
     */
    async function generatedKeys(
      adapter: DrizzleAdapter,
      tables: string[]
    ): Promise<string[]> {
      if (dialect === "postgresql") {
        return (
          await rowsOf(
            adapter,
            "SELECT sequencename::text AS name, last_value::text AS at FROM pg_sequences WHERE schemaname = current_schema()"
          )
        )
          .map(line)
          .sort();
      }
      if (dialect === "sqlite") {
        // The table is there only once a table with such a key is.
        const [there] = await rowsOf(
          adapter,
          "SELECT name FROM sqlite_master WHERE name = 'sqlite_sequence'"
        );
        if (there === undefined) return [];
        return (
          await rowsOf(adapter, "SELECT name, seq AS at FROM sqlite_sequence")
        )
          .map(line)
          .sort();
      }
      const out: string[] = [];
      for (const table of tables) {
        const [row] = await rowsOf(adapter, `SHOW CREATE TABLE \`${table}\``);
        const statement = String(Object.values(row ?? {})[1] ?? "");
        const at = /AUTO_INCREMENT=(\d+)/.exec(statement)?.[1];
        if (at !== undefined) out.push(line({ name: table, at }));
      }
      return out.sort();
    }

    /**
     * One start of `config` in `mode`, begun as `entry` says, until it and
     * the work it leaves running have settled, then closed. What it logged as
     * a warning or an error is kept, and what stopped it, if anything did.
     */
    async function start(
      config: unknown,
      entry: Entry,
      mode: "production" | "development" = "production"
    ): Promise<{ warnings: string[]; refusal?: unknown; status?: number }> {
      vi.stubEnv("NODE_ENV", mode);
      _resetEnvCache();
      // A later moment than anything in the database, so a row a start
      // rewrote with the same values still differs by its time.
      tick();
      const warnings: string[] = [];
      const spies = (["log", "info", "warn", "error"] as const).map(level =>
        vi.spyOn(console, level).mockImplementation((...parts: unknown[]) => {
          if (level === "warn" || level === "error") {
            warnings.push(parts.map(String).join(" "));
          }
        })
      );
      const served = sanitizeConfig(config as never) as never;
      try {
        let status: number | undefined;
        if (entry === "the Direct API") {
          const nextly = await getNextly({ config: served });
          await startSettled();
          await nextly.find({ collection: SLUG });
        } else {
          const handlers = createDynamicHandlers({ config: served });
          const path = ["collections", SLUG, "entries"];
          const response = await handlers.GET(
            new Request(`http://localhost/api/${path.join("/")}`),
            { params: Promise.resolve({ params: path }) }
          );
          status = response.status;
          await startSettled();
        }
        return { warnings, status };
      } catch (refusal) {
        return { warnings, refusal };
      } finally {
        for (const spy of spies) spy.mockRestore();
        await shutdownNextly();
        await shutdownServices();
        resetDispatcherForTests();
        _resetBootMigrationsGateForTest();
        vi.stubEnv("NODE_ENV", "test");
        _resetEnvCache();
      }
    }

    /** The slugs of the permissions the role `slug` holds. */
    async function grantsOf(slug: string): Promise<string[]> {
      const adapter = await open();
      try {
        const rows = await rowsOf(
          adapter,
          `SELECT p.${q}slug${q} AS slug FROM ${q}role_permissions${q} rp JOIN ${q}roles${q} r ON r.${q}id${q} = rp.${q}role_id${q} JOIN ${q}permissions${q} p ON p.${q}id${q} = rp.${q}permission_id${q} WHERE r.${q}slug${q} = '${slug}'`
        );
        return rows.map(row => String(row.slug ?? row.SLUG));
      } finally {
        await adapter.disconnect().catch(() => undefined);
      }
    }

    /**
     * The two builds' history, as the deployments wrote it: the older build
     * migrated and started, then the newer build migrated, installed its
     * plugin and started. Then the older build's folder: the newer build's
     * migration and its snapshot moved aside, into the folder returned with
     * the names of the migration files it holds.
     */
    async function newerBuildDeployed(): Promise<{
      aside: string;
      missing: string[];
    }> {
      await migrateCreate("initial", older());
      await migrate(older());
      const first = await start(older(), "the Direct API");
      expect(first.refusal, first.warnings.join("\n")).toBeUndefined();
      const folder = new Set(readdirSync(join(state.dir, "migrations")));
      const meta = new Set(readdirSync(join(state.dir, "migrations", "meta")));

      await migrateCreate("summary_and_forms", newer());
      await migrate(newer());
      // The install is what records the plugin, so it is shown to have
      // written: a start of the newer build refuses a plugin not installed.
      const migratedOnly = await copy();
      await pluginInstall(PLUGIN_NAME, newer());
      expect(await copy(), "the install recorded the plugin").not.toEqual(
        migratedOnly
      );
      const second = await start(newer(), "the Direct API");
      expect(second.refusal, second.warnings.join("\n")).toBeUndefined();

      const aside = join(state.dir, "aside");
      mkdirSync(join(aside, "meta"), { recursive: true });
      const missing: string[] = [];
      for (const name of readdirSync(join(state.dir, "migrations"))) {
        if (name === "meta" || folder.has(name)) continue;
        renameSync(join(state.dir, "migrations", name), join(aside, name));
        if (name.endsWith(".sql")) missing.push(name);
      }
      for (const name of readdirSync(join(state.dir, "migrations", "meta"))) {
        // Only what the newer build's migration added: its snapshot.
        if (meta.has(name)) continue;
        renameSync(
          join(state.dir, "migrations", "meta", name),
          join(aside, "meta", name)
        );
      }
      expect(missing.length, "the newer migration was written").toBe(1);
      return { aside, missing };
    }

    /** Put the newer build's files back in the migrations folder. */
    function filesBack(aside: string): void {
      for (const name of readdirSync(aside)) {
        if (name === "meta") continue;
        renameSync(join(aside, name), join(state.dir, "migrations", name));
      }
      for (const name of readdirSync(join(aside, "meta"))) {
        renameSync(
          join(aside, "meta", name),
          join(state.dir, "migrations", "meta", name)
        );
      }
    }

    it("its starts change nothing, and its nextly migrate stops before it writes", async () => {
      const { aside, missing } = await newerBuildDeployed();
      const before = await copy();
      // What the newer build left, which the older build must leave: the
      // field in the registry row and the table, and the admin role's grant.
      const registry = before["dynamic_collections"]?.rows.join("\n") ?? "";
      expect(registry).toContain("summary");
      expect(before["dc_obl_posts"]?.columns.join("\n")).toContain("summary");
      expect(await grantsOf("admin")).toContain(PLUGIN_PERMISSION);
      expect(before["permissions"]?.rows.join("\n")).toContain(
        PLUGIN_PERMISSION
      );

      const starts: [migrationsAtStart: boolean, entry: Entry][] = [
        [false, "the Direct API"],
        [false, "a request"],
        [true, "the Direct API"],
        [true, "a request"],
      ];
      for (const [migrationsAtStart, entry] of starts) {
        const label = `migrations at start ${migrationsAtStart ? "on" : "off"}, begun by ${entry}`;
        const started = await start(older(migrationsAtStart), entry);
        expect(started.refusal, label).toBeUndefined();
        if (entry === "a request") expect(started.status, label).toBe(200);
        if (migrationsAtStart) {
          // The step stood down for the migration this build lacks, by name.
          expect(
            started.warnings.some(text => text.includes(missing[0] ?? "")),
            `${label}: ${started.warnings.join("\n")}`
          ).toBe(true);
        }
        expect(await copy(), label).toEqual(before);
      }

      const refused = await migrateRun(older());
      expect(refused.code, refused.said).toBe(3);
      expect(refused.said).toContain(missing[0]);
      expect(await copy(), "after the older build's nextly migrate").toEqual(
        before
      );

      // The control for the command: with the newer build's files back and a
      // migration recording its own configuration written, the older build's
      // run goes ahead, and the comparison sees what it wrote.
      filesBack(aside);
      await migrateCreate("older_again", older(), {
        acceptDataLoss: "dc_obl_posts",
      });
      vi.stubEnv("NEXTLY_ACCEPT_DATA_LOSS", "dc_obl_posts");
      await migrate(older());
      const after = await copy();
      expect(after["dynamic_collections"]).not.toEqual(
        before["dynamic_collections"]
      );
      expect(after["nextly_schema_events"]).not.toEqual(
        before["nextly_schema_events"]
      );
    }, 900_000);

    it("the control: a row inserted and deleted again moves a generated key on", async () => {
      await newerBuildDeployed();
      const before = await copy();

      const adapter = await open();
      try {
        const moment =
          dialect === "sqlite" ? "1900000000" : "'2030-01-01 00:00:00'";
        await adapter.executeQuery(
          `INSERT INTO ${q}password_reset_tokens${q} (${q}identifier${q}, ${q}token_hash${q}, ${q}expires${q}, ${q}created_at${q}) VALUES ('obl', 'obl', ${moment}, ${moment})`
        );
        await adapter.executeQuery(
          `DELETE FROM ${q}password_reset_tokens${q} WHERE ${q}identifier${q} = 'obl'`
        );
      } finally {
        await adapter.disconnect().catch(() => undefined);
      }

      const after = await copy();
      // Every table as it was, and only the key's standing different.
      expect(after[GENERATED_KEYS]).not.toEqual(before[GENERATED_KEYS]);
      expect({ ...after, [GENERATED_KEYS]: undefined }).toEqual({
        ...before,
        [GENERATED_KEYS]: undefined,
      });
    }, 900_000);

    it("the control: a development start of the older build rewrites the registry row", async () => {
      await newerBuildDeployed();
      const before = await copy();

      const started = await start(older(), "the Direct API", "development");
      expect(started.refusal, started.warnings.join("\n")).toBeUndefined();

      const after = await copy();
      expect(after["dynamic_collections"]?.rows).not.toEqual(
        before["dynamic_collections"]?.rows
      );
    }, 900_000);
  }
);
