/**
 * A full `nextly plugins uninstall` of a plugin whose transform put a
 * relationship field into a group of the app's collection, on every
 * configured dialect, through the command's entry point.
 *
 * The field points at the plugin's own collection, and it is the plugin's:
 * it goes when the plugin goes, so it is no reason to refuse. A field of the
 * app's own in that group pointing at the same collection still is, since
 * dropping the collection would take what the app built on it, and so is a
 * field of the app's the transform only moved into that group: moving a
 * field does not make it the plugin's.
 *
 * The boot that registers both collections, folding the transform in, is
 * the real one, and so is the fold the command's config is read through.
 * What the plugin's module left is recorded through the ledger's and the
 * owner registry's own repositories: the module that owns the collection's
 * table, recorded applied over the table the boot's sync created, with its
 * DOWN dropping it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { defineCollection, group, relationship, text } from "../../../config";
import type { FieldConfig } from "../../../collections/fields/types";
import { SchemaEventsRepository } from "../../../domains/schema/events/schema-events-repository";
import { reconcileCore } from "../../../domains/schema/migrate/core-reconcile";
import { resolveDataLossConsent } from "../../../domains/schema/migrate/data-loss-consent";
import {
  migrationChecksum,
  type PluginMigration,
} from "../../../domains/schema/migrate/plugin/plugin-migration";
import { assertBootPluginsInstalled } from "../../../domains/schema/ownership/plugin-install-gate";
import { SchemaOwnersRepository } from "../../../domains/schema/ownership/schema-owners-repository";
import { resolveCollectionTableName } from "../../../domains/schema/utils/resolve-table-name";
import type { EntityTransform } from "../../../plugins/entity-transforms";
import {
  definePlugin,
  type PluginDefinition,
} from "../../../plugins/plugin-context";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CommandContext } from "../../program";
import { createLogger } from "../../utils/logger";
import { runPluginUninstall } from "../plugin-lifecycle-runner";

const ALL = ["postgresql", "mysql", "sqlite"] as const;
type Dialect = (typeof ALL)[number];

const run = vi.hoisted(() => ({
  dialect: "sqlite" as string,
  adapter: undefined as unknown,
  collections: [] as unknown[],
  plugin: undefined as unknown,
}));

// The config as the loader hands it to the command: folded by the loader's
// own fold, with the fields the fold records each plugin adding.
vi.mock("../../utils/config-loader", async () => {
  const { applyPluginSchemaContributionsDeferred } = await import(
    "../../../plugins/schema/apply-contributions"
  );
  type FoldArgs = Parameters<typeof applyPluginSchemaContributionsDeferred>;
  return {
    loadConfig: async () => {
      const appConfig = {
        db: { migrationsDir: "./migrations" },
        collections: run.collections,
        plugins: [run.plugin],
      };
      const folded = applyPluginSchemaContributionsDeferred(
        appConfig as unknown as FoldArgs[0],
        [run.plugin] as FoldArgs[1]
      );
      return {
        config: folded.config,
        appConfig,
        pluginConsent: undefined,
        fieldsAddedByPlugins: folded.fieldsAddedByPlugins,
      };
    },
  };
});

vi.mock("../../utils/adapter", () => ({
  validateDatabaseEnv: () => ({
    valid: true,
    dialect: run.dialect,
    databaseUrl: "unused",
  }),
  // The test's adapter, kept connected after the command so the test can
  // read the database.
  createCliAdapter: async () =>
    Object.assign(Object.create(run.adapter as object) as object, {
      disconnect: async () => {},
    }),
}));

const context = {
  logger: createLogger({ quiet: true }),
} as unknown as CommandContext;

/** The data-loss consent given without targets, as `--accept-data-loss` alone gives it. */
const EVERY_DELETION = resolveDataLossConsent({ flag: true, env: {} });

const PLUGIN = "@acme/nf";
const NOTES = "nf-notes";
const NOTES_TABLE = resolveCollectionTableName(NOTES);
const POSTS_TABLE = resolveCollectionTableName("posts");

/**
 * The app's collection, with a group holding `extra` beside its own field,
 * and `top` beside the group.
 */
function posts(extra: FieldConfig[] = [], top: FieldConfig[] = []) {
  return defineCollection({
    slug: "posts",
    fields: [
      text({ name: "title" }),
      ...top,
      group({ name: "settings", fields: [text({ name: "theme" }), ...extra] }),
    ],
  });
}

/** The plugin's transform: a relationship to its notes inside `settings`. */
const nestNote: EntityTransform = {
  target: "posts",
  transform: entity => ({
    ...entity,
    fields: ((entity.fields as FieldConfig[] | undefined) ?? []).map(field =>
      field.type === "group" && field.name === "settings"
        ? {
            ...field,
            fields: [
              ...field.fields,
              relationship({ name: "nfNote", relationTo: NOTES }),
            ],
          }
        : field
    ),
  }),
};

/** A transform that moves the app's own `appNote` into `settings`. */
const moveAppNote: EntityTransform = {
  target: "posts",
  transform: entity => {
    const fields = (entity.fields as FieldConfig[] | undefined) ?? [];
    const isAppNote = (field: FieldConfig): boolean =>
      (field as { name?: string }).name === "appNote";
    const moved = fields.filter(isAppNote);
    return {
      ...entity,
      fields: fields
        .filter(field => !isAppNote(field))
        .map(field =>
          field.type === "group" && field.name === "settings"
            ? { ...field, fields: [...field.fields, ...moved] }
            : field
        ),
    };
  },
};

/**
 * The same move, with a text field of the moved one's name put at the path
 * it left: a different field reusing that path.
 */
const moveAppNoteReusingItsPath: EntityTransform = {
  target: "posts",
  transform: entity => {
    const moved = moveAppNote.transform(entity);
    return {
      ...moved,
      fields: [
        ...((moved.fields as FieldConfig[] | undefined) ?? []),
        text({ name: "appNote" }),
      ],
    };
  },
};

/** The plugin as the boot sees it: its notes, and `transform`. */
function bootPlugin(transform: EntityTransform) {
  return definePlugin({
    name: PLUGIN,
    version: "1.0.0",
    nextly: ">=0.0.0",
    contributes: {
      collections: [
        defineCollection({ slug: NOTES, fields: [text({ name: "body" })] }),
      ],
      transforms: [transform],
    },
  });
}

/** `name` quoted as `dialect` quotes a name. */
function quoted(dialect: Dialect, name: string): string {
  return dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
}

/** The plugin's module owning its notes' table, whose DOWN drops it. */
function notesModule(): PluginMigration {
  const noTables = {
    postgresql: { tables: [] },
    mysql: { tables: [] },
    sqlite: { tables: [] },
  };
  const side = (dialect: Dialect) => ({
    up: [],
    down: [`DROP TABLE ${quoted(dialect, NOTES_TABLE)}`],
  });
  const content = {
    name: "20261103_090000_000_notes",
    schemaVersion: 1,
    dialects: {
      postgresql: side("postgresql"),
      mysql: side("mysql"),
      sqlite: side("sqlite"),
    },
    snapshot: noTables,
    before: noTables,
  };
  return { ...content, checksum: migrationChecksum(content) };
}

describe.each(getConfiguredTestDialects())(
  "a full uninstall of a plugin that put a field inside the app's group (%s)",
  dialect => {
    let handle: TestNextly;
    const db = () => handle.adapter.getDrizzle();
    const module = notesModule();

    /**
     * Boots the app with the plugin, and records the plugin's module as
     * applied and its notes' table as the plugin's.
     */
    async function setUp(
      appFields: FieldConfig[],
      transform: EntityTransform = nestNote,
      appTop: FieldConfig[] = []
    ): Promise<void> {
      const booted = bootPlugin(transform);
      run.collections = [posts(appFields, appTop)];
      handle = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        collections: [posts(appFields, appTop)],
        plugins: [booted],
      });
      await reconcileCore({
        db: db(),
        dialect,
        logger: { info: () => {}, warn: () => {} },
      });
      run.dialect = dialect;
      run.adapter = handle.adapter;
      run.plugin = {
        ...booted,
        contributes: {
          ...booted.contributes,
          schema: { migrations: [module] },
        },
      } satisfies PluginDefinition;
      await new SchemaEventsRepository(db(), dialect).insertEvent({
        eventType: "file_apply",
        status: "applied",
        source: "cli-migrate",
        filename: `plugin:${PLUGIN}/${module.name}`,
        sha256: module.checksum,
        startedAt: new Date(),
      });
      await new SchemaOwnersRepository(db(), dialect).upsert([
        {
          tableName: NOTES_TABLE,
          elementKind: "table",
          elementName: "",
          ownerKind: "plugin",
          ownerId: PLUGIN,
          migratedBy: `plugin:${PLUGIN}`,
          ownerVersion: "1.0.0",
          schemaVersion: 1,
          state: "active",
        },
      ]);
    }

    afterEach(async () => {
      await handle?.destroy();
    });

    const uninstall = () =>
      runPluginUninstall(
        PLUGIN,
        { keepData: false, yes: false, consent: EVERY_DELETION },
        context
      );

    /** The boot's gate over this database, as a production boot runs it. */
    const boot = () =>
      assertBootPluginsInstalled({
        plugins: [{ name: PLUGIN }],
        readLifecycleEvents: () =>
          new SchemaEventsRepository(db(), dialect).listPluginLifecycle(),
        ledgerExists: async () => true,
        readOwners: () => new SchemaOwnersRepository(db(), dialect).read(),
        registryExists: async () => true,
        production: true,
        warn: () => {},
      });

    async function columnsOf(table: string): Promise<string[]> {
      const rows = (await handle.adapter.executeQuery(
        dialect === "sqlite"
          ? `SELECT name FROM pragma_table_info('${table}')`
          : `SELECT column_name AS name FROM information_schema.columns WHERE table_name = '${table}'${dialect === "mysql" ? " AND table_schema = DATABASE()" : " AND table_schema = current_schema()"}`
      )) as Array<Record<string, unknown>>;
      return rows.map(row => String(row.name ?? row.NAME)).sort();
    }

    async function titles(): Promise<string[]> {
      const rows = (await handle.adapter.executeQuery(
        `SELECT ${quoted(dialect, "title")} AS title FROM ${quoted(dialect, POSTS_TABLE)}`
      )) as Array<{ title: string }>;
      return rows.map(row => row.title);
    }

    it("drops the plugin's collection and nothing of the app's", async () => {
      await setUp([]);
      await handle.nextly.create({
        collection: "posts",
        data: { title: "kept", settings: { theme: "dark" } },
      });
      const appColumns = await columnsOf(POSTS_TABLE);
      expect(await handle.adapter.tableExists(NOTES_TABLE)).toBe(true);

      await uninstall();

      expect(await handle.adapter.tableExists(NOTES_TABLE)).toBe(false);
      expect(await columnsOf(POSTS_TABLE)).toEqual(appColumns);
      expect(await titles()).toEqual(["kept"]);
      await expect(boot()).rejects.toMatchObject({
        code: "PLUGIN_SCHEMA_UNINSTALLED",
      });
    });

    it("still refuses over the app's own field in that group, naming it alone", async () => {
      await setUp([relationship({ name: "appNote", relationTo: NOTES })]);

      const refusal: unknown = await uninstall().then(
        () => undefined,
        (error: unknown) => error
      );

      expect(refusal).toMatchObject({
        code: "PLUGIN_UNINSTALL_WOULD_DROP_OTHERS",
      });
      const { publicMessage } = refusal as { publicMessage: string };
      expect(publicMessage).toContain("settings.appNote");
      expect(publicMessage).not.toContain("settings.nfNote");
      expect(await handle.adapter.tableExists(NOTES_TABLE)).toBe(true);
    });

    it("still refuses over an app field the transform only moved into that group", async () => {
      await setUp([], moveAppNote, [
        relationship({ name: "appNote", relationTo: NOTES }),
      ]);

      const refusal: unknown = await uninstall().then(
        () => undefined,
        (error: unknown) => error
      );

      expect(refusal).toMatchObject({
        code: "PLUGIN_UNINSTALL_WOULD_DROP_OTHERS",
      });
      expect((refusal as { publicMessage: string }).publicMessage).toContain(
        "settings.appNote"
      );
      expect(await handle.adapter.tableExists(NOTES_TABLE)).toBe(true);
    });

    it("still refuses over an app field the transform moved when a different field takes its old path", async () => {
      await setUp([], moveAppNoteReusingItsPath, [
        relationship({ name: "appNote", relationTo: NOTES }),
      ]);

      const refusal: unknown = await uninstall().then(
        () => undefined,
        (error: unknown) => error
      );

      expect(refusal).toMatchObject({
        code: "PLUGIN_UNINSTALL_WOULD_DROP_OTHERS",
      });
      expect((refusal as { publicMessage: string }).publicMessage).toContain(
        "settings.appNote"
      );
      expect(await handle.adapter.tableExists(NOTES_TABLE)).toBe(true);
    });
  }
);
