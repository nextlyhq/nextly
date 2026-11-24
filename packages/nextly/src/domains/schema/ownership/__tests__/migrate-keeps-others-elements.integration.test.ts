/**
 * `migrate:create` and `nextly migrate` never take with a removed field an index another owner
 * built on its column. `migrate:create` refuses before it writes anything, reading the database
 * `DATABASE_URL` names; `nextly migrate` refuses a file that removes it before the file's first
 * statement, so the column, the index and the record of applied files stay as they were. A run of
 * several files is judged before the first of them, so a refused file leaves none applied. Each
 * refusal names the field, the plugin, the index and its table. Where `migrate:create` finds no
 * database to read, it writes the file and says it was not checked there.
 *
 * So is moving that field into a group, on both storage layouts, and turning translation on where it
 * moves the field's column (the earlier layout: on per-language storage a text field's column is the
 * per-language table's already). What the plugin built elsewhere on the table stops none of these,
 * and is kept with its values once `nextly migrate` has run the file.
 *
 * As it happens: the app declares a collection in code and migrates; a plugin's migration builds an
 * index on one of its columns and records it as the plugin's; then the app removes that field,
 * either before writing the file or after the file was written elsewhere. The commands run for
 * real, as `nextly migrate:create` and `nextly migrate` do, on SQLite, PostgreSQL and MySQL, and on
 * per-language storage, as every installation stores translatable fields. The field is a number,
 * whose column is the entity's own in either layout: an untranslated text field's per-language
 * column is kept when the field is removed, so removing one takes nothing.
 */
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createScratchDatabase } from "../../../../__tests__/helpers/fresh-database";
import { perLanguageStorageSuite } from "../../../../__tests__/storage-layout";
import { runMigrate } from "../../../../cli/commands/migrate";
import { runMigrateCreate } from "../../../../cli/commands/migrate-create";
import type { CommandContext } from "../../../../cli/program";
import type { mergeSetupResultIntoConfig as MergeSetupResultIntoConfig } from "../../../../cli/utils/config-loader";
import { createLogger } from "../../../../cli/utils/logger";
import {
  defineCollection,
  defineConfig,
  defineFieldGroup,
  fieldGroup,
  group,
  number,
  text,
} from "../../../../config";
import { createAdapter } from "../../../../database/factory";
import { shutdownServices } from "../../../../di/register";
import {
  getConfiguredTestDialects,
  type TestDialect,
} from "../../../../plugins/test-nextly";
import { _resetEnvCache } from "../../../../shared/lib/env";
import { companionTableOf } from "../../../i18n/migration/derive-companion-spec";
import { setPerLanguageStorage } from "../../../i18n/per-language-storage";
import { resolveComponentTableName } from "../../utils/resolve-table-name";
import { setNonInteractive } from "../../migrate/can-prompt";
import { SchemaOwnersRepository } from "../schema-owners-repository";

perLanguageStorageSuite();

type LoadedConfig = Parameters<typeof MergeSetupResultIntoConfig>[0];

/** The config the commands load, and the folder they run in. */
const state = vi.hoisted(() => ({ config: undefined as unknown, dir: "" }));

vi.mock("../../../../cli/utils/config-loader", async importOriginal => {
  const original =
    await importOriginal<
      typeof import("../../../../cli/utils/config-loader")
    >();
  return {
    ...original,
    loadConfig: async () => {
      const config = state.config as LoadedConfig;
      const merged = original.mergeSetupResultIntoConfig(
        config,
        config,
        config.plugins ?? []
      );
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

const SLUG = "mko-posts";
const TABLE = "dc_mko_posts";
const PLUGIN = "@test/mko-indexer";
/** The index the plugin's migration built on `code`. */
const INDEX = "mko_code_idx";
/** The consent to delete what the change deletes, as `--accept-data-loss` alone gives it. */
const CONSENT = { acceptDataLoss: true };

const GROUP = "mko_cards";
const GROUP_TABLE = resolveComponentTableName(GROUP);

/** The app's configuration with a field group whose `rank` field is there or not. */
const groupConfigWith = (withRank: boolean) =>
  defineConfig({
    fieldGroups: [
      defineFieldGroup({
        slug: GROUP,
        fields: [
          text({ name: "note" }),
          ...(withRank ? [number({ name: "rank" })] : []),
        ],
      }),
    ],
    collections: [
      defineCollection({
        slug: SLUG,
        access: { read: () => true },
        fields: [
          text({ name: "title" }),
          fieldGroup({ name: "card", component: GROUP }),
        ],
      }),
    ],
    db: { migrationsDir: "./migrations" },
  });

/** The app's configuration, with `code` or without it, and with an unrelated `extra` or without. */
const configWith = (withCode: boolean, withExtra = false) =>
  defineConfig({
    collections: [
      defineCollection({
        slug: SLUG,
        access: { read: () => true },
        fields: [
          text({ name: "title" }),
          ...(withCode ? [number({ name: "code" })] : []),
          text({ name: "note" }),
          ...(withExtra ? [number({ name: "extra" })] : []),
        ],
      }),
    ],
    db: { migrationsDir: "./migrations" },
  });

/** A column of the plugin's own, and the index on it. */
const MARKER = "marker";
const MARKER_INDEX = "mko_marker_idx";

/**
 * The app's configuration with a group, its fields `code` and `extra` on the row, inside the group
 * or left out, and the collection translated or not.
 */
const shaped = (
  shape: {
    inGroup?: readonly string[];
    without?: readonly string[];
    localized?: boolean;
  },
  type: typeof number | typeof text = number
) => {
  const all = ["code", "extra"].filter(name => !shape.without?.includes(name));
  const inside = all.filter(name => shape.inGroup?.includes(name));
  return defineConfig({
    localization: { locales: ["en", "es"], defaultLocale: "en" },
    collections: [
      defineCollection({
        slug: SLUG,
        access: { read: () => true },
        ...(shape.localized === true ? { localized: true } : {}),
        fields: [
          text({ name: "title" }),
          ...all
            .filter(name => !inside.includes(name))
            .map(name => type({ name })),
          group({
            name: "meta",
            fields: [
              text({ name: "summary" }),
              ...inside.map(name => type({ name })),
            ],
          }),
        ],
      }),
    ],
    db: { migrationsDir: "./migrations" },
  });
};

/** The layouts a site's tables may be on: the one every installation runs, and the earlier one. */
const LAYOUTS = [
  { layout: "per-language storage", earlier: false },
  { layout: "the earlier layout", earlier: true },
] as const;

describe.each(getConfiguredTestDialects())(
  "migrate:create and nextly migrate keep what a plugin built on a removed field's column (%s)",
  (dialect: TestDialect) => {
    let drops: Array<() => Promise<void>> = [];
    let clock = 0;

    beforeEach(() => {
      state.dir = mkdtempSync(join(tmpdir(), "nextly-mko-"));
      mkdirSync(join(state.dir, "migrations"));
      drops = [];
      vi.stubEnv("DB_DIALECT", dialect);
      vi.stubEnv("NODE_ENV", "test");
      _resetEnvCache();
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(Date.UTC(2026, 10, 23, 12, 0, 0, 0)));
    });

    afterEach(async () => {
      await shutdownServices();
      vi.useRealTimers();
      vi.unstubAllEnvs();
      _resetEnvCache();
      for (const drop of drops) await drop().catch(() => undefined);
      rmSync(state.dir, { recursive: true, force: true });
    }, 60_000);

    /** A new, empty database of this dialect, and its address. */
    async function emptyDatabase(): Promise<string> {
      if (dialect === "sqlite") return `file:${join(state.dir, "app.db")}`;
      const scratch = await createScratchDatabase(dialect, "nextly_mko");
      drops.push(scratch.drop);
      return scratch.url;
    }

    /** An address no database is at. */
    function absentDatabase(): string {
      if (dialect === "sqlite") return `file:${join(state.dir, "absent.db")}`;
      const url = new URL(
        process.env[
          dialect === "postgresql" ? "TEST_POSTGRES_URL" : "TEST_MYSQL_URL"
        ] ?? ""
      );
      url.pathname = "/nextly_mko_never_made";
      return url.toString();
    }

    /** Point the commands at `url`. */
    function use(url: string): void {
      vi.stubEnv("DATABASE_URL", url);
      _resetEnvCache();
    }

    function tick(): void {
      clock += 1;
      vi.setSystemTime(new Date(Date.UTC(2026, 10, 23, 12, 0, clock, 0)));
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

    /** `fn`'s exit code, or undefined where it returned. */
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

    /** A refusal ends in the CLI's error shape on standard error; `said` collects it too. */
    async function run(
      said: string[],
      fn: () => Promise<void>
    ): Promise<number | undefined> {
      const stderr = vi
        .spyOn(console, "error")
        .mockImplementation((...parts: unknown[]) => {
          said.push(parts.map(String).join(" "));
        });
      try {
        return await exiting(fn);
      } finally {
        stderr.mockRestore();
      }
    }

    /** `nextly migrate:create` with `config`: its exit code and what it said. */
    async function migrateCreate(
      name: string,
      config: unknown,
      answers: { acceptMoves?: boolean } = {}
    ) {
      state.config = config;
      tick();
      const { context, said } = command();
      setNonInteractive(true);
      const code = await run(said, () =>
        runMigrateCreate(
          name,
          { cwd: state.dir, ...CONSENT, ...answers },
          context
        )
      ).finally(() => setNonInteractive(false));
      return { code, said: said.join("\n") };
    }

    /** `nextly migrate` with `config`: its exit code and what it said. */
    async function migrate(config: unknown) {
      state.config = config;
      tick();
      const { context, said } = command();
      const code = await run(said, () =>
        runMigrate({ cwd: state.dir, ...CONSENT }, context)
      );
      return { code, said: said.join("\n") };
    }

    /** The migration files written so far. */
    const files = () =>
      readdirSync(join(state.dir, "migrations")).filter(name =>
        name.endsWith(".sql")
      );

    /** On the database at `url`, while it is open. */
    async function on<T>(
      url: string,
      work: (adapter: DrizzleAdapter) => Promise<T>
    ): Promise<T> {
      const adapter = (await createAdapter({ type: dialect, url } as Parameters<
        typeof createAdapter
      >[0])) as DrizzleAdapter;
      try {
        return await work(adapter);
      } finally {
        await adapter.disconnect();
      }
    }

    /** The snapshot of `tables` on the database at `url`. */
    async function snapshotOf(url: string, tables: string[]) {
      return on(url, async adapter => {
        const { introspectLiveSnapshot } = await import(
          "../../pipeline/diff/introspect-live"
        );
        return introspectLiveSnapshot(adapter.getDrizzle(), dialect, tables);
      });
    }

    /**
     * Builds the index on `code` where the database holds it (the collection's table, or its
     * per-language table) as the plugin's migration does, records it as that run records it, and
     * names that table.
     */
    async function buildIndex(
      url: string,
      column = "code",
      main = TABLE
    ): Promise<string> {
      const snapshot = await snapshotOf(url, [main, companionTableOf(main)]);
      const table = snapshot.tables.find(each =>
        each.columns.some(each => each.name === column)
      )?.name;
      if (table === undefined) throw new Error(`no table holds ${column}`);
      const q = (name: string) =>
        dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
      // MySQL indexes a text column only by a prefix, which a plugin writes.
      const isText =
        snapshot.tables
          .find(each => each.name === table)
          ?.columns.find(each => each.name === column)
          ?.type.toLowerCase()
          .includes("text") === true;
      const prefix = dialect === "mysql" && isText ? "(64)" : "";
      await on(url, async adapter => {
        await adapter.executeQuery(
          `CREATE INDEX ${q(INDEX)} ON ${q(table)} (${q(column)}${prefix})`
        );
        await new SchemaOwnersRepository(adapter.getDrizzle(), dialect).upsert([
          {
            tableName: table,
            elementKind: "index",
            elementName: INDEX,
            ownerKind: "plugin",
            ownerId: PLUGIN,
            migratedBy: `plugin:${PLUGIN}`,
            ownerVersion: "1.0.0",
            schemaVersion: null,
            state: "active",
          },
        ]);
      });
      return table;
    }

    /**
     * The plugin's own column on the collection's table, with its index, as its migration makes and
     * records them, and one row there holding a value in it.
     */
    async function plantMarker(url: string): Promise<void> {
      const q = (name: string) =>
        dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
      const snapshot = await snapshotOf(url, [TABLE]);
      const columns =
        snapshot.tables.find(each => each.name === TABLE)?.columns ?? [];
      // A value for each column a row cannot leave out.
      const required = columns.filter(
        column => !column.nullable && column.default === undefined
      );
      const value = (type: string) =>
        /int|real|numeric|double|decimal|float/i.test(type) ? "1" : "'row-1'";
      await on(url, async adapter => {
        await adapter.executeQuery(
          `INSERT INTO ${q(TABLE)} (${required.map(column => q(column.name)).join(", ")}) VALUES (${required.map(column => value(column.type)).join(", ")})`
        );
        await adapter.executeQuery(
          `ALTER TABLE ${q(TABLE)} ADD COLUMN ${q(MARKER)} ${dialect === "mysql" ? "varchar(64)" : "text"}`
        );
        await adapter.executeQuery(
          `CREATE INDEX ${q(MARKER_INDEX)} ON ${q(TABLE)} (${q(MARKER)})`
        );
        await adapter.executeQuery(
          `UPDATE ${q(TABLE)} SET ${q(MARKER)} = 'kept by the plugin'`
        );
        await new SchemaOwnersRepository(adapter.getDrizzle(), dialect).upsert(
          (
            [
              ["column", MARKER],
              ["index", MARKER_INDEX],
            ] as const
          ).map(([elementKind, elementName]) => ({
            tableName: TABLE,
            elementKind,
            elementName,
            ownerKind: "plugin" as const,
            ownerId: PLUGIN,
            migratedBy: `plugin:${PLUGIN}`,
            ownerVersion: "1.0.0",
            schemaVersion: null,
            state: "active" as const,
          }))
        );
      });
    }

    /** The plugin's index and its column's values on the collection's table. */
    async function markerOf(url: string) {
      const q = (name: string) =>
        dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
      const snapshot = await snapshotOf(url, [TABLE]);
      return {
        index: snapshot.tables
          .find(each => each.name === TABLE)
          ?.indexes?.find(index => index.name === MARKER_INDEX)?.columns,
        values: await on(url, async adapter =>
          (
            await adapter.executeQuery<{ v: unknown }>(
              `SELECT ${q(MARKER)} AS v FROM ${q(TABLE)}`
            )
          ).map(row => row.v)
        ),
      };
    }

    /** `table`'s columns and index names, as the database has them. */
    async function shapeOf(url: string, table: string) {
      const snapshot = await snapshotOf(url, [table]);
      const found = snapshot.tables.find(each => each.name === table);
      return {
        columns: (found?.columns ?? []).map(column => column.name).sort(),
        indexes: (found?.indexes ?? []).map(index => index.name).sort(),
      };
    }

    /** The refusal names the field, the plugin, the index and its table, and says what to do. */
    function expectNamesTheIndex(said: string, table: string): void {
      for (const part of [
        "code",
        PLUGIN,
        INDEX,
        table,
        "Its owner removes it first",
      ]) {
        expect(said).toContain(part);
      }
    }

    it("migrate:create refuses removing a field a plugin's migration indexed, writing nothing", async () => {
      const url = await emptyDatabase();
      use(url);
      expect((await migrateCreate("add_posts", configWith(true))).code).toBe(
        undefined
      );
      expect((await migrate(configWith(true))).code).toBe(undefined);
      const table = await buildIndex(url);
      const written = files();

      const created = await migrateCreate("remove_code", configWith(false));

      expect(created.code, created.said).not.toBe(undefined);
      expectNamesTheIndex(created.said, table);
      expect(files()).toEqual(written);
      expect((await shapeOf(url, table)).indexes).toContain(INDEX);
    });

    it("nextly migrate refuses a file removing that field before its first statement, changing nothing", async () => {
      const url = await emptyDatabase();
      use(url);
      expect((await migrateCreate("add_posts", configWith(true))).code).toBe(
        undefined
      );
      expect((await migrate(configWith(true))).code).toBe(undefined);
      // The file is written before the plugin builds anything, as on another database.
      expect((await migrateCreate("remove_code", configWith(false))).code).toBe(
        undefined
      );
      const table = await buildIndex(url);
      const before = await shapeOf(url, table);
      expect(before.columns).toContain("code");

      const migrated = await migrate(configWith(false));

      expect(migrated.code, migrated.said).not.toBe(undefined);
      expectNamesTheIndex(migrated.said, table);
      expect(await shapeOf(url, table)).toEqual(before);
    });

    it("nextly migrate refuses a later file's removal before the first file runs, changing nothing", async () => {
      const url = await emptyDatabase();
      use(url);
      expect((await migrateCreate("add_posts", configWith(true))).code).toBe(
        undefined
      );
      expect((await migrate(configWith(true))).code).toBe(undefined);
      // Written before the plugin builds anything, as on another database: a file that adds a
      // column, and one that removes the column the plugin will index.
      expect(
        (await migrateCreate("add_extra", configWith(true, true))).code
      ).toBe(undefined);
      expect(
        (await migrateCreate("remove_code", configWith(false, true))).code
      ).toBe(undefined);
      const table = await buildIndex(url);
      const before = await shapeOf(url, table);
      expect(before.columns).not.toContain("extra");

      const migrated = await migrate(configWith(false, true));

      expect(migrated.code, migrated.said).not.toBe(undefined);
      expectNamesTheIndex(migrated.said, table);
      expect(await shapeOf(url, table)).toEqual(before);
    });

    it("migrate:create refuses removing a field group's field whose column in its shared table a plugin's migration indexed, writing nothing", async () => {
      const url = await emptyDatabase();
      use(url);
      expect(
        (await migrateCreate("add_cards", groupConfigWith(true))).code
      ).toBe(undefined);
      expect((await migrate(groupConfigWith(true))).code).toBe(undefined);
      const table = await buildIndex(url, "rank", GROUP_TABLE);
      expect(table).toBe(GROUP_TABLE);
      const written = files();

      const created = await migrateCreate(
        "remove_rank",
        groupConfigWith(false)
      );

      expect(created.code, created.said).not.toBe(undefined);
      for (const part of ["rank", PLUGIN, INDEX, GROUP_TABLE]) {
        expect(created.said).toContain(part);
      }
      expect(files()).toEqual(written);
      expect((await shapeOf(url, table)).indexes).toContain(INDEX);
    });

    it.each(LAYOUTS)(
      "migrate:create refuses moving that field into a group, writing nothing, on $layout",
      async ({ earlier }) => {
        if (earlier) setPerLanguageStorage(false);
        const url = await emptyDatabase();
        use(url);
        expect((await migrateCreate("add_posts", shaped({}))).code).toBe(
          undefined
        );
        expect((await migrate(shaped({}))).code).toBe(undefined);
        const table = await buildIndex(url);
        const before = await shapeOf(url, table);
        const written = files();

        const created = await migrateCreate(
          "move_code",
          shaped({ inGroup: ["code"] }),
          { acceptMoves: true }
        );

        expect(created.code, created.said).not.toBe(undefined);
        expectNamesTheIndex(created.said, table);
        expect(files()).toEqual(written);
        expect(await shapeOf(url, table)).toEqual(before);
      }
    );

    it("migrate:create refuses turning translation on where it moves that field's column, writing nothing", async () => {
      setPerLanguageStorage(false);
      const url = await emptyDatabase();
      use(url);
      expect((await migrateCreate("add_posts", shaped({}, text))).code).toBe(
        undefined
      );
      expect((await migrate(shaped({}, text))).code).toBe(undefined);
      const table = await buildIndex(url);
      expect(table).toBe(TABLE);
      const before = await shapeOf(url, table);
      const written = files();

      const created = await migrateCreate(
        "translate_posts",
        shaped({ localized: true }, text)
      );

      expect(created.code, created.said).not.toBe(undefined);
      expectNamesTheIndex(created.said, table);
      expect(files()).toEqual(written);
      expect(await shapeOf(url, table)).toEqual(before);
    });

    // Nothing of the plugin's is built on a column any of these takes off the table.
    it.each(
      LAYOUTS.flatMap(layout => [
        {
          ...layout,
          change: "removing a field",
          after: { without: ["extra"] },
          gone: "extra" as string | undefined,
        },
        {
          ...layout,
          change: "moving a field into a group",
          after: { inGroup: ["extra"] },
          gone: "extra" as string | undefined,
        },
        {
          ...layout,
          change: "turning translation on",
          after: { localized: true },
          // Of text fields, the title's column, where the earlier layout holds it on this table.
          gone: layout.earlier ? "title" : undefined,
        },
      ])
    )(
      "migrate:create and nextly migrate apply $change on $layout, keeping the plugin's column, its index and its values",
      async ({ earlier, after, gone }) => {
        if (earlier) setPerLanguageStorage(false);
        const url = await emptyDatabase();
        use(url);
        expect((await migrateCreate("add_posts", shaped({}))).code).toBe(
          undefined
        );
        expect((await migrate(shaped({}))).code).toBe(undefined);
        await plantMarker(url);
        const before = await markerOf(url);
        expect(before).toEqual({
          index: [MARKER],
          values: ["kept by the plugin"],
        });
        if (gone !== undefined) {
          expect((await shapeOf(url, TABLE)).columns).toContain(gone);
        }

        const created = await migrateCreate("change_posts", shaped(after), {
          acceptMoves: true,
        });
        expect(created.code, created.said).toBe(undefined);
        const migrated = await migrate(shaped(after));
        expect(migrated.code, migrated.said).toBe(undefined);

        if (gone !== undefined) {
          expect((await shapeOf(url, TABLE)).columns).not.toContain(gone);
        }
        expect(await markerOf(url)).toEqual(before);
      }
    );

    it("migrate:create writes the file and says it was not checked where no database is there", async () => {
      use(absentDatabase());
      expect((await migrateCreate("add_posts", configWith(true))).code).toBe(
        undefined
      );
      const written = files();

      const created = await migrateCreate("remove_code", configWith(false));

      expect(created.code, created.said).toBe(undefined);
      expect(created.said).toContain("was not checked");
      expect(files()).toHaveLength(written.length + 1);
    });
  }
);
