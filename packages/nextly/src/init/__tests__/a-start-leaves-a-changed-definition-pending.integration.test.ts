/**
 * A start that changes no table never marks a changed definition applied, on every configured
 * dialect.
 *
 * `nextly migrate` applies one configuration; Nextly then starts, through its real entry point,
 * with a build that changes a collection's, a Single's and a field group's fields. A start with
 * `NODE_ENV` unset (a seed script), `test`, or `development` with `NEXTLY_DISABLE_BOOT_APPLY=1`
 * records the new definition in each registry row and changes no table, so each row says the
 * definition is pending, as a migration would leave it. A row that says `applied` there is read as
 * what the last migration made, by `nextly migrate`'s checks and by `nextly repair-columns`.
 *
 * A production start writes no row, an unchanged entity's row stays applied, and a start over a
 * fresh database creates the tables and marks them applied, as every test suite's start does. A
 * pending entity whose columns are there is still written and read.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createScratchDatabase } from "../../__tests__/helpers/fresh-database";
import { runMigrate } from "../../cli/commands/migrate";
import { runMigrateCreate } from "../../cli/commands/migrate-create";
import type { CommandContext } from "../../cli/program";
import { createLogger } from "../../cli/utils/logger";
import {
  defineCollection,
  defineConfig,
  defineFieldGroup,
  defineSingle,
  number,
  text,
} from "../../config";
import { createAdapter } from "../../database/factory";
import { shutdownServices } from "../../di/register";
import { setNonInteractive } from "../../domains/schema/migrate/can-prompt";
import { introspectLiveColumns } from "../../domains/schema/pipeline/diff/introspect-live";
import { getNextly, shutdownNextly, startSettled } from "../../init";
import {
  clearCachedSnapshot,
  clearLiveSnapshots,
} from "../../init/schema-snapshot-cache";
import { getConfiguredTestDialects } from "../../plugins/test-nextly";
import { _resetEnvCache } from "../../shared/lib/env";
import { sanitizeConfig } from "../../shared/types/config";

/** The configuration the commands load, and the folder they run in. */
const state = vi.hoisted(() => ({ config: undefined as unknown, dir: "" }));

vi.mock("../../cli/utils/config-loader", async original => {
  const actual =
    await original<typeof import("../../cli/utils/config-loader")>();
  return {
    ...actual,
    loadConfig: () =>
      Promise.resolve({
        config: state.config,
        appConfig: state.config,
        pluginConsent: undefined,
        projectRoot: state.dir,
        dependencies: [],
      }),
  };
});

/**
 * As the migration applied them, or as the starting build changes them: a field added. With
 * `helpText`, only the title's help text, which changes no column.
 */
function fields(changed: boolean, helpText = false) {
  return [
    text({
      name: "title",
      ...(helpText ? { admin: { description: "The post's title" } } : {}),
    } as never),
    number({ name: "price" }),
    ...(changed ? [text({ name: "subtitle" })] : []),
  ];
}

/** The configuration; `spd_kept` stays as the migration applied it. */
function config(changed: boolean, helpText = false) {
  return defineConfig({
    collections: [
      defineCollection({
        slug: "spd_posts",
        fields: fields(changed, helpText),
      }),
      defineCollection({ slug: "spd_kept", fields: fields(false) }),
    ],
    singles: [
      defineSingle({
        slug: "spd_site",
        fields: fields(changed, helpText),
      } as never),
    ],
    fieldGroups: [
      defineFieldGroup({
        slug: "spd_card",
        fields: fields(changed, helpText),
      } as never),
    ],
    db: { migrationsDir: "./migrations" },
  } as never);
}

const KINDS = ["collection", "single", "fieldGroup"] as const;
type Kind = (typeof KINDS)[number];
const SLUG: Record<Kind, string> = {
  collection: "spd_posts",
  single: "spd_site",
  fieldGroup: "spd_card",
};

describe.each(getConfiguredTestDialects())(
  "a start that changes no table (%s)",
  dialect => {
    let url: string;
    let drop: () => Promise<void>;
    let clock = 0;
    const said: string[] = [];

    const context = (): CommandContext => {
      const keep = (message: string) => {
        said.push(message);
      };
      return {
        logger: {
          ...createLogger({ quiet: true }),
          info: keep,
          warn: keep,
          success: keep,
          error: keep,
        },
        options: {},
        cwd: state.dir,
      } as unknown as CommandContext;
    };
    /** One second on, so each command's records are ordered and snapshots read again. */
    const tick = () => {
      clock += 1;
      vi.setSystemTime(new Date(Date.UTC(2026, 10, 26, 9, 0, clock, 0)));
      clearCachedSnapshot();
      clearLiveSnapshots();
    };

    beforeEach(async () => {
      said.length = 0;
      state.dir = mkdtempSync(join(tmpdir(), "nextly-start-pending-"));
      mkdirSync(join(state.dir, "migrations"));
      url = `file:${join(state.dir, "test.db")}`;
      drop = () => Promise.resolve();
      if (dialect !== "sqlite") {
        const scratch = await createScratchDatabase(dialect, "nextly_spd");
        url = scratch.url;
        drop = scratch.drop;
      }
      vi.stubEnv("DB_DIALECT", dialect);
      vi.stubEnv("DATABASE_URL", url);
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
      vi.stubEnv("CI", "");
      _resetEnvCache();
      vi.spyOn(process, "cwd").mockReturnValue(state.dir);
      vi.useFakeTimers({ toFake: ["Date"] });
      tick();
    }, 120_000);

    afterEach(async () => {
      await shutdownNextly();
      await shutdownServices();
      process.exitCode = undefined;
      vi.useRealTimers();
      vi.restoreAllMocks();
      vi.unstubAllEnvs();
      _resetEnvCache();
      await drop();
      rmSync(state.dir, { recursive: true, force: true });
    }, 120_000);

    async function withDatabase<R>(
      work: (adapter: DrizzleAdapter) => Promise<R>
    ): Promise<R> {
      const adapter = (await createAdapter({
        type: dialect,
        url,
      } as never)) as unknown as DrizzleAdapter & {
        connect?: () => Promise<void>;
        disconnect: () => Promise<void>;
      };
      try {
        await adapter.connect?.();
        return await work(adapter);
      } finally {
        await adapter.disconnect();
      }
    }

    /** A command, run as its own process would end: a refusal is thrown with what it said. */
    async function command(run: () => Promise<unknown>) {
      setNonInteractive(true);
      const exit = vi.spyOn(process, "exit").mockImplementation(code => {
        throw new Error(`exit ${String(code)}: ${said.slice(-4).join(" | ")}`);
      });
      try {
        await run();
      } finally {
        exit.mockRestore();
        setNonInteractive(false);
      }
    }

    /** `nextly migrate` applies the configuration as the migration was written for it. */
    async function migrated() {
      state.config = config(false);
      tick();
      await command(() =>
        runMigrateCreate(
          "spd_init",
          { cwd: state.dir, acceptDataLoss: true } as never,
          context()
        )
      );
      tick();
      await command(() =>
        runMigrate(
          {
            cwd: state.dir,
            throwOnFailure: true,
            acceptDataLoss: true,
          } as never,
          context()
        )
      );
    }

    /**
     * Start Nextly with `env` and the configuration as migrated or changed. With `seed`, do what a
     * seed script then does: write an entry and read the collection back, returning how many.
     */
    async function start(
      env: Record<string, string | undefined>,
      changed = true,
      seed = false
    ): Promise<number | undefined> {
      tick();
      // The start's own reload reads the config file, so it reads the configuration started with.
      state.config = config(changed);
      for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
      _resetEnvCache();
      try {
        const nextly = (await getNextly({
          config: sanitizeConfig(config(changed) as never) as never,
        })) as unknown as {
          create: (args: unknown) => Promise<unknown>;
          find: (args: unknown) => Promise<{ items: unknown[] }>;
        };
        await startSettled();
        if (!seed) return undefined;
        await nextly.create({
          collection: "spd_posts",
          data: { title: "seeded", price: 2 },
          overrideAccess: true,
        });
        return (
          await nextly.find({ collection: "spd_posts", overrideAccess: true })
        ).items.length;
      } finally {
        await shutdownNextly();
        await shutdownServices();
        vi.stubEnv("NODE_ENV", "test");
        vi.stubEnv("NEXTLY_DISABLE_BOOT_APPLY", undefined);
        _resetEnvCache();
      }
    }

    /** Each row's status and whether its definition holds `subtitle`, and each table's columns. */
    const facts = () =>
      withDatabase(async adapter => {
        const registry = {
          collection: "dynamic_collections",
          single: "dynamic_singles",
          fieldGroup: (await adapter.tableExists("dynamic_components"))
            ? "dynamic_components"
            : "dynamic_field_groups",
        };
        const read = async (table: string, slug: string) => {
          const [row] = await adapter.executeQuery<{
            s: string;
            f: unknown;
            t: string;
          }>(
            `SELECT migration_status AS s, fields AS f, table_name AS t FROM ${table} WHERE slug = '${slug}'`
          );
          const declared = (
            typeof row.f === "string" ? JSON.parse(row.f) : row.f
          ) as Array<{ name: string }>;
          const live = await introspectLiveColumns(
            adapter.getDrizzle(),
            dialect,
            [row.t]
          );
          return {
            status: row.s,
            declares: declared.some(field => field.name === "subtitle"),
            column: (live.tables[0]?.columns ?? []).some(
              column => column.name === "subtitle"
            ),
          };
        };
        return {
          collection: await read(registry.collection, SLUG.collection),
          single: await read(registry.single, SLUG.single),
          fieldGroup: await read(registry.fieldGroup, SLUG.fieldGroup),
          kept: (await read("dynamic_collections", "spd_kept")).status,
        };
      });

    /** Every row records the new definition and says it is pending, and no table changed. */
    async function expectPending(env: Record<string, string | undefined>) {
      await migrated();
      const before = await facts();
      expect(before.collection.status).toBe("applied");
      await start(env);
      const after = await facts();
      for (const kind of KINDS) {
        expect(after[kind], kind).toEqual({
          status: "pending",
          declares: true,
          column: false,
        });
      }
      expect(after.kept).toBe("applied");
    }

    it.each([
      ["unset, as a seed script runs", { NODE_ENV: undefined }],
      ["test, as a test suite runs", { NODE_ENV: "test" }],
      [
        "development with NEXTLY_DISABLE_BOOT_APPLY=1",
        { NODE_ENV: "development", NEXTLY_DISABLE_BOOT_APPLY: "1" },
      ],
    ])(
      "leaves a changed definition pending with NODE_ENV %s",
      async (_how, env) => {
        await expectPending(env);
      },
      180_000
    );

    it("marks a changed definition applied where a development start adds its columns", async () => {
      await migrated();
      await start({ NODE_ENV: "development" });
      const after = await facts();
      for (const kind of KINDS) {
        expect(after[kind], kind).toEqual({
          status: "applied",
          declares: true,
          column: true,
        });
      }
      expect(after.kept).toBe("applied");
    }, 180_000);

    it("writes no row in production", async () => {
      await migrated();
      await start({ NODE_ENV: "production" });
      const after = await facts();
      for (const kind of KINDS) {
        expect(after[kind], kind).toEqual({
          status: "applied",
          declares: false,
          column: false,
        });
      }
    }, 180_000);

    it("serves a pending entity: a seed script writes and reads it", async () => {
      await migrated();
      await start({ NODE_ENV: undefined });
      // Started again as migrated: its row goes back to what the table holds, and says pending.
      expect(await start({ NODE_ENV: undefined }, false, true)).toBe(1);
      expect((await facts()).collection).toEqual({
        status: "pending",
        declares: false,
        column: false,
      });
    }, 180_000);

    it("leaves an unchanged definition applied", async () => {
      await migrated();
      expect(await start({ NODE_ENV: undefined }, false, true)).toBe(1);
      const after = await facts();
      for (const kind of KINDS)
        expect(after[kind].status, kind).toBe("applied");
    }, 180_000);

    it("creates the tables of a fresh database and marks them applied", async () => {
      // What every test suite's start does, with nothing migrated.
      state.config = config(true);
      expect(await start({ NODE_ENV: "test" }, true, true)).toBe(1);
      const after = await facts();
      for (const kind of KINDS) {
        expect(after[kind], kind).toEqual({
          status: "applied",
          declares: true,
          column: true,
        });
      }
    }, 180_000);

    /** Start with `env`, the field group's title given help text the hash leaves out. */
    async function startWithHelpText() {
      tick();
      state.config = config(false, true);
      vi.stubEnv("NODE_ENV", undefined);
      _resetEnvCache();
      try {
        await getNextly({
          config: sanitizeConfig(config(false, true) as never) as never,
        });
        await startSettled();
      } finally {
        await shutdownNextly();
        await shutdownServices();
        vi.stubEnv("NODE_ENV", "test");
        _resetEnvCache();
      }
    }

    it("keeps a field group applied where only its help text changed, as a collection and a Single are", async () => {
      await migrated();
      await startWithHelpText();
      const after = await facts();
      for (const kind of KINDS)
        expect(after[kind].status, kind).toBe("applied");
    }, 180_000);

    it("keeps a field group's status where its table pointer is repaired, and nothing to migrate", async () => {
      await migrated();
      // A row written before names resolved: its table name addresses no table, and the derived
      // one holds the data. The sync points it back; no column changes.
      const registry = await withDatabase(async adapter =>
        (await adapter.tableExists("dynamic_components"))
          ? "dynamic_components"
          : "dynamic_field_groups"
      );
      const [{ t }] = await withDatabase(adapter =>
        adapter.executeQuery<{ t: string }>(
          `SELECT table_name AS t FROM ${registry} WHERE slug = 'spd_card'`
        )
      );
      await withDatabase(adapter =>
        adapter.executeQuery(
          `UPDATE ${registry} SET table_name = 'spd_card_moved_away' WHERE slug = 'spd_card'`
        )
      );
      await start({ NODE_ENV: undefined }, false);
      const [{ t: repaired }] = await withDatabase(adapter =>
        adapter.executeQuery<{ t: string }>(
          `SELECT table_name AS t FROM ${registry} WHERE slug = 'spd_card'`
        )
      );
      expect(repaired).toBe(t);
      expect((await facts()).fieldGroup.status).toBe("applied");
    }, 180_000);

    it("marks a row this start creates over a table already there applied, for a field group as for a collection", async () => {
      await migrated();
      // The rows are lost and the tables stay: the start writes each row again from the
      // configuration, which describes the tables as they are.
      const registry = await withDatabase(async adapter =>
        (await adapter.tableExists("dynamic_components"))
          ? "dynamic_components"
          : "dynamic_field_groups"
      );
      await withDatabase(async adapter => {
        await adapter.executeQuery(
          `DELETE FROM dynamic_collections WHERE slug = 'spd_posts'`
        );
        await adapter.executeQuery(
          `DELETE FROM ${registry} WHERE slug = 'spd_card'`
        );
      });
      await start({ NODE_ENV: undefined }, false);
      const after = await facts();
      expect(after.collection.status).toBe("applied");
      expect(after.fieldGroup.status).toBe("applied");
    }, 180_000);
  }
);
