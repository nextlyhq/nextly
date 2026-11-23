/**
 * A schema push that removes a field of an entity declared in code never takes with it an index a
 * plugin built on the field's column. The push is refused before anything runs, naming the field,
 * the plugin, the element, its kind and its table, and the column, the index and their values are
 * left as they were. A field whose column nothing else stands on is still removed.
 *
 * An index a plugin's migration built is judged from the owner record even where the push's first
 * read of it gave nothing, as when the question whether the record exists went unanswered: the
 * check asks again, and refuses rather than count none. A field renamed, answered as a rename, is
 * no removal: its column keeps what stands on it. A refused push records no owner row for what the
 * configuration contributes, since it builds none of it.
 *
 * As it happens: the app declares a collection in code, a plugin's schema hook indexes one of its
 * columns, and the app then removes that field and the change is pushed, as a restart, an HMR
 * reload and `db:sync` push it. On SQLite, PostgreSQL and MySQL, because what a drop takes with it
 * differs between them: PostgreSQL drops the index silently, MySQL drops or narrows it, SQLite
 * rebuilds the table without it.
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, expect, it, vi } from "vitest";

import { defineCollection, text } from "../../../../config";
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
/** An index on `code` a plugin's migration built, as its run records it. */
const MIGRATED_INDEX = "rk_migrated_code_idx";

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
const desiredWith = (fieldList: ReturnType<typeof fields>) => ({
  collections: {
    [SLUG]: { slug: SLUG, tableName: TABLE, fields: fieldList },
  },
  singles: {},
  components: {},
});

/** The push of `fieldList` for the collection, as a restart or a reload pushes it. */
function push(fieldList: ReturnType<typeof fields>) {
  return applyDesiredSchema(desiredWith(fieldList), "code", {
    promptChannel: "terminal",
  });
}

/**
 * The push of `fieldList` with each rename it proposes answered as a rename, as a person answers
 * it at the terminal: the production pipeline, with that answer in place of the terminal.
 */
async function pushAnsweringRenames(
  instance: TestNextly,
  dialect: TestDialect,
  fieldList: ReturnType<typeof fields>
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

/** Builds the index on `column` as the plugin's migration does, and records it as that run does. */
async function buildMigratedIndex(
  instance: TestNextly,
  dialect: TestDialect,
  column: string
): Promise<void> {
  const q = (name: string) =>
    dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
  await instance.adapter.executeQuery(
    `CREATE INDEX ${q(MIGRATED_INDEX)} ON ${q(TABLE)} (${q(column)})`
  );
  await new SchemaOwnersRepository(
    (instance.adapter as unknown as DrizzleAdapter).getDrizzle(),
    dialect
  ).upsert([
    {
      tableName: TABLE,
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

/** The names of the table's indexes. */
async function indexNamesOf(instance: TestNextly, dialect: TestDialect) {
  const snapshot = await introspectLiveSnapshot(
    instance.adapter.getDrizzle(),
    dialect,
    [TABLE]
  );
  return (snapshot.tables.find(t => t.name === TABLE)?.indexes ?? [])
    .map(index => index.name)
    .sort();
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

    it("refuses removing a field a plugin's migration indexed where the push's first read of the owner record gave nothing", async () => {
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

    it("renames a field a plugin's migration indexed, answered as a rename, keeping the index", async () => {
      handle = await createTestNextly({
        dialect,
        collections: [defineCollection({ slug: SLUG, fields: fields(true) })],
        plugins: [noteIndexer],
      });
      await buildMigratedIndex(handle, dialect, "code");
      expect(await indexNamesOf(handle, dialect)).toContain(MIGRATED_INDEX);

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
      expect(await indexNamesOf(handle, dialect)).toContain(MIGRATED_INDEX);
    });
  }
);
