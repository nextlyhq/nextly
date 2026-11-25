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
 * per-language table's already). On that layout the set-up's `nextly migrate` applies its file, then
 * ends on the upgrade's data step, which would move the values per language and asks for a backup
 * first. On per-language storage, what the plugin built elsewhere on the table stops none of these,
 * and is kept with its values once `nextly migrate` has run the file.
 *
 * The app declares a collection in code and migrates; an index of a plugin's is made on one of its
 * columns and recorded as the plugin's in the row a development push writes (`nextly migrate` writes
 * none for an entity's table: the last case is that one). Then the app removes that field, either
 * before writing the file or after the file was written elsewhere. The commands run for
 * real, as `nextly migrate:create` and `nextly migrate` do, on SQLite, PostgreSQL and MySQL, and on
 * per-language storage, as every installation stores translatable fields. The field is a number,
 * whose column is the entity's own in either layout: an untranslated text field's per-language
 * column is kept when the field is removed, so removing one takes nothing.
 */
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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
import { definePlugin } from "../../../../plugins/plugin-context";
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
import { ownerRowsToRecord } from "../kept-elements";
import type { OwnerRecord } from "../owner-registry";
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
/** The plugin's index on `code`. */
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

/** The index a plugin's schema hook declares on the app's own collection's `code`. */
const DECLARED_INDEX = "idx_mko_declared";
const declaring = definePlugin({
  name: PLUGIN,
  version: "1.0.0",
  nextly: ">=0.0.0",
  contributes: {
    schema: {
      extend: [
        ({ schema }) => {
          schema.extendTable(TABLE, {
            indexes: [{ columns: ["code"], name: DECLARED_INDEX }],
          });
        },
      ],
    },
  },
});

/** The app's configuration with the plugin or without it, and with `code` or without it. */
const pluggedWith = (withPlugin: boolean, withCode: boolean) =>
  defineConfig({
    ...(withPlugin ? { plugins: [declaring] } : {}),
    collections: [
      defineCollection({
        slug: SLUG,
        access: { read: () => true },
        fields: [
          text({ name: "title" }),
          ...(withCode ? [number({ name: "code" })] : []),
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
    /** Fields made required, which SQLite rebuilds the table for. */
    required?: readonly string[];
    /** A field of the app's own, named as the plugin's column is. */
    ownMarker?: boolean;
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
            .map(name =>
              type({
                name,
                ...(shape.required?.includes(name) ? { required: true } : {}),
              })
            ),
          ...(shape.ownMarker === true ? [number({ name: MARKER })] : []),
          group({ name: "meta", fields: [text({ name: "summary" })] }),
          // The group fields move into: one holding text keeps it for each language on per-language
          // storage, and a move into it is refused there.
          group({
            name: "box",
            fields: [
              number({ name: "weight" }),
              ...inside.map(name => type({ name })),
            ],
          }),
        ],
      }),
    ],
    db: { migrationsDir: "./migrations" },
  });
};

/** Changes of the app's own, each taking the app's own column off the table or none. */
const CHANGES: {
  change: string;
  after: Parameters<typeof shaped>[0];
  gone: string | undefined;
}[] = [
  {
    change: "removing a field",
    after: { without: ["extra"] },
    gone: "extra",
  },
  {
    change: "moving a field into a group",
    after: { inGroup: ["extra"] },
    gone: "extra",
  },
  {
    change: "turning translation on",
    after: { localized: true },
    gone: undefined,
  },
];

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

    /** A command that went through; one that did not is told with what it said. */
    function wentThrough(ran: { code: number | undefined; said: string }) {
      expect(ran.code, ran.said).toBe(undefined);
    }

    /**
     * The set-up's `nextly migrate` went through, or on the earlier layout applied its file and then
     * ended on the upgrade's data step, for want of a confirmed backup, and nothing else: the
     * collection's text column is still on its own table.
     */
    async function applied(
      url: string,
      earlier: boolean,
      ran: { code: number | undefined; said: string }
    ) {
      if (!earlier) return wentThrough(ran);
      expect(ran.code, ran.said).toBe(1);
      expect(ran.said).toContain("DATA_STEPS_BACKUP_NOT_CONFIRMED");
      expect((await shapeOf(url, TABLE)).columns).toContain("title");
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
     * Makes the plugin's index on `code` by its DDL where the database holds it (the collection's
     * table, or its per-language table), records it as a development push writes it, and names that
     * table.
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
        await new SchemaOwnersRepository(adapter.getDrizzle(), dialect).upsert(
          ownerRowsToRecord(
            [
              {
                table,
                elementKind: "index",
                elementName: INDEX,
                owner: { kind: "plugin", id: PLUGIN },
              },
            ],
            new Set(),
            []
          )
        );
      });
      return table;
    }

    /**
     * The plugin's own column on `main`, with its index, recorded as a push writes it, and one row there holding a value in it.
     */
    async function plantMarker(
      url: string,
      main = TABLE,
      recorded: (rows: OwnerRecord[]) => OwnerRecord[] = rows => rows,
      indexed = true
    ): Promise<void> {
      const q = (name: string) =>
        dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
      const snapshot = await snapshotOf(url, [main]);
      const columns =
        snapshot.tables.find(each => each.name === main)?.columns ?? [];
      // A value for each column a row cannot leave out.
      const required = columns.filter(
        column => !column.nullable && column.default === undefined
      );
      const value = (type: string) =>
        /int|real|numeric|double|decimal|float/i.test(type) ? "1" : "'row-1'";
      await on(url, async adapter => {
        await adapter.executeQuery(
          `INSERT INTO ${q(main)} (${required.map(column => q(column.name)).join(", ")}) VALUES (${required.map(column => value(column.type)).join(", ")})`
        );
        await adapter.executeQuery(
          `ALTER TABLE ${q(main)} ADD COLUMN ${q(MARKER)} ${dialect === "mysql" ? "varchar(64)" : "text"}`
        );
        if (indexed) {
          await adapter.executeQuery(
            `CREATE INDEX ${q(MARKER_INDEX)} ON ${q(main)} (${q(MARKER)})`
          );
        }
        await adapter.executeQuery(
          `UPDATE ${q(main)} SET ${q(MARKER)} = 'kept by the plugin'`
        );
        await new SchemaOwnersRepository(adapter.getDrizzle(), dialect).upsert(
          recorded(
            ownerRowsToRecord(
              (
                [
                  ["column", MARKER],
                  ["index", MARKER_INDEX],
                ] as const
              ).map(([elementKind, elementName]) => ({
                table: main,
                elementKind,
                elementName,
                owner: { kind: "plugin" as const, id: PLUGIN },
              })),
              new Set(),
              []
            )
          )
        );
      });
    }

    /** The plugin's index and its column's values on `main`. */
    async function markerOf(url: string, main = TABLE) {
      const q = (name: string) =>
        dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
      const snapshot = await snapshotOf(url, [main]);
      return {
        index: snapshot.tables
          .find(each => each.name === main)
          ?.indexes?.find(index => index.name === MARKER_INDEX)?.columns,
        values: await on(url, async adapter =>
          (
            await adapter.executeQuery<{ v: unknown }>(
              `SELECT ${q(MARKER)} AS v FROM ${q(main)}`
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

    it("migrate:create refuses removing a field a plugin's recorded index stands on, writing nothing", async () => {
      const url = await emptyDatabase();
      use(url);
      wentThrough(await migrateCreate("add_posts", configWith(true)));
      wentThrough(await migrate(configWith(true)));
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
      wentThrough(await migrateCreate("add_posts", configWith(true)));
      wentThrough(await migrate(configWith(true)));
      // The file is written before the plugin builds anything, as on another database.
      wentThrough(await migrateCreate("remove_code", configWith(false)));
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
      wentThrough(await migrateCreate("add_posts", configWith(true)));
      wentThrough(await migrate(configWith(true)));
      // Written before the plugin builds anything, as on another database: a file that adds a
      // column, and one that removes the column the plugin will index.
      wentThrough(await migrateCreate("add_extra", configWith(true, true)));
      wentThrough(await migrateCreate("remove_code", configWith(false, true)));
      const table = await buildIndex(url);
      const before = await shapeOf(url, table);
      expect(before.columns).not.toContain("extra");

      const migrated = await migrate(configWith(false, true));

      expect(migrated.code, migrated.said).not.toBe(undefined);
      expectNamesTheIndex(migrated.said, table);
      expect(await shapeOf(url, table)).toEqual(before);
    });

    it("migrate:create refuses removing a field group's field whose column in its shared table a plugin's recorded index stands on, writing nothing", async () => {
      const url = await emptyDatabase();
      use(url);
      wentThrough(await migrateCreate("add_cards", groupConfigWith(true)));
      wentThrough(await migrate(groupConfigWith(true)));
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
        wentThrough(await migrateCreate("add_posts", shaped({})));
        await applied(url, earlier, await migrate(shaped({})));
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
      wentThrough(await migrateCreate("add_posts", shaped({}, text)));
      await applied(url, true, await migrate(shaped({}, text)));
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

    // The control of the cases below: the same changes with nothing of a plugin's on the table.
    it.each(CHANGES)(
      "migrate:create and nextly migrate apply $change on per-language storage where nothing of a plugin's is on the table",
      async ({ after, gone }) => {
        const url = await emptyDatabase();
        use(url);
        wentThrough(await migrateCreate("add_posts", shaped({})));
        wentThrough(await migrate(shaped({})));

        const created = await migrateCreate("change_posts", shaped(after), {
          acceptMoves: true,
        });
        expect(created.code, created.said).toBe(undefined);
        const migrated = await migrate(shaped(after));
        expect(migrated.code, migrated.said).toBe(undefined);

        if (gone !== undefined) {
          expect((await shapeOf(url, TABLE)).columns).not.toContain(gone);
        }
      }
    );

    // Nothing of the plugin's is built on a column any of these takes off the table.
    it.each(CHANGES)(
      "migrate:create and nextly migrate apply $change on per-language storage, keeping the plugin's column, its index and its values",
      async ({ after, gone }) => {
        const url = await emptyDatabase();
        use(url);
        wentThrough(await migrateCreate("add_posts", shaped({})));
        wentThrough(await migrate(shaped({})));
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

    it("migrate:create and nextly migrate apply removing a field group's field on per-language storage, keeping the plugin's column, its index and its values on the shared table", async () => {
      const url = await emptyDatabase();
      use(url);
      wentThrough(await migrateCreate("add_cards", groupConfigWith(true)));
      wentThrough(await migrate(groupConfigWith(true)));
      await plantMarker(url, GROUP_TABLE);
      const before = await markerOf(url, GROUP_TABLE);
      expect(before).toEqual({
        index: [MARKER],
        values: ["kept by the plugin"],
      });
      expect((await shapeOf(url, GROUP_TABLE)).columns).toContain("rank");

      const created = await migrateCreate(
        "remove_rank",
        groupConfigWith(false)
      );
      expect(created.code, created.said).toBe(undefined);
      const migrated = await migrate(groupConfigWith(false));
      expect(migrated.code, migrated.said).toBe(undefined);

      expect((await shapeOf(url, GROUP_TABLE)).columns).not.toContain("rank");
      expect(await markerOf(url, GROUP_TABLE)).toEqual(before);
    });

    it("migrate:create and nextly migrate apply removing a field group's field on per-language storage where nothing of a plugin's is on the shared table", async () => {
      const url = await emptyDatabase();
      use(url);
      wentThrough(await migrateCreate("add_cards", groupConfigWith(true)));
      wentThrough(await migrate(groupConfigWith(true)));

      wentThrough(await migrateCreate("remove_rank", groupConfigWith(false)));
      const migrated = await migrate(groupConfigWith(false));

      expect(migrated.code, migrated.said).toBe(undefined);
      expect((await shapeOf(url, GROUP_TABLE)).columns).not.toContain("rank");
    });

    /** The app's own change of TABLE, run over the plugin's parts there, recorded as `recorded` says. */
    async function changedOverTheParts(
      options: {
        recorded?: (rows: OwnerRecord[]) => OwnerRecord[];
        after?: Parameters<typeof shaped>[0];
        /** Whether the plugin's column has its index too. */
        indexed?: boolean;
        /** The file's UP, rewritten by hand before it runs. */
        edit?: (up: string) => string;
      } = {}
    ) {
      const url = await emptyDatabase();
      use(url);
      wentThrough(await migrateCreate("add_posts", shaped({})));
      wentThrough(await migrate(shaped({})));
      await plantMarker(url, TABLE, options.recorded, options.indexed);
      await on(url, async adapter => {
        await adapter.executeQuery(
          dialect === "mysql"
            ? `UPDATE \`${TABLE}\` SET \`extra\` = 1`
            : `UPDATE "${TABLE}" SET "extra" = 1`
        );
      });
      const before = {
        marker: await markerOf(url),
        shape: await shapeOf(url, TABLE),
      };
      const after = shaped(options.after ?? { without: ["extra"] });
      const written = new Set(files());
      wentThrough(
        await migrateCreate("change_posts", after, { acceptMoves: true })
      );
      if (options.edit !== undefined) {
        const name = files().find(each => !written.has(each))!;
        const path = join(state.dir, "migrations", name);
        writeFileSync(path, options.edit(readFileSync(path, "utf-8")));
      }
      return { url, before, migrated: await migrate(after) };
    }

    /** `nextly migrate` refused the file as drift over the plugin's parts, and changed nothing of TABLE. */
    async function expectDrift(
      ran: Awaited<ReturnType<typeof changedOverTheParts>>
    ) {
      expect(ran.migrated.code, ran.migrated.said).toBe(1);
      expect(ran.migrated.said).toContain("schema drift detected");
      expect(ran.migrated.said).toContain(`+ ${TABLE}.${MARKER} present in DB`);
      expect(await markerOf(ran.url)).toEqual(ran.before.marker);
      expect(await shapeOf(ran.url, TABLE)).toEqual(ran.before.shape);
    }

    // Left out of the comparison only where a row of another owner names the part exactly.
    it.each([
      { record: "no owner row names it", recorded: () => [] },
      {
        record: "the owner row is the app's",
        recorded: (rows: OwnerRecord[]) =>
          rows.map(row => ({
            ...row,
            ownerKind: "app" as const,
            ownerId: "app",
          })),
      },
      {
        record: "the owner row names another table",
        recorded: (rows: OwnerRecord[]) =>
          rows.map(row => ({ ...row, tableName: "dc_mko_other" })),
      },
      {
        record: "the owner row names another kind of part",
        recorded: (rows: OwnerRecord[]) =>
          rows.map(row => ({
            ...row,
            elementKind:
              row.elementKind === "column"
                ? ("index" as const)
                : ("column" as const),
          })),
      },
      {
        record: "the owner row spells its name in another case",
        recorded: (rows: OwnerRecord[]) =>
          rows.map(row => ({
            ...row,
            elementName: row.elementName?.toUpperCase(),
          })),
      },
    ])(
      "nextly migrate refuses a file as drift over a plugin's part where $record, changing nothing",
      async ({ recorded }) => {
        await expectDrift(await changedOverTheParts({ recorded }));
      }
    );

    it("nextly migrate compares the app's own element of the same name, recorded as a plugin's or not", async () => {
      const url = await emptyDatabase();
      use(url);
      const owned = { ownMarker: true };
      wentThrough(await migrateCreate("add_posts", shaped(owned)));
      wentThrough(await migrate(shaped(owned)));
      await on(url, async adapter => {
        await new SchemaOwnersRepository(adapter.getDrizzle(), dialect).upsert(
          ownerRowsToRecord(
            [
              {
                table: TABLE,
                elementKind: "column",
                elementName: MARKER,
                owner: { kind: "plugin", id: PLUGIN },
              },
            ],
            new Set(),
            []
          )
        );
      });
      const after = shaped({ ...owned, without: ["extra"] });
      wentThrough(await migrateCreate("change_posts", after));

      const migrated = await migrate(after);

      expect(migrated.code, migrated.said).toBe(undefined);
      const columns = (await shapeOf(url, TABLE)).columns;
      expect(columns).toContain(MARKER);
      expect(columns).not.toContain("extra");
    });

    it("nextly migrate refuses, before the first file runs, where the record of other owners' elements cannot be read", async () => {
      const url = await emptyDatabase();
      use(url);
      wentThrough(await migrateCreate("add_posts", shaped({})));
      wentThrough(await migrate(shaped({})));
      await plantMarker(url);
      const before = {
        marker: await markerOf(url),
        shape: await shapeOf(url, TABLE),
      };
      const after = shaped({ without: ["extra"] });
      wentThrough(await migrateCreate("change_posts", after));
      // The run's own read of the whole record fails, as it does while its table cannot be read.
      const read = SchemaOwnersRepository.prototype.read;
      const unreadable = vi
        .spyOn(SchemaOwnersRepository.prototype, "read")
        .mockImplementation(function (
          this: SchemaOwnersRepository,
          tables?: readonly string[]
        ) {
          if (tables !== undefined) return read.call(this, tables);
          return Promise.reject(new Error("the owner record is unreadable"));
        });

      const migrated = await migrate(after);
      unreadable.mockRestore();

      expect(migrated.code, migrated.said).not.toBe(undefined);
      expect(migrated.said).toContain("could not be read");
      expect(await markerOf(url)).toEqual(before.marker);
      expect(await shapeOf(url, TABLE)).toEqual(before.shape);
    });

    // SQLite makes a column required by rebuilding its table from what the app's history describes,
    // so what the history does not describe goes with the old table. A generated rebuild stops of its
    // own accord where the table has an index the history does not track, and says nothing of a column.
    it.runIf(dialect === "sqlite").each([
      { part: "column and its index", indexed: true },
      { part: "column alone", indexed: false },
    ])(
      "nextly migrate refuses a file that rebuilds a table as drift over a plugin's $part on it, changing nothing",
      async ({ indexed }) => {
        await expectDrift(
          await changedOverTheParts({ after: { required: ["extra"] }, indexed })
        );
      }
    );

    it("nextly migrate refuses a file whose statements name a plugin's part as drift, changing nothing", async () => {
      const q = (name: string) =>
        dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
      const drop = [
        ...(dialect === "mysql" ? [] : [`DROP INDEX ${q(MARKER_INDEX)};`]),
        `ALTER TABLE ${q(TABLE)} DROP COLUMN ${q(MARKER)};`,
      ].join("\n\n");
      await expectDrift(
        await changedOverTheParts({
          edit: up => up.replace("-- DOWN", `${drop}\n\n-- DOWN`),
        })
      );
    });

    // WAITING, not yet decided how: `nextly migrate` writes no owner row for what a schema hook adds to
    // an entity's table, and once the plugin has left the configuration nothing else says the index
    // is its, so the removal is not refused and takes it.
    it("migrate:create refuses removing a field a removed plugin's index stands on, put there by migrate alone, writing nothing", async () => {
      const url = await emptyDatabase();
      use(url);
      // The control: the plugin's index is made by the app's migration, which records no row for it.
      wentThrough(await migrateCreate("add_posts", pluggedWith(true, true)));
      wentThrough(await migrate(pluggedWith(true, true)));
      expect((await shapeOf(url, TABLE)).indexes).toContain(DECLARED_INDEX);
      const written = files();

      const created = await migrateCreate(
        "remove_code",
        pluggedWith(false, false)
      );

      expect(created.code, created.said).not.toBe(undefined);
      for (const part of ["code", PLUGIN, DECLARED_INDEX, TABLE]) {
        expect(created.said).toContain(part);
      }
      expect(files()).toEqual(written);
      expect((await shapeOf(url, TABLE)).indexes).toContain(DECLARED_INDEX);
    });

    it("migrate:create writes the file and says it was not checked where no database is there", async () => {
      use(absentDatabase());
      wentThrough(await migrateCreate("add_posts", configWith(true)));
      const written = files();

      const created = await migrateCreate("remove_code", configWith(false));

      expect(created.code, created.said).toBe(undefined);
      expect(created.said).toContain("was not checked");
      expect(files()).toHaveLength(written.length + 1);
    });
  }
);
