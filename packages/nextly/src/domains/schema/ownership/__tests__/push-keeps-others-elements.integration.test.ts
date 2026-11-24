/**
 * A schema push that removes a field of an entity declared in code never takes with it an index a
 * plugin built on the field's column. The push is refused before anything runs, naming the field,
 * the plugin, the element, its kind and its table, and the column, the index and their values are
 * left as they were. So is one that moves the field into a group, or turns translation on where that
 * takes the field's column off the table. A field whose column nothing else stands on is still
 * removed, moved or translated, and what the plugin built elsewhere on the table is kept with its
 * values. A reload holds a moved field back before it reaches the push (`init/code-first-moves.ts`);
 * the push itself, which `db:sync` and a restart run, reads it as the column's removal.
 *
 * An index recorded as a plugin's is judged from the owner record even where the push's first
 * read of it gave nothing, as when the question whether the record exists went unanswered: the
 * check asks again, and refuses rather than count none. A field renamed, answered as a rename, is
 * no removal: its column keeps what stands on it. A refused push records no owner row for what the
 * configuration contributes, since it builds none of it, and a push whose owner rows cannot be
 * written runs no statement, so nothing is built that no row records.
 *
 * As it happens: the app declares a collection in code, a plugin's schema hook indexes one of its
 * columns, and the app then removes that field and the change is pushed, as a restart, an HMR
 * reload and `db:sync` push it. On SQLite, PostgreSQL and MySQL, because what a drop takes with it
 * differs between them: PostgreSQL drops the index silently, MySQL drops or narrows it, SQLite
 * rebuilds the table without it.
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, expect, it, vi } from "vitest";

import {
  defineCollection,
  defineFieldGroup,
  fieldGroup,
  group,
  text,
} from "../../../../config";
import { describeEachDialect } from "../../../../plugins/__tests__/helpers/dialect-matrix";
import { definePlugin } from "../../../../plugins/plugin-context";
import {
  createTestNextly,
  type TestDialect,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import { currentMysqlDatabaseName } from "../../pipeline/database-url";
import { introspectLiveSnapshot } from "../../pipeline/diff/introspect-live";
import { applyDesiredSchema } from "../../pipeline/index";
import { RealPreCleanupExecutor } from "../../pipeline/pre-cleanup/executor";
import { PushSchemaPipeline } from "../../pipeline/pushschema-pipeline";
import {
  noopClassifier,
  noopMigrationJournal,
  noopNotifier,
  noopPreRenameExecutor,
} from "../../pipeline/pushschema-pipeline-stubs";
import { RegexRenameDetector } from "../../pipeline/rename-detector";
import { DrizzleStatementExecutor } from "../../services/drizzle-statement-executor";
import { resolveComponentTableName } from "../../utils/resolve-table-name";
import * as keptElements from "../kept-elements";
import { SchemaOwnersRepository } from "../schema-owners-repository";

// The push's first read of the owner record, which a case makes come back empty-handed.
vi.mock("../kept-elements", async importOriginal => {
  const original = await importOriginal<typeof keptElements>();
  return { ...original, pushElementOwners: vi.fn(original.pushElementOwners) };
});

const SLUG = "rk_posts";
const TABLE = `dc_${SLUG}`;
const PLUGIN = "@test/code-indexer";
/** An index on `code` recorded as a plugin's. */
const MIGRATED_INDEX = "rk_migrated_code_idx";
/** A column of the plugin's own, and the index on it. */
const MARKER = "marker";
const MARKER_INDEX = "rk_marker_idx";
const LOCALIZATION = { locales: ["en", "es"], defaultLocale: "en" };

type FieldList = Parameters<
  typeof applyDesiredSchema
>[0]["collections"][string]["fields"];

/** The plugin: an index on the collection's own `code` column. */
const indexer = definePlugin({
  name: PLUGIN,
  version: "1.0.0",
  nextly: ">=0.0.0",
  contributes: {
    schema: {
      extend: [
        ({ schema }) => {
          schema.extendTable(TABLE, { indexes: [{ columns: ["code"] }] });
        },
      ],
    },
  },
});

/** The plugin, declaring schema of its own elsewhere: an index on `note`. */
const noteIndexer = definePlugin({
  name: PLUGIN,
  version: "1.0.0",
  nextly: ">=0.0.0",
  contributes: {
    schema: {
      extend: [
        ({ schema }) => {
          schema.extendTable(TABLE, { indexes: [{ columns: ["note"] }] });
        },
      ],
    },
  },
});

const fields = (withCode: boolean, withNote = true, codeName = "code") => [
  text({ name: "title" }),
  ...(withCode ? [text({ name: codeName })] : []),
  ...(withNote ? [text({ name: "note" })] : []),
];

let handle: TestNextly | undefined;

afterEach(async () => {
  await handle?.destroy();
  handle = undefined;
  vi.unstubAllEnvs();
});

/** The table's column names and the columns each index stands on. */
async function shapeOf(instance: TestNextly, dialect: TestDialect) {
  const snapshot = await introspectLiveSnapshot(
    instance.adapter.getDrizzle(),
    dialect,
    [TABLE]
  );
  const table = snapshot.tables.find(t => t.name === TABLE);
  return {
    columns: (table?.columns ?? []).map(c => c.name).sort(),
    indexes: (table?.indexes ?? [])
      .map(index => index.columns.join(","))
      .sort(),
  };
}

/** The schema the push applies: the collection with `fieldList`. */
const desiredWith = (
  fieldList: FieldList,
  settings: { localized?: boolean } = {}
) => ({
  collections: {
    [SLUG]: { slug: SLUG, tableName: TABLE, fields: fieldList, ...settings },
  },
  singles: {},
  components: {},
});

/** The push of `fieldList` for the collection, as a restart or a reload pushes it. */
function push(fieldList: FieldList, settings: { localized?: boolean } = {}) {
  return applyDesiredSchema(desiredWith(fieldList, settings), "code", {
    promptChannel: "terminal",
  });
}

/** The collection with a group, `inGroup` of its text fields inside it and the others on the row. */
const withGroup = (inGroup: readonly string[]): FieldList => [
  ...["title", "code", "note"]
    .filter(name => !inGroup.includes(name))
    .map(name => text({ name })),
  group({
    name: "meta",
    fields: ["summary", ...inGroup].map(name => text({ name })),
  }),
];

/**
 * The push of `fieldList` with each rename it proposes answered as a rename, as a person answers
 * it at the terminal: the production pipeline, with that answer in place of the terminal.
 */
async function pushAnsweringRenames(
  instance: TestNextly,
  dialect: TestDialect,
  fieldList: FieldList
) {
  const db = instance.adapter.getDrizzle();
  const pipeline = new PushSchemaPipeline({
    executor: new DrizzleStatementExecutor(dialect, db),
    renameDetector: new RegexRenameDetector(),
    classifier: noopClassifier,
    promptDispatcher: {
      dispatch: ({ candidates }) =>
        Promise.resolve({
          confirmedRenames: [...candidates],
          resolutions: [],
          proceed: true,
        }),
    },
    preRenameExecutor: noopPreRenameExecutor,
    preCleanupExecutor: new RealPreCleanupExecutor(),
    migrationJournal: noopMigrationJournal,
    notifier: noopNotifier,
    adapter: instance.adapter,
  });
  return pipeline.apply({
    desired: desiredWith(fieldList),
    db,
    dialect,
    source: "code",
    promptChannel: "terminal",
    databaseName:
      dialect === "mysql" ? await currentMysqlDatabaseName(db) : undefined,
  });
}

/** Makes the index on `column` by its DDL, and records it as the plugin's, as a push writes it. */
async function buildMigratedIndex(
  instance: TestNextly,
  dialect: TestDialect,
  column: string,
  table = TABLE
): Promise<void> {
  const q = (name: string) =>
    dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
  await instance.adapter.executeQuery(
    `CREATE INDEX ${q(MIGRATED_INDEX)} ON ${q(table)} (${q(column)})`
  );
  await new SchemaOwnersRepository(
    (instance.adapter as unknown as DrizzleAdapter).getDrizzle(),
    dialect
  ).upsert([
    {
      tableName: table,
      elementKind: "index",
      elementName: MIGRATED_INDEX,
      ownerKind: "plugin",
      ownerId: PLUGIN,
      migratedBy: `plugin:${PLUGIN}`,
      ownerVersion: "1.0.0",
      schemaVersion: null,
      state: "active",
    },
  ]);
}

/**
 * The plugin's own column on `table`, with its index, recorded as a push writes them, and
 * a value in every row there.
 */
async function plantMarker(
  instance: TestNextly,
  dialect: TestDialect,
  table = TABLE
): Promise<void> {
  const q = (name: string) =>
    dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
  await instance.adapter.executeQuery(
    `ALTER TABLE ${q(table)} ADD COLUMN ${q(MARKER)} ${dialect === "mysql" ? "varchar(64)" : "text"}`
  );
  await instance.adapter.executeQuery(
    `CREATE INDEX ${q(MARKER_INDEX)} ON ${q(table)} (${q(MARKER)})`
  );
  await instance.adapter.executeQuery(
    `UPDATE ${q(table)} SET ${q(MARKER)} = 'kept by the plugin'`
  );
  await new SchemaOwnersRepository(
    (instance.adapter as unknown as DrizzleAdapter).getDrizzle(),
    dialect
  ).upsert(
    (
      [
        ["column", MARKER],
        ["index", MARKER_INDEX],
      ] as const
    ).map(([elementKind, elementName]) => ({
      tableName: table,
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
}

/** The plugin's index and its column's values on `table`, and the table's columns. */
async function markerOf(
  instance: TestNextly,
  dialect: TestDialect,
  table = TABLE
) {
  const q = (name: string) =>
    dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
  const snapshot = await introspectLiveSnapshot(
    instance.adapter.getDrizzle(),
    dialect,
    [table]
  );
  const found = snapshot.tables.find(t => t.name === table);
  return {
    columns: (found?.columns ?? []).map(c => c.name).sort(),
    kept: {
      index: found?.indexes?.find(index => index.name === MARKER_INDEX)
        ?.columns,
      values: (
        await instance.adapter.executeQuery<{ v: unknown }>(
          `SELECT ${q(MARKER)} AS v FROM ${q(table)}`
        )
      ).map(row => row.v),
    },
  };
}

/** The columns the migrated index stands on, or undefined where the table has no such index. */
async function migratedIndexColumns(
  instance: TestNextly,
  dialect: TestDialect
) {
  const snapshot = await introspectLiveSnapshot(
    instance.adapter.getDrizzle(),
    dialect,
    [TABLE]
  );
  return snapshot.tables
    .find(t => t.name === TABLE)
    ?.indexes?.find(index => index.name === MIGRATED_INDEX)?.columns;
}

describeEachDialect(
  "a schema push keeps what a plugin built on a removed field's column",
  dialect => {
    it("refuses removing a field whose column a plugin's index stands on, changing nothing", async () => {
      handle = await createTestNextly({
        dialect,
        collections: [defineCollection({ slug: SLUG, fields: fields(true) })],
        plugins: [indexer],
      });
      const before = await shapeOf(handle, dialect);
      // The fixture's control: the plugin's index stands on `code`.
      expect(before.indexes).toContain("code");
      // The consent to delete `code`'s values, as a deploy gives it: what is refused is the index.
      vi.stubEnv("NEXTLY_ACCEPT_DATA_LOSS", `${TABLE}.code`);

      const pushed = await push(fields(false));

      expect(pushed.success, JSON.stringify(pushed)).toBe(false);
      const message = pushed.success ? "" : pushed.error.message;
      for (const part of ["code", PLUGIN, "index", TABLE]) {
        expect(message).toContain(part);
      }
      expect(await shapeOf(handle, dialect)).toEqual(before);
    });

    it("removes a field whose column nothing else stands on, keeping the plugin's index", async () => {
      handle = await createTestNextly({
        dialect,
        collections: [defineCollection({ slug: SLUG, fields: fields(true) })],
        plugins: [indexer],
      });
      vi.stubEnv("NEXTLY_ACCEPT_DATA_LOSS", `${TABLE}.note`);

      const pushed = await push(fields(true, false));

      expect(pushed.success, JSON.stringify(pushed)).toBe(true);
      const after = await shapeOf(handle, dialect);
      expect(after.columns).not.toContain("note");
      expect(after.indexes).toContain("code");
    });

    // What each change would take off the table, the plugin's index with it.
    it.each([
      {
        change: "moving a field into a group",
        before: withGroup([]),
        after: withGroup(["code"]),
        settings: {},
        dropped: ["code"],
      },
      {
        change: "turning translation on",
        before: fields(true),
        after: fields(true),
        settings: { localized: true },
        dropped: ["title", "code", "note"],
      },
    ])(
      "refuses $change where a plugin's index stands on the field's column, changing nothing",
      async ({ before: first, after, settings, dropped }) => {
        handle = await createTestNextly({
          dialect,
          localization: LOCALIZATION,
          collections: [defineCollection({ slug: SLUG, fields: first })],
        });
        await buildMigratedIndex(handle, dialect, "code");
        const before = await shapeOf(handle, dialect);
        vi.stubEnv(
          "NEXTLY_ACCEPT_DATA_LOSS",
          dropped.map(column => `${TABLE}.${column}`).join(",")
        );

        const pushed = await push(after, settings);

        expect(pushed.success, JSON.stringify(pushed)).toBe(false);
        const message = pushed.success ? "" : pushed.error.message;
        for (const part of [
          "code",
          PLUGIN,
          MIGRATED_INDEX,
          TABLE,
          "Its owner removes it first",
        ]) {
          expect(message).toContain(part);
        }
        expect(await shapeOf(handle, dialect)).toEqual(before);
      }
    );

    // Nothing of the plugin's is built on a column any of these takes off the table.
    it.each([
      {
        change: "removing a field",
        before: fields(true),
        after: fields(true, false),
        settings: {},
        dropped: ["note"],
      },
      {
        change: "moving a field into a group",
        before: withGroup([]),
        after: withGroup(["note"]),
        settings: {},
        dropped: ["note"],
      },
      {
        change: "turning translation on",
        before: fields(true),
        after: fields(true),
        settings: { localized: true },
        dropped: ["title", "code", "note"],
      },
    ])(
      "applies $change, keeping the plugin's column, its index and its values",
      async ({ before: first, after, settings, dropped }) => {
        handle = await createTestNextly({
          dialect,
          localization: LOCALIZATION,
          collections: [defineCollection({ slug: SLUG, fields: first })],
        });
        await handle.nextly.create({
          collection: SLUG,
          data: { title: "t", code: "c", note: "n" },
        } as never);
        await plantMarker(handle, dialect);
        const before = await markerOf(handle, dialect);
        expect(before.kept).toEqual({
          index: [MARKER],
          values: ["kept by the plugin"],
        });
        expect(before.columns).toEqual(expect.arrayContaining(dropped));
        vi.stubEnv(
          "NEXTLY_ACCEPT_DATA_LOSS",
          dropped.map(column => `${TABLE}.${column}`).join(",")
        );

        const pushed = await push(after, settings);

        expect(pushed.success, JSON.stringify(pushed)).toBe(true);
        const now = await markerOf(handle, dialect);
        for (const column of dropped) expect(now.columns).not.toContain(column);
        expect(now.kept).toEqual(before.kept);
      }
    );

    it("applies removing a field group's field, keeping the plugin's column, its index and its values on the shared table", async () => {
      const GROUP = "rk_kept_cards";
      const groupTable = resolveComponentTableName(GROUP);
      const card = (withNote: boolean) =>
        defineFieldGroup({
          slug: GROUP,
          fields: [
            text({ name: "code" }),
            ...(withNote ? [text({ name: "note" })] : []),
          ],
        });
      const posts = defineCollection({
        slug: SLUG,
        fields: [
          text({ name: "title" }),
          fieldGroup({ name: "card", component: GROUP }),
        ],
      });
      handle = await createTestNextly({
        dialect,
        fieldGroups: [card(true)],
        collections: [posts],
      });
      await handle.nextly.create({
        collection: SLUG,
        data: { title: "t", card: { code: "c", note: "n" } },
      } as never);
      await plantMarker(handle, dialect, groupTable);
      const before = await markerOf(handle, dialect, groupTable);
      expect(before.kept).toEqual({
        index: [MARKER],
        values: ["kept by the plugin"],
      });
      expect(before.columns).toContain("note");
      vi.stubEnv("NEXTLY_ACCEPT_DATA_LOSS", `${groupTable}.note`);

      const pushed = await applyDesiredSchema(
        {
          collections: {
            [SLUG]: { slug: SLUG, tableName: TABLE, fields: posts.fields },
          },
          singles: {},
          components: {
            [GROUP]: {
              slug: GROUP,
              tableName: groupTable,
              fields: card(false).fields,
            },
          },
        },
        "code",
        { promptChannel: "terminal" }
      );

      expect(pushed.success, JSON.stringify(pushed)).toBe(true);
      const now = await markerOf(handle, dialect, groupTable);
      expect(now.columns).not.toContain("note");
      expect(now.kept).toEqual(before.kept);
    });

    it("refuses removing a field a plugin's recorded index stands on where the push's first read of the owner record gave nothing", async () => {
      handle = await createTestNextly({
        dialect,
        collections: [defineCollection({ slug: SLUG, fields: fields(true) })],
      });
      await buildMigratedIndex(handle, dialect, "code");
      const before = await shapeOf(handle, dialect);
      vi.stubEnv("NEXTLY_ACCEPT_DATA_LOSS", `${TABLE}.code`);
      // As when the question whether the record exists went unanswered: the first read gives nothing.
      vi.mocked(keptElements.pushElementOwners).mockResolvedValueOnce(
        undefined
      );

      const pushed = await push(fields(false));

      expect(keptElements.pushElementOwners).toHaveBeenCalled();
      expect(pushed.success, JSON.stringify(pushed)).toBe(false);
      const message = pushed.success ? "" : pushed.error.message;
      for (const part of ["code", PLUGIN, MIGRATED_INDEX, TABLE]) {
        expect(message).toContain(part);
      }
      expect(await shapeOf(handle, dialect)).toEqual(before);
    });

    it("runs no statement where its owner rows cannot be written, so nothing is built unrecorded", async () => {
      handle = await createTestNextly({
        dialect,
        collections: [defineCollection({ slug: SLUG, fields: fields(true) })],
        plugins: [indexer],
      });
      const before = await shapeOf(handle, dialect);
      const actual =
        await vi.importActual<typeof keptElements>("../kept-elements");
      vi.mocked(keptElements.pushElementOwners).mockImplementationOnce(
        async input => {
          const owners = await actual.pushElementOwners(input);
          return (
            owners && {
              ...owners,
              write: () =>
                Promise.reject(
                  new Error("the owner registry cannot be written")
                ),
            }
          );
        }
      );

      // A change with a statement of its own: a column the collection lacks.
      const pushed = await push([...fields(true), text({ name: "added" })]);

      expect(keptElements.pushElementOwners).toHaveBeenCalled();
      expect(pushed.success, JSON.stringify(pushed)).toBe(false);
      expect(await shapeOf(handle, dialect)).toEqual(before);
    });

    it("refuses removing a field group's field whose column in its shared table a plugin's recorded index stands on", async () => {
      const GROUP = "rk_cards";
      const groupTable = resolveComponentTableName(GROUP);
      const group = (withCode: boolean) =>
        defineFieldGroup({
          slug: GROUP,
          fields: [
            text({ name: "note" }),
            ...(withCode ? [text({ name: "code" })] : []),
          ],
        });
      const posts = defineCollection({
        slug: SLUG,
        fields: [
          text({ name: "title" }),
          fieldGroup({ name: "card", component: GROUP }),
        ],
      });
      handle = await createTestNextly({
        dialect,
        fieldGroups: [group(true)],
        collections: [posts],
      });
      await buildMigratedIndex(handle, dialect, "code", groupTable);
      const shape = async () => {
        const snapshot = await introspectLiveSnapshot(
          handle!.adapter.getDrizzle(),
          dialect,
          [groupTable]
        );
        const table = snapshot.tables.find(t => t.name === groupTable);
        return {
          columns: (table?.columns ?? []).map(c => c.name).sort(),
          indexes: (table?.indexes ?? []).map(i => i.name).sort(),
        };
      };
      const before = await shape();
      expect(before.indexes).toContain(MIGRATED_INDEX);
      vi.stubEnv("NEXTLY_ACCEPT_DATA_LOSS", `${groupTable}.code`);

      const pushed = await applyDesiredSchema(
        {
          collections: {
            [SLUG]: { slug: SLUG, tableName: TABLE, fields: posts.fields },
          },
          singles: {},
          components: {
            [GROUP]: {
              slug: GROUP,
              tableName: groupTable,
              fields: group(false).fields,
            },
          },
        },
        "code",
        { promptChannel: "terminal" }
      );

      expect(pushed.success, JSON.stringify(pushed)).toBe(false);
      const message = pushed.success ? "" : pushed.error.message;
      for (const part of ["code", PLUGIN, MIGRATED_INDEX, groupTable]) {
        expect(message).toContain(part);
      }
      expect(await shape()).toEqual(before);
    });

    it("records no owner row when the push is refused", async () => {
      handle = await createTestNextly({
        dialect,
        collections: [defineCollection({ slug: SLUG, fields: fields(true) })],
        plugins: [noteIndexer],
      });
      await buildMigratedIndex(handle, dialect, "code");
      const repository = new SchemaOwnersRepository(
        (handle.adapter as unknown as DrizzleAdapter).getDrizzle(),
        dialect
      );
      // The row the boot recorded for the plugin's declared index, removed so that this push
      // records it as a contribution it has not recorded yet.
      const declared = (await repository.read([TABLE])).filter(
        row => row.ownerId === PLUGIN && row.elementName !== MIGRATED_INDEX
      );
      expect(declared.map(row => row.elementKind)).toEqual(["index"]);
      for (const row of declared) {
        await repository.deleteElement(
          row.tableName,
          "index",
          row.elementName ?? ""
        );
      }
      vi.stubEnv("NEXTLY_ACCEPT_DATA_LOSS", `${TABLE}.code`);

      const pushed = await push(fields(false));

      expect(pushed.success, JSON.stringify(pushed)).toBe(false);
      expect(pushed.success ? "" : pushed.error.message).toContain(
        MIGRATED_INDEX
      );
      expect(
        (await repository.read([TABLE])).map(row => row.elementName)
      ).toEqual([MIGRATED_INDEX]);
    });

    it("renames a field a plugin's recorded index stands on, answered as a rename, keeping the index", async () => {
      handle = await createTestNextly({
        dialect,
        collections: [defineCollection({ slug: SLUG, fields: fields(true) })],
        plugins: [noteIndexer],
      });
      await buildMigratedIndex(handle, dialect, "code");
      expect(await migratedIndexColumns(handle, dialect)).toEqual(["code"]);

      const pushed = await pushAnsweringRenames(
        handle,
        dialect,
        fields(true, true, "ref")
      );

      expect(pushed.success, JSON.stringify(pushed)).toBe(true);
      expect(pushed.renamesApplied).toBe(1);
      const after = await shapeOf(handle, dialect);
      expect(after.columns).toContain("ref");
      expect(after.columns).not.toContain("code");
      expect(after.indexes).toContain("ref");
      // The plugin's own index, on the renamed column.
      expect(await migratedIndexColumns(handle, dialect)).toEqual(["ref"]);
    });
  }
);
