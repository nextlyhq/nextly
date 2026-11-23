/**
 * A Builder save the process left part-way is settled at the next development start, or before the
 * next Builder save, from what the database and the migration folder hold.
 *
 * A kill is made as the record's own suite makes one: the step at the kill point runs and then never
 * returns, so no `catch` or `finally` of the save runs. The settle then runs on the same database and
 * folder, as the next start's step would (`settleLeftSaves`). The stopped process's schema lock and
 * writer hold are cleared by hand where a later save must take them, as their lapse would.
 *
 * - **none**: stopped after its migration file was written, before it ran. The settle removes the
 *   file and its snapshot, puts the definition back, and clears the record.
 * - **all**: stopped after everything applied, before its record was cleared. The settle records
 *   nothing new, brings the registry row up, and clears the record.
 * - **pending**: a Single turning translation on, stopped after its main file applied and before its
 *   translations file ran. The settle keeps both files and clears the record, and the start's
 *   migration step runs the rest. Before that start, a Builder save is refused, naming the step.
 * - A definition edited after the stop is left as it is, and named.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join, relative } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runFileMigrations } from "../../../../cli/commands/migrate";
import { createLogger } from "../../../../cli/utils/logger";
import { writeAppliedFieldsRow } from "../../../../dispatcher/helpers/applied-fields-row";
import { dispatchCollections } from "../../../../dispatcher/handlers/collection-dispatcher";
import { dispatchSingles } from "../../../../dispatcher/handlers/single-dispatcher";
import { runBootTimeApplyIfDev } from "../../../../init/boot-apply";
import { NextlyError } from "../../../../errors/nextly-error";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../../services";
import { consoleLogger } from "../../../../shared/types";
import type { CollectionService } from "../../../collections/services/collection-service";
import { MetaService } from "../../../meta/services/meta-service";
import { SchemaEventsRepository } from "../../events/schema-events-repository";
import { recordAlreadyApplied } from "../../migrate/drift-reconcile";
import { BLANK_FILE_LINE } from "../../migrate/history-line";
import { WRITER_LOCK_FILE } from "../../migrate-create/writer-hold";
import { introspectLiveSnapshot } from "../../pipeline/diff/introspect-live";
import { SCHEMA_LOCK_TABLE } from "../../pipeline/schema-lock";
import { writeCollectionSave, type BuilderSaveSetup } from "../collection-save";
import {
  settleBeforeBuilderSave,
  settleLeftSaves,
  type SettledSave,
} from "../settle-left-save";
import {
  recordSaveStarted,
  refuseBesideLeftSaves,
  withSaveRecords,
} from "../save-in-progress";
import { settleRegistryWriter } from "../settle-registry";

/** Where the save is stopped, and how to let it go. Shared with the module mocks below. */
const kill = vi.hoisted(() => ({
  at: undefined as undefined | ((point: string) => boolean),
  reached: undefined as undefined | (() => void),
  release: undefined as undefined | (() => void),
}));

/** Stop for good where `point` is the kill point; the case releases it once it has looked. */
const stopHere = vi.hoisted(() => async (point: string): Promise<void> => {
  if (kill.at === undefined || !kill.at(point)) return;
  kill.at = undefined;
  await new Promise<void>((_, reject) => {
    kill.release = () =>
      reject(new Error(`the process was killed at ${point}`));
    kill.reached?.();
  });
});

// Every migration file and the definition are put in place by a rename: stop after one.
vi.mock("node:fs/promises", async importOriginal => {
  const real = await importOriginal<typeof import("node:fs/promises")>();
  const rename: typeof real.rename = async (from, to) => {
    await real.rename(from, to);
    await stopHere(`file:${String(to)}`);
  };
  return { ...real, rename, default: { ...real, rename } };
});

/**
 * Whether the migrate lock lets its work through without taking the lock: for the development
 * start's own entry, whose lock the stopped save, still in this process, holds as only its
 * process ending would release.
 */
const lockPassesThrough = vi.hoisted(() => ({ on: false }));

vi.mock("../../pipeline/locks", async original => {
  const actual = await original<typeof import("../../pipeline/locks")>();
  return {
    ...actual,
    withMigrateLock: (async (
      ...args: Parameters<typeof actual.withMigrateLock>
    ) => {
      if (!lockPassesThrough.on) return actual.withMigrateLock(...args);
      return { ran: true, value: await args[2]() };
    }) as typeof actual.withMigrateLock,
  };
});

/**
 * The folder the development start's migrate step reads, where a case sets it: the step reads the
 * process's own config, whose folder is not the one these saves write to.
 */
const bootFolder = vi.hoisted(() => ({
  dir: undefined as string | undefined,
  /** A folder no configuration loads from, as a `basePath` holding no configuration file. */
  noConfigAt: undefined as string | undefined,
}));

vi.mock("../../../../cli/utils/config-loader", async original => {
  const actual =
    await original<typeof import("../../../../cli/utils/config-loader")>();
  return {
    ...actual,
    loadConfig: (async (...args: Parameters<typeof actual.loadConfig>) => {
      if (
        bootFolder.noConfigAt !== undefined &&
        args[0]?.cwd === bootFolder.noConfigAt
      ) {
        throw new Error(`no configuration file in ${bootFolder.noConfigAt}`);
      }
      const loaded = await actual.loadConfig(...args);
      if (bootFolder.dir === undefined) return loaded;
      return {
        ...loaded,
        config: {
          ...loaded.config,
          db: {
            ...loaded.config.db,
            migrationsDir: relative(process.cwd(), bootFolder.dir),
          },
        },
      };
    }) as typeof actual.loadConfig,
  };
});

/**
 * The development start's migrate step, watched where a case asks: its database settings taken as
 * valid (the test's database is reached through the instance, not the environment), and each run of
 * `migrateCore` counted before it goes on as it would.
 */
const migrateStep = vi.hoisted(() => ({
  watch: false,
  runs: 0,
  registrations: 0,
  /**
   * Run the folder's pending files through the normal runner in place of the whole migrate step,
   * which also judges the process's own config against the database this case does not hold.
   */
  byFiles: false,
  /** Stand in for the migrate step by running nothing, so a pending save stays pending. */
  runsNothing: false,
}));

/**
 * The start's code-first reload, counted where a case watches the start. `stub` answers it as
 * finished without running it, for a case whose stopped save still holds what the reload waits on.
 */
const reloads = vi.hoisted(() => ({ count: 0, stub: false }));

vi.mock("../../../../init/reload-config", async original => {
  const actual =
    await original<typeof import("../../../../init/reload-config")>();
  return {
    ...actual,
    reloadNextlyConfig: (async (
      ...args: Parameters<typeof actual.reloadNextlyConfig>
    ) => {
      reloads.count += 1;
      if (reloads.stub) return "finished";
      return actual.reloadNextlyConfig(...args);
    }) as typeof actual.reloadNextlyConfig,
  };
});

/** Make the settle's last step, the removal of stale markers, throw, where a case asks. */
const staleMarkers = vi.hoisted(() => ({ fail: false }));

vi.mock("../save-in-progress", async original => {
  const actual = await original<typeof import("../save-in-progress")>();
  return {
    ...actual,
    removeStaleMarkers: (async (
      ...args: Parameters<typeof actual.removeStaleMarkers>
    ) => {
      if (staleMarkers.fail) {
        throw new Error("the save-in-progress folder could not be read");
      }
      return actual.removeStaleMarkers(...args);
    }) as typeof actual.removeStaleMarkers,
  };
});

// The start's registration of entities from snapshots, counted where a case watches the start.
vi.mock("../../migrate/metadata-register", async original => {
  const actual =
    await original<typeof import("../../migrate/metadata-register")>();
  return {
    ...actual,
    registerFromMigrations: (async (
      ...args: Parameters<typeof actual.registerFromMigrations>
    ) => {
      if (migrateStep.watch) migrateStep.registrations += 1;
      return actual.registerFromMigrations(...args);
    }) as typeof actual.registerFromMigrations,
  };
});

vi.mock("../../../../cli/utils/adapter", async original => {
  const actual =
    await original<typeof import("../../../../cli/utils/adapter")>();
  return {
    ...actual,
    validateDatabaseEnv: (() =>
      migrateStep.watch
        ? { valid: true, errors: [] }
        : actual.validateDatabaseEnv()) as typeof actual.validateDatabaseEnv,
  };
});

vi.mock("../../../../cli/commands/migrate", async original => {
  const actual =
    await original<typeof import("../../../../cli/commands/migrate")>();
  return {
    ...actual,
    migrateCore: (async (...args: Parameters<typeof actual.migrateCore>) => {
      if (migrateStep.watch) migrateStep.runs += 1;
      if (migrateStep.runsNothing) {
        return {
          applied: 0,
          pluginModulesApplied: 0,
          metadata: { collectionsRegistered: 0, singlesRegistered: 0 },
        } as never;
      }
      if (!migrateStep.byFiles) return actual.migrateCore(...args);
      const [deps] = args as unknown as [
        {
          adapter: unknown;
          db: unknown;
          dialect: Parameters<typeof actual.runFileMigrations>[0]["dialect"];
          migrationsDir: string;
        },
      ];
      await actual.runFileMigrations({
        adapter: deps.adapter as never,
        db: deps.db,
        dialect: deps.dialect,
        migrationsDir: deps.migrationsDir,
        logger: (await import("../../../../cli/utils/logger")).createLogger({
          quiet: true,
        }),
      });
      return {
        applied: 1,
        pluginModulesApplied: 0,
        metadata: { collectionsRegistered: 0, singlesRegistered: 0 },
      } as never;
    }) as typeof actual.migrateCore,
  };
});

// Each file runs as a unit: stop before one starts, as a process killed between two files would.
vi.mock("../../busy-table/run-unit", async original => {
  const actual = await original<typeof import("../../busy-table/run-unit")>();
  return {
    ...actual,
    runUnitInTries: async (
      ...args: Parameters<typeof actual.runUnitInTries>
    ) => {
      await stopHere(`unit:${args[2].source}`);
      return actual.runUnitInTries(...args);
    },
  };
});

const HISTORY = "./database/history";
const DEFINITION = "./schema/builder.json";
const RECORD_KEY = "builder-save-in-progress:single:settle_hero";
const SLUG = "settle_hero";
const TABLE = "single_settle_hero";

let current: TestNextly | undefined;
let basePath: string;
let stopped: Promise<unknown> | undefined;

beforeEach(() => {
  basePath = mkdtempSync(join(tmpdir(), "nextly-settle-left-save-"));
});

afterEach(async () => {
  lockPassesThrough.on = false;
  bootFolder.dir = undefined;
  bootFolder.noConfigAt = undefined;
  migrateStep.watch = false;
  migrateStep.runs = 0;
  migrateStep.registrations = 0;
  migrateStep.byFiles = false;
  migrateStep.runsNothing = false;
  staleMarkers.fail = false;
  reloads.count = 0;
  reloads.stub = false;
  kill.at = undefined;
  kill.reached = undefined;
  kill.release?.();
  kill.release = undefined;
  await stopped;
  stopped = undefined;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await current?.destroy();
  current = undefined;
  rmSync(basePath, { recursive: true, force: true });
});

type BuilderField = Record<string, unknown>;
const text = (name: string, extra: BuilderField = {}): BuilderField => ({
  name,
  type: "text",
  ...extra,
});

async function versionOf(t: TestNextly): Promise<number> {
  const [row] = await t.adapter.select<{ schemaVersion: unknown }>(
    "dynamic_singles",
    { where: { and: [{ column: "slug", op: "=", value: SLUG }] } }
  );
  return Number(row?.schemaVersion ?? 1);
}

async function save(
  t: TestNextly,
  fields: BuilderField[],
  localized?: boolean
): Promise<unknown> {
  return dispatchSingles(
    "applySingleSchemaChanges",
    { slug: SLUG },
    {
      fields,
      confirmed: true,
      ...(localized === undefined ? {} : { localized }),
      schemaVersion: await versionOf(t),
    }
  );
}

/** Start a save of `fields` and stop it where `at` says; resolves once it has stopped there. */
async function stopSave(
  t: TestNextly,
  fields: BuilderField[],
  at: (point: string) => boolean,
  localized?: boolean
): Promise<void> {
  const reached = new Promise<void>(resolve => {
    kill.reached = resolve;
  });
  kill.at = at;
  stopped = save(t, fields, localized).catch((error: unknown) => error);
  const outcome = await Promise.race([
    reached.then(() => "reached"),
    stopped.then(answer => `the save ended first: ${String(answer)}`),
  ]);
  expect(outcome, "the save never reached the kill point").toBe("reached");
}

const HISTORY_DIR = () => join(basePath, HISTORY);
const sqlFiles = () =>
  existsSync(HISTORY_DIR())
    ? readdirSync(HISTORY_DIR())
        .filter(name => name.endsWith(".sql"))
        .sort()
    : [];
const definitionText = () => {
  const file = join(basePath, DEFINITION);
  return existsSync(file) ? readFileSync(file, "utf-8") : null;
};

async function recordRow(t: TestNextly): Promise<unknown> {
  const entry = await new MetaService(t.adapter, consoleLogger).getEntry(
    RECORD_KEY
  );
  return entry.present ? entry.value : undefined;
}

async function liveColumns(t: TestNextly, table: string): Promise<string[]> {
  const live = await introspectLiveSnapshot(
    t.adapter.getDrizzle(),
    t.adapter.dialect,
    [table]
  );
  return (live.tables.find(each => each.name === table)?.columns ?? []).map(
    column => column.name
  );
}

async function registryFieldNames(t: TestNextly): Promise<string[]> {
  const [row] = await t.adapter.select<{ fields: unknown }>("dynamic_singles", {
    where: { and: [{ column: "slug", op: "=", value: SLUG }] },
  });
  const fields =
    typeof row?.fields === "string" ? JSON.parse(row.fields) : row?.fields;
  return (fields as Array<{ name: string }>).map(field => field.name);
}

/** A migration written by hand: `header` above its UP line, statements that change nothing. */
const byHand = (header: string[]): string =>
  [
    "-- Migration: by_hand",
    ...header,
    "",
    "-- UP",
    "SELECT 1;",
    "",
    "-- DOWN",
    "SELECT 1;",
    "",
  ].join("\n");

/** The settle, as the next development start runs it, over the same database and folder. */
function settle(t: TestNextly): Promise<SettledSave[]> {
  return settleLeftSaves({
    adapter: t.adapter,
    projectRoot: basePath,
    migrationsDir: HISTORY_DIR(),
    logger: { info: () => undefined, warn: () => undefined },
    writeRegistry: settleRegistryWriter(t.adapter),
  });
}

/** What the stopped process held, cleared as its lapse would clear it. */
async function clearStoppedHolds(t: TestNextly): Promise<void> {
  await t.adapter.executeQuery(`DELETE FROM ${SCHEMA_LOCK_TABLE}`);
  rmSync(join(HISTORY_DIR(), WRITER_LOCK_FILE), { force: true });
}

describe.each(getConfiguredTestDialects())(
  "a Builder save left part-way, settled (%s)",
  (dialect: TestDialect) => {
    async function boot(): Promise<TestNextly> {
      vi.stubEnv("NODE_ENV", "development");
      current = await createTestNextly({
        dialect,
        basePath,
        db: { migrationsDir: HISTORY, uiSchemaFile: DEFINITION },
        // Languages, so a Single may be saved translated.
        localization: { locales: ["en", "es"], defaultLocale: "en" },
      });
      return current;
    }

    async function created(t: TestNextly): Promise<void> {
      await dispatchSingles(
        "createSingle",
        {},
        { slug: SLUG, label: SLUG, fields: [text("heading")] }
      );
      expect(await recordRow(t), "after the create").toBeUndefined();
    }

    it("settles a save stopped before its file ran as none of it: files gone, definition back", async () => {
      const t = await boot();
      await created(t);
      const definitionBefore = definitionText();
      const filesBefore = sqlFiles();

      await stopSave(
        t,
        [text("heading"), text("alpha")],
        point =>
          point.startsWith(`file:${HISTORY_DIR()}`) && point.endsWith(".sql")
      );
      expect(sqlFiles().length).toBeGreaterThan(filesBefore.length);

      const settled = await settle(t);

      expect(settled.map(s => s.outcome)).toEqual(["none"]);
      expect(sqlFiles()).toEqual(filesBefore);
      expect(definitionText()).toBe(definitionBefore);
      expect(await recordRow(t)).toBeUndefined();
      expect(await liveColumns(t, TABLE)).not.toContain("alpha");
      expect(await registryFieldNames(t)).not.toContain("alpha");
    }, 300_000);

    /** A translated Single holding a translated `heading`. */
    async function createdTranslated(): Promise<void> {
      await dispatchSingles(
        "createSingle",
        {},
        {
          slug: SLUG,
          label: SLUG,
          localized: true,
          fields: [text("heading", { localized: true })],
        }
      );
    }
    const translatedAdd = [
      text("heading", { localized: true }),
      text("alpha", { localized: true }),
    ];

    // A translated field added changes no main column: the save's first file records the settings
    // alone, its header naming the entity only on its settings line. Stopped as that file is put in
    // place, before the record names it, the file cannot be told as the save's: settled without it,
    // the save would be taken as undone and the file left to run. The record stays. (The definition
    // is written after the files, so at this stop it is still as it was.)
    it("keeps a record where a file written as the save stopped cannot be told as its own", async () => {
      const t = await boot();
      await createdTranslated();
      const filesBefore = sqlFiles();
      await stopSave(
        t,
        translatedAdd,
        point =>
          point.startsWith(`file:${HISTORY_DIR()}`) && point.endsWith(".sql"),
        true
      );
      const written = sqlFiles().filter(f => !filesBefore.includes(f));
      expect(written.length).toBeGreaterThan(0);

      const settled = await settle(t);

      expect(settled.map(s => s.outcome)).toEqual(["left"]);
      expect(await recordRow(t), "the record stays").toBeDefined();
      expect(sqlFiles(), "the save's files stay").toEqual(
        [...filesBefore, ...written].sort()
      );
    }, 300_000);

    // A translated table stands where a snapshot says only with its translations table. Here the
    // save stopped before its first file ran, its main table as it started, but the translations
    // table has a column since that no snapshot records: the tables stand at neither end, so
    // nothing is undone and the record stays.
    it("keeps a record whose translations table stands at neither end, though its main table is as it started", async () => {
      const t = await boot();
      await createdTranslated();
      const filesBefore = sqlFiles();
      await stopSave(
        t,
        translatedAdd,
        point => point.startsWith("unit:"),
        true
      );
      const written = sqlFiles().filter(f => !filesBefore.includes(f));
      expect(written.length).toBeGreaterThan(0);
      const quote = (name: string) =>
        dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
      await t.adapter.executeQuery(
        `ALTER TABLE ${quote(`${TABLE}_locales`)} ADD COLUMN ${quote("by_hand")} ${dialect === "mysql" ? "VARCHAR(10)" : "TEXT"}`
      );

      const settled = await settle(t);

      expect(settled.map(s => s.outcome)).toEqual(["left"]);
      expect(await recordRow(t), "the record stays").toBeDefined();
      expect(sqlFiles(), "the save's files stay").toEqual(
        [...filesBefore, ...written].sort()
      );
    }, 300_000);

    // A development start whose settle leaves a record runs no pending migration: the save's file
    // nothing could tell as its own would otherwise run, changing what the record describes.
    it("runs no pending migration at a start whose settle leaves a record", async () => {
      const t = await boot();
      await createdTranslated();
      const filesBefore = sqlFiles();
      await stopSave(
        t,
        translatedAdd,
        point =>
          point.startsWith(`file:${HISTORY_DIR()}`) && point.endsWith(".sql"),
        true
      );
      const written = sqlFiles().filter(f => !filesBefore.includes(f));
      expect(written.length).toBeGreaterThan(0);
      // The start takes the schema lock, which the stopped save, still in this process, holds; and
      // its migrate step reads the folder the saves write to.
      lockPassesThrough.on = true;
      bootFolder.dir = HISTORY_DIR();
      migrateStep.watch = true;

      await runBootTimeApplyIfDev({ caller: "settle test" });

      expect(migrateStep.runs, "the start's migrate step ran").toBe(0);
      expect(
        migrateStep.registrations,
        "the start registered entities from the snapshots"
      ).toBe(0);
      expect(reloads.count, "the start's code-first reload ran").toBe(0);
      expect(await recordRow(t), "the record stays").toBeDefined();
      const repo = new SchemaEventsRepository(
        t.adapter.getDrizzle(),
        t.adapter.dialect
      );
      for (const file of written) {
        expect(await repo.isFileApplied(file), file).toBe(false);
      }
    }, 300_000);

    // Translation turned off leaves the table untranslated: it stands at that target only with
    // its translations table gone. Here the save's files are out of the ledger, as a push leaves
    // them, and the translations table is there again: the tables stand at neither end.
    it("keeps a record whose translations table stands after translation was turned off", async () => {
      const t = await boot();
      await createdTranslated();
      const filesBefore = sqlFiles();
      const realDelete = MetaService.prototype.delete;
      vi.spyOn(MetaService.prototype, "delete").mockImplementation(
        async function (this: MetaService, key: string) {
          if (key === RECORD_KEY) await stopHere("clear");
          return realDelete.call(this, key);
        }
      );
      await stopSave(t, [text("heading")], point => point === "clear", false);
      vi.mocked(MetaService.prototype.delete).mockRestore();
      const written = sqlFiles().filter(f => !filesBefore.includes(f));
      expect(written.length).toBeGreaterThan(0);
      const quote = (name: string) =>
        dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
      await t.adapter.executeQuery(
        `DELETE FROM ${quote("nextly_schema_events")} WHERE ${quote("event_type")} = 'file_apply' AND ${quote("filename")} IN (${written.map(f => `'${f}'`).join(", ")})`
      );
      expect(await liveColumns(t, TABLE)).toContain("heading");
      await t.adapter.executeQuery(
        `CREATE TABLE ${quote(`${TABLE}_locales`)} (${quote("id")} VARCHAR(36))`
      );

      const settled = await settle(t);

      expect(settled.map(s => s.outcome)).toEqual(["left"]);
      expect(await recordRow(t), "the record stays").toBeDefined();
    }, 300_000);

    // A record from before it said whether the save applied its own files may be one made
    // outside development, whose files a deploy's `nextly migrate` applies: nothing of it is
    // withdrawn, and the record stays.
    it("keeps the files of an older save whose record does not say whether it applied them", async () => {
      const t = await boot();
      await created(t);
      const filesBefore = sqlFiles();
      await stopSave(
        t,
        [text("heading"), text("alpha")],
        point =>
          point.startsWith(`file:${HISTORY_DIR()}`) && point.endsWith(".sql")
      );
      const written = sqlFiles().filter(f => !filesBefore.includes(f));
      expect(written.length).toBeGreaterThan(0);
      const { applies: _said, ...older } = (await recordRow(t)) as {
        applies?: boolean;
      } & Record<string, unknown>;
      await new MetaService(t.adapter, consoleLogger).set(RECORD_KEY, older);

      const settled = await settle(t);

      expect(settled.map(s => s.outcome)).toEqual(["left"]);
      expect(await recordRow(t), "the record stays").toBeDefined();
      expect(sqlFiles(), "the save's files stay").toEqual(
        [...filesBefore, ...written].sort()
      );
    }, 300_000);

    it("leaves a definition edited after the stop as it is, and names it", async () => {
      const t = await boot();
      await created(t);
      await stopSave(
        t,
        [text("heading"), text("alpha")],
        point =>
          point.startsWith(`file:${HISTORY_DIR()}`) && point.endsWith(".sql")
      );
      const edited = `${definitionText() ?? ""}\n`;
      writeFileSync(join(basePath, DEFINITION), edited);

      const settled = await settle(t);

      expect(settled.map(s => s.outcome)).toEqual(["none"]);
      expect(definitionText()).toBe(edited);
      expect(settled[0]?.notes.join(" ")).toContain("left as it is");
    }, 300_000);

    it("settles a save stopped after everything applied as all of it: registry up, record gone", async () => {
      const t = await boot();
      await created(t);
      const filesBefore = sqlFiles();
      // Stopped as the scope that made the record clears it: everything else is done.
      const realDelete = MetaService.prototype.delete;
      vi.spyOn(MetaService.prototype, "delete").mockImplementation(
        async function (this: MetaService, key: string) {
          if (key === RECORD_KEY) await stopHere("clear");
          return realDelete.call(this, key);
        }
      );
      await stopSave(
        t,
        [text("heading"), text("alpha")],
        point => point === "clear"
      );
      vi.mocked(MetaService.prototype.delete).mockRestore();
      expect(await recordRow(t), "the record before the settle").toBeDefined();
      const written = sqlFiles().filter(f => !filesBefore.includes(f));
      const repo = new SchemaEventsRepository(
        t.adapter.getDrizzle(),
        t.adapter.dialect
      );
      const versionBefore = await versionOf(t);

      const settled = await settle(t);

      expect(settled.map(s => s.outcome)).toEqual(["all"]);
      expect(await recordRow(t)).toBeUndefined();
      // The row was the saved shape already: written again, the version would move for nothing.
      expect(await versionOf(t)).toBe(versionBefore);
      expect(await liveColumns(t, TABLE)).toContain("alpha");
      expect(await registryFieldNames(t)).toContain("alpha");
      for (const file of written) {
        expect(await repo.isFileApplied(file), file).toBe(true);
      }
    }, 300_000);

    // A save that applied whole, stopped before its record cleared, where later migrations have
    // applied since (another host's save, say): the settle clears the record and leaves the
    // registry row as those later ones left it.
    // A record from before the saved definition was kept says nothing of the entity's shape: a
    // save of it that applied whole keeps its registry row and its record, rather than reading the
    // missing definition as a delete and removing the row.
    // A save that applied whole with no registry row to bring up (a create stopped before its row
    // was written): the settle does not make a row, so it keeps the record rather than leaving a
    // table no registry row names.
    it("keeps the record of a save that applied whole with no registry row to bring up", async () => {
      const t = await boot();
      await created(t);
      const realDelete = MetaService.prototype.delete;
      vi.spyOn(MetaService.prototype, "delete").mockImplementation(
        async function (this: MetaService, key: string) {
          if (key === RECORD_KEY) await stopHere("clear");
          return realDelete.call(this, key);
        }
      );
      await stopSave(
        t,
        [text("heading"), text("alpha")],
        point => point === "clear"
      );
      vi.mocked(MetaService.prototype.delete).mockRestore();
      // The row as a create stopped before writing it leaves it: not there.
      await t.adapter.delete("dynamic_singles", {
        and: [{ column: "slug", op: "=", value: SLUG }],
      });

      const settled = await settle(t);

      expect(settled.map(s => s.outcome)).toEqual(["all"]);
      expect(await recordRow(t), "the record stays").toBeDefined();
    }, 300_000);

    it("keeps the registry row and the record of an older save without its saved definition", async () => {
      const t = await boot();
      await created(t);
      const realDelete = MetaService.prototype.delete;
      vi.spyOn(MetaService.prototype, "delete").mockImplementation(
        async function (this: MetaService, key: string) {
          if (key === RECORD_KEY) await stopHere("clear");
          return realDelete.call(this, key);
        }
      );
      await stopSave(
        t,
        [text("heading"), text("alpha")],
        point => point === "clear"
      );
      vi.mocked(MetaService.prototype.delete).mockRestore();
      // The record as one written before the saved definition was kept.
      const { definitionAfter: _kept, ...older } = (await recordRow(t)) as {
        definitionAfter?: string;
      } & Record<string, unknown>;
      await new MetaService(t.adapter, consoleLogger).set(RECORD_KEY, older);

      const settled = await settle(t);

      expect(settled.map(s => s.outcome)).toEqual(["all"]);
      expect(await recordRow(t), "the record stays").toBeDefined();
      expect(await registryFieldNames(t), "the registry row stays").toEqual([
        "heading",
        "alpha",
      ]);
    }, 300_000);

    it("clears a save that later migrations moved past without writing its registry row again", async () => {
      const t = await boot();
      await created(t);
      const realDelete = MetaService.prototype.delete;
      vi.spyOn(MetaService.prototype, "delete").mockImplementation(
        async function (this: MetaService, key: string) {
          if (key === RECORD_KEY) await stopHere("clear");
          return realDelete.call(this, key);
        }
      );
      await stopSave(
        t,
        [text("heading"), text("alpha")],
        point => point === "clear"
      );
      vi.mocked(MetaService.prototype.delete).mockRestore();
      // A later migration, applied, and the registry row as it left it.
      const repo = new SchemaEventsRepository(
        t.adapter.getDrizzle(),
        t.adapter.dialect
      );
      await recordAlreadyApplied(
        { filename: "29991231_000000_000_later.sql" },
        repo
      );
      await writeAppliedFieldsRow(t.adapter, {
        table: "dynamic_singles",
        slug: SLUG,
        fields: [text("heading"), text("beta")] as never,
        localized: false,
        schemaVersion: (await versionOf(t)) + 1,
      });

      const settled = await settle(t);

      expect(settled.map(s => s.outcome)).toEqual(["all"]);
      expect(await recordRow(t)).toBeUndefined();
      expect(await registryFieldNames(t)).toEqual(["heading", "beta"]);
    }, 300_000);

    // A later migration of another entity says nothing of this one's registry row: the settle
    // brings it up all the same.
    it("brings the registry row up over a later migration of another entity", async () => {
      const t = await boot();
      await created(t);
      const realDelete = MetaService.prototype.delete;
      vi.spyOn(MetaService.prototype, "delete").mockImplementation(
        async function (this: MetaService, key: string) {
          if (key === RECORD_KEY) await stopHere("clear");
          return realDelete.call(this, key);
        }
      );
      await stopSave(
        t,
        [text("heading"), text("alpha")],
        point => point === "clear"
      );
      vi.mocked(MetaService.prototype.delete).mockRestore();
      const repo = new SchemaEventsRepository(
        t.adapter.getDrizzle(),
        t.adapter.dialect
      );
      const other = "29991231_000000_000_other_posts_update.sql";
      writeFileSync(
        join(HISTORY_DIR(), other),
        [
          "-- Migration: other_posts_update",
          "-- Collections: other_posts",
          "-- Entity scope: touched",
          "",
          "-- UP",
          'ALTER TABLE "dc_other_posts" ADD COLUMN "x" TEXT;',
          "",
          "-- DOWN",
          "SELECT 1;",
          "",
        ].join("\n")
      );
      await recordAlreadyApplied({ filename: other }, repo);
      // The row as it stood before the save's own write.
      await writeAppliedFieldsRow(t.adapter, {
        table: "dynamic_singles",
        slug: SLUG,
        fields: [text("heading")] as never,
        localized: false,
        schemaVersion: (await versionOf(t)) + 1,
      });

      const settled = await settle(t);

      expect(settled.map(s => s.outcome)).toEqual(["all"]);
      expect(await recordRow(t)).toBeUndefined();
      expect(await registryFieldNames(t)).toEqual(["heading", "alpha"]);
    }, 300_000);

    // A later migration that only mentions the slug in data (a plugin's row, say) writes no
    // registry row of this entity: the settle brings the row up all the same.
    it("brings the registry row up over a later migration that mentions the slug only in data", async () => {
      const t = await boot();
      await created(t);
      const realDelete = MetaService.prototype.delete;
      vi.spyOn(MetaService.prototype, "delete").mockImplementation(
        async function (this: MetaService, key: string) {
          if (key === RECORD_KEY) await stopHere("clear");
          return realDelete.call(this, key);
        }
      );
      await stopSave(
        t,
        [text("heading"), text("alpha")],
        point => point === "clear"
      );
      vi.mocked(MetaService.prototype.delete).mockRestore();
      const repo = new SchemaEventsRepository(
        t.adapter.getDrizzle(),
        t.adapter.dialect
      );
      const later = "29991231_000000_000_plugin_data.sql";
      writeFileSync(
        join(HISTORY_DIR(), later),
        [
          "-- Migration: plugin_data",
          "",
          "-- UP",
          `INSERT INTO "plugin_redirects" ("from_slug", "to_slug") VALUES ('${SLUG}', 'elsewhere');`,
          "",
          "-- DOWN",
          "SELECT 1;",
          "",
        ].join("\n")
      );
      await recordAlreadyApplied({ filename: later }, repo);
      // The row as it stood before the save's own write.
      await writeAppliedFieldsRow(t.adapter, {
        table: "dynamic_singles",
        slug: SLUG,
        fields: [text("heading")] as never,
        localized: false,
        schemaVersion: (await versionOf(t)) + 1,
      });

      const settled = await settle(t);

      expect(settled.map(s => s.outcome)).toEqual(["all"]);
      expect(await recordRow(t)).toBeUndefined();
      expect(await registryFieldNames(t)).toEqual(["heading", "alpha"]);
    }, 300_000);

    // A left record whose table stands at neither end (here, a column added by hand after the
    // stop) stays "left": nothing proves the change landed, so nothing is recorded applied. A save
    // of the entity is refused, unless it is the same save again, which is how that save is
    // finished: the gate lets it on to the save's own checks.
    it("keeps a record whose table stands at neither end, refusing another save but not the same one", async () => {
      const t = await boot();
      await created(t);
      const asked = [text("heading"), text("alpha")];
      await stopSave(
        t,
        asked,
        point =>
          point.startsWith(`file:${HISTORY_DIR()}`) && point.endsWith(".sql")
      );
      await t.adapter.executeQuery(
        `ALTER TABLE ${dialect === "mysql" ? `\`${TABLE}\`` : `"${TABLE}"`} ADD COLUMN ${dialect === "mysql" ? "`by_hand`" : '"by_hand"'} ${dialect === "mysql" ? "VARCHAR(10)" : "TEXT"}`
      );
      const repo = new SchemaEventsRepository(
        t.adapter.getDrizzle(),
        t.adapter.dialect
      );

      const settled = await settle(t);

      expect(settled.map(s => s.outcome)).toEqual(["left"]);
      expect(await recordRow(t), "the record stays").toBeDefined();
      for (const file of sqlFiles()) {
        if (file.includes(SLUG)) {
          // Only the create's file is recorded; the left save's are not.
          const applied = await repo.isFileApplied(file);
          if (!file.includes("_create")) expect(applied, file).toBe(false);
        }
      }
      // The gate a save meets as it records its start, asked directly: the stopped save still
      // holds this process's exclusion, which a save through the dispatcher would meet first.
      const left = (await recordRow(t)) as { definitionAfter?: string };
      expect(
        left.definitionAfter,
        "the record keeps what the save writes"
      ).toEqual(expect.any(String));
      const gate = (definitionAfter: string) =>
        withSaveRecords(() =>
          recordSaveStarted({
            adapter: t.adapter,
            projectRoot: basePath,
            kind: "single",
            slug: SLUG,
            definitionFile: join(basePath, DEFINITION),
            definitionBefore: definitionText() ?? undefined,
            definitionAfter,
            database: undefined,
            notify: () => undefined,
          })
        ).then(
          () => "started",
          (error: unknown) =>
            NextlyError.is(error) ? error.publicMessage : String(error)
        );
      expect(await gate(`${left.definitionAfter}\n`)).toContain(
        "could not be settled"
      );
      expect(await gate(left.definitionAfter ?? "")).toBe("started");
      expect(await recordRow(t), "the record still stays").toEqual(left);
    }, 300_000);

    // A Single's save of a field leaving translation as Required writes the setting as a step of
    // its own, after the rest: the record its first step made is the save's, so the second goes
    // on under it (no refusal), and the record says what that step writes, so a stop inside it
    // settles against the step's definition and finds its files.
    // A later step that joined the record and was killed before it wrote any file: the record
    // describes that step's definition, but only the earlier step's files landed. The settle keeps
    // the record and leaves the registry row as the earlier step wrote it, rather than writing the
    // later step's settings over DDL that never ran.
    it("keeps the record of a save killed after a later step joined it, before that step's file", async () => {
      const t = await boot();
      await dispatchSingles(
        "createSingle",
        {},
        {
          slug: SLUG,
          label: SLUG,
          localized: true,
          fields: [text("heading", { localized: true })],
        }
      );
      const compareAndSet = MetaService.prototype.compareAndSet;
      vi.spyOn(MetaService.prototype, "compareAndSet").mockImplementation(
        async function (
          this: MetaService,
          ...args: Parameters<MetaService["compareAndSet"]>
        ) {
          const done = await compareAndSet.apply(this, args);
          const next = args[2] as { stepFrom?: number };
          if (args[0] === RECORD_KEY && next.stepFrom !== undefined) {
            await stopHere("joined");
          }
          return done;
        }
      );
      const reached = new Promise<void>(resolve => {
        kill.reached = resolve;
      });
      kill.at = point => point === "joined";
      // The schema route, which writes a field leaving translation as Required in two steps.
      stopped = dispatchSingles(
        "updateSingleSchema",
        { slug: SLUG },
        { fields: [text("heading", { localized: false, required: true })] }
      ).catch((error: unknown) => error);
      const outcome = await Promise.race([
        reached.then(() => "reached"),
        stopped.then(answer => `the save ended first: ${String(answer)}`),
      ]);
      expect(outcome, "the save never reached its second step").toBe("reached");
      vi.mocked(MetaService.prototype.compareAndSet).mockRestore();

      const settled = await settle(t);

      expect(settled.map(s => s.outcome)).toEqual(["left"]);
      expect(await recordRow(t), "the record stays").toBeDefined();
      const [row] = await t.adapter.select<{ fields: unknown }>(
        "dynamic_singles",
        { where: { and: [{ column: "slug", op: "=", value: SLUG }] } }
      );
      const fields = (
        typeof row?.fields === "string" ? JSON.parse(row.fields) : row?.fields
      ) as { name: string; required?: boolean }[];
      expect(
        fields.find(field => field.name === "heading")?.required,
        "the registry row, as the earlier step wrote it"
      ).not.toBe(true);
    }, 300_000);

    it("brings the record to a later step of the same save, rather than refusing it", async () => {
      const t = await boot();
      await dispatchSingles(
        "createSingle",
        {},
        {
          slug: SLUG,
          label: SLUG,
          localized: true,
          fields: [text("heading", { localized: true })],
        }
      );
      const folder = join(basePath, ".nextly", "save-in-progress");
      const seen: { definitionAfter?: string; files?: string[] }[] = [];
      // Never a kill point: at each migration file put in place, the record as its marker holds it.
      kill.at = point => {
        if (
          point.startsWith(`file:${HISTORY_DIR()}`) &&
          point.endsWith(".sql")
        ) {
          for (const name of existsSync(folder) ? readdirSync(folder) : []) {
            if (name.endsWith(".json")) {
              seen.push(
                JSON.parse(readFileSync(join(folder, name), "utf-8")) as {
                  definitionAfter?: string;
                  files?: string[];
                }
              );
            }
          }
        }
        return false;
      };

      // The schema route, which writes a field leaving translation as Required in two steps.
      const answer = await dispatchSingles(
        "updateSingleSchema",
        { slug: SLUG },
        { fields: [text("heading", { localized: false, required: true })] }
      ).catch((error: unknown) => error);

      expect(NextlyError.is(answer) ? answer.publicMessage : undefined).toBe(
        undefined
      );
      const steps = [...new Set(seen.map(r => r.definitionAfter))];
      expect(
        steps.length,
        `a record seen at each step's files: ${JSON.stringify({ seen: seen.length, files: sqlFiles(), answer: answer instanceof Response ? await answer.clone().text() : String(answer) })}`
      ).toBe(2);
      // The second step's record holds the definition the save ends with, and the first step's
      // files with its own.
      expect(steps.at(-1)).toBe(definitionText());
      const last = seen.at(-1);
      const first = seen.filter(r => r.definitionAfter === steps[0]).at(-1);
      expect(last?.files ?? []).toEqual(
        expect.arrayContaining(first?.files ?? [])
      );
      expect(await recordRow(t), "the save's end clears it").toBeUndefined();
    }, 300_000);

    // A record from before the save's own definition text was kept, whose definition has changed
    // since: whether the save made that change cannot be told, so the record stays, and a save of
    // the entity is refused rather than written past it.
    it("keeps an older record whose definition cannot be told apart, and refuses a save of its entity", async () => {
      const t = await boot();
      await created(t);
      await new MetaService(t.adapter, consoleLogger).set(RECORD_KEY, {
        id: "an-older-record",
        kind: "single",
        slug: SLUG,
        startedAt: new Date().toISOString(),
        host: hostname(),
        database: "unknown",
        definitionFile: DEFINITION.replace(/^\.\//, ""),
        definitionBefore: "the definition before a save of an older build",
      });

      const settled = await settle(t);

      expect(settled.map(s => s.outcome)).toEqual(["left"]);
      expect(await recordRow(t), "the record stays").toBeDefined();
      const answer = await save(t, [text("heading"), text("beta")]).catch(
        (error: unknown) => error
      );
      const message = NextlyError.is(answer)
        ? answer.publicMessage
        : answer instanceof Response
          ? await answer.text()
          : String(answer);
      expect(message).toContain("could not be settled");
      expect(await liveColumns(t, TABLE)).not.toContain("beta");
    }, 300_000);

    // A file another writer added for the entity after the stop (pulled in, say), named outside the
    // moment the save's files are named for: never taken for the save's, so never removed.
    it("leaves a later file of another writer that names the entity", async () => {
      const t = await boot();
      await created(t);
      await stopSave(
        t,
        [text("heading"), text("alpha")],
        point =>
          point.startsWith(`file:${HISTORY_DIR()}`) && point.endsWith(".sql")
      );
      const other = "29991231_000000_000_other.sql";
      writeFileSync(
        join(HISTORY_DIR(), other),
        `-- Migration: other\n-- Singles: ${SLUG}\n\n-- UP\nSELECT 1;\n\n-- DOWN\nSELECT 1;\n`
      );

      const settled = await settle(t);

      expect(settled.map(s => s.outcome)).toEqual(["none"]);
      expect(sqlFiles()).toContain(other);
    }, 300_000);

    // A row that cannot be read still stands for its entity's save: that entity's marker stays.
    // A migration written since from one of the save's files (migrate:create chains from the
    // newest snapshot it finds) leaves out what that file does: the settle does not remove the
    // file under it, and the record stays.
    it("keeps a record whose files a later migration was written from", async () => {
      const t = await boot();
      await created(t);
      const filesBefore = sqlFiles();
      await stopSave(t, [text("heading"), text("alpha")], point =>
        point.startsWith("unit:")
      );
      const written = sqlFiles().filter(f => !filesBefore.includes(f));
      expect(written.length).toBeGreaterThan(0);
      const parent = written.at(-1)!.replace(/\.sql$/, "");
      // The later migration, its snapshot copied from the create's and naming the save's last
      // file as the one it was written from.
      const later = "29991231_000000_000_later_change";
      const meta = join(HISTORY_DIR(), "meta");
      const created_ = readdirSync(meta).find(n =>
        n.endsWith("_create.snapshot.json")
      )!;
      const snapshot = JSON.parse(
        readFileSync(join(meta, created_), "utf-8")
      ) as Record<string, unknown>;
      writeFileSync(
        join(meta, `${later}.snapshot.json`),
        JSON.stringify({ ...snapshot, parent, migration: later }, null, 2)
      );
      writeFileSync(
        join(HISTORY_DIR(), `${later}.sql`),
        "-- Migration: later_change\n\n-- UP\nSELECT 1;\n\n-- DOWN\nSELECT 1;\n"
      );

      const settled = await settle(t);

      expect(settled.map(s => s.outcome)).toEqual(["left"]);
      expect(await recordRow(t), "the record stays").toBeDefined();
      for (const file of written) {
        expect(sqlFiles(), "the save's files stay").toContain(file);
      }
    }, 300_000);

    // A later migration of another entity whose table only begins with this one's name
    // (`single_settle_hero_archive` beside `single_settle_hero`) is not this entity's: the settle
    // brings the registry row up all the same.
    it("brings the registry row up over a later migration of an entity whose table only begins with this one's", async () => {
      const t = await boot();
      await created(t);
      const realDelete = MetaService.prototype.delete;
      vi.spyOn(MetaService.prototype, "delete").mockImplementation(
        async function (this: MetaService, key: string) {
          if (key === RECORD_KEY) await stopHere("clear");
          return realDelete.call(this, key);
        }
      );
      await stopSave(
        t,
        [text("heading"), text("alpha")],
        point => point === "clear"
      );
      vi.mocked(MetaService.prototype.delete).mockRestore();
      const repo = new SchemaEventsRepository(
        t.adapter.getDrizzle(),
        t.adapter.dialect
      );
      const later = "29991231_000000_000_settle_hero_archive_update.sql";
      writeFileSync(
        join(HISTORY_DIR(), later),
        [
          "-- Migration: settle_hero_archive_update",
          `-- Singles: ${SLUG}_archive`,
          "-- Entity scope: touched",
          "",
          "-- UP",
          `ALTER TABLE "${TABLE}_archive" ADD COLUMN "x" TEXT;`,
          "",
          "-- DOWN",
          "SELECT 1;",
          "",
        ].join("\n")
      );
      await recordAlreadyApplied({ filename: later }, repo);
      // The row as it stood before the save's own write.
      await writeAppliedFieldsRow(t.adapter, {
        table: "dynamic_singles",
        slug: SLUG,
        fields: [text("heading")] as never,
        localized: false,
        schemaVersion: (await versionOf(t)) + 1,
      });

      const settled = await settle(t);

      expect(settled.map(s => s.outcome)).toEqual(["all"]);
      expect(await registryFieldNames(t)).toEqual(["heading", "alpha"]);
    }, 300_000);

    // A record the settle does not judge, one that cannot be read or another host's, is answered
    // as left all the same, so the development start holds back as for one it judged left.
    it("answers a record it cannot read, and another host's, as left", async () => {
      const t = await boot();
      await created(t);
      const meta = new MetaService(t.adapter, consoleLogger);
      await meta.set(
        "builder-save-in-progress:single:unreadable_one",
        "not a save's record"
      );
      await meta.set(RECORD_KEY, {
        id: "another-hosts-save",
        kind: "single",
        slug: SLUG,
        startedAt: new Date().toISOString(),
        host: "another-host",
        database: "unknown",
        definitionFile: "schema/builder.json",
        definitionBefore: null,
      });

      const settled = await settle(t);

      expect(settled.map(s => [s.slug, s.outcome]).sort()).toEqual([
        [SLUG, "left"],
        ["unreadable_one", "left"],
      ]);
    }, 300_000);

    it("holds back a start while another host's record stands", async () => {
      const t = await boot();
      await created(t);
      await new MetaService(t.adapter, consoleLogger).set(RECORD_KEY, {
        id: "another-hosts-save",
        kind: "single",
        slug: SLUG,
        startedAt: new Date().toISOString(),
        host: "another-host",
        database: "unknown",
        definitionFile: "schema/builder.json",
        definitionBefore: null,
      });
      lockPassesThrough.on = true;
      bootFolder.dir = HISTORY_DIR();
      migrateStep.watch = true;

      await runBootTimeApplyIfDev({ caller: "settle test" });

      expect(migrateStep.runs, "the start's migrate step ran").toBe(0);
      expect(reloads.count, "the start's code-first reload ran").toBe(0);
    }, 300_000);

    // A blank migration written since (`migrate:create --blank`: a file with no snapshot, its SQL
    // by hand) states the save's file as its parent in its header: its statements take that file's
    // schema as given, so the settle does not remove the file under it, and the record stays.
    it("keeps a record whose files a later blank migration was written from", async () => {
      const t = await boot();
      await created(t);
      const filesBefore = sqlFiles();
      await stopSave(t, [text("heading"), text("alpha")], point =>
        point.startsWith("unit:")
      );
      const written = sqlFiles().filter(f => !filesBefore.includes(f));
      expect(written.length).toBeGreaterThan(0);
      const parent = written.at(-1)!.replace(/\.sql$/, "");
      writeFileSync(
        join(HISTORY_DIR(), "29991231_000000_000_by_hand.sql"),
        [
          "-- Migration: by_hand",
          `-- Parent: ${parent}`,
          "",
          "-- UP",
          `UPDATE "${TABLE}" SET "alpha" = 'x';`,
          "",
          "-- DOWN",
          "SELECT 1;",
          "",
        ].join("\n")
      );

      const settled = await settle(t);

      expect(settled.map(s => s.outcome)).toEqual(["left"]);
      expect(await recordRow(t), "the record stays").toBeDefined();
      for (const file of written) {
        expect(sqlFiles(), "the save's files stay").toContain(file);
      }
    }, 300_000);

    /** A save stopped before its first file ran: its files, and the last as a migration name. */
    async function stoppedBeforeItsFiles(
      t: TestNextly
    ): Promise<{ written: string[]; last: string }> {
      await created(t);
      const filesBefore = sqlFiles();
      await stopSave(t, [text("heading"), text("alpha")], point =>
        point.startsWith("unit:")
      );
      const written = sqlFiles().filter(f => !filesBefore.includes(f));
      expect(written.length).toBeGreaterThan(0);
      return { written, last: written.at(-1)!.replace(/\.sql$/, "") };
    }

    /** The entity's create migration, by name: written before the save, from no save of it. */
    const createMigration = () =>
      readdirSync(join(HISTORY_DIR(), "meta"))
        .find(n => n.endsWith("_create.snapshot.json"))!
        .replace(/\.snapshot\.json$/, "");

    const BY_HAND = "29991231_000000_000_by_hand";

    // A dialect's variant (`<base>.mysql.sql`) is a file of its migration, read with it as the
    // history reads the folder: a Parent line only the variant states holds the save, and the
    // migration is named once, by its own name.
    it("keeps a record whose files a later blank migration's variant was written from, naming the migration once", async () => {
      const t = await boot();
      const { written, last } = await stoppedBeforeItsFiles(t);
      writeFileSync(
        join(HISTORY_DIR(), `${BY_HAND}.sql`),
        byHand([BLANK_FILE_LINE])
      );
      writeFileSync(
        join(HISTORY_DIR(), `${BY_HAND}.mysql.sql`),
        byHand([`-- Parent: ${last}`])
      );

      const settled = await settle(t);

      expect(settled.map(s => s.outcome)).toEqual(["left"]);
      const notes = settled[0]?.notes.join(" ");
      expect(notes).toContain(`${BY_HAND} was written from`);
      expect(notes).not.toContain(".mysql");
      for (const file of written) {
        expect(sqlFiles(), "the save's files stay").toContain(file);
      }
    }, 300_000);

    // Where a migration's files state different places, the settle refuses nothing: it keeps the
    // save's files where any of them names one, so nothing is removed under it.
    it("keeps a record whose files one of a later migration's disagreeing files was written from", async () => {
      const t = await boot();
      const { written, last } = await stoppedBeforeItsFiles(t);
      writeFileSync(
        join(HISTORY_DIR(), `${BY_HAND}.sql`),
        byHand([`-- Parent: ${createMigration()}`])
      );
      writeFileSync(
        join(HISTORY_DIR(), `${BY_HAND}.mysql.sql`),
        byHand([`-- Parent: ${last}`])
      );

      const settled = await settle(t);

      expect(settled.map(s => s.outcome)).toEqual(["left"]);
      const notes = settled[0]?.notes.join(" ");
      expect(notes).toContain(`${BY_HAND} was written from`);
      expect(notes).not.toContain(".mysql");
      for (const file of written) {
        expect(sqlFiles(), "the save's files stay").toContain(file);
      }
    }, 300_000);

    // A migration with a snapshot is placed by that snapshot, as the history places it: a
    // hand-written variant's header naming the save's file does not hold the save.
    it("settles a save a generated migration's variant names, by that migration's snapshot", async () => {
      const t = await boot();
      const { written, last } = await stoppedBeforeItsFiles(t);
      const meta = join(HISTORY_DIR(), "meta");
      const create = createMigration();
      const snapshot = JSON.parse(
        readFileSync(join(meta, `${create}.snapshot.json`), "utf-8")
      ) as Record<string, unknown>;
      const later = "29991231_000000_000_later_change";
      writeFileSync(
        join(meta, `${later}.snapshot.json`),
        JSON.stringify(
          { ...snapshot, parent: create, migration: later },
          null,
          2
        )
      );
      writeFileSync(join(HISTORY_DIR(), `${later}.sql`), byHand([]));
      writeFileSync(
        join(HISTORY_DIR(), `${later}.mysql.sql`),
        byHand([`-- Parent: ${last}`])
      );

      const settled = await settle(t);

      expect(settled.map(s => s.outcome)).toEqual(["none"]);
      for (const file of written) {
        expect(sqlFiles(), "the save's files are removed").not.toContain(file);
      }
    }, 300_000);

    // A legacy file's header lists the whole configuration, not what it changes: a later one that
    // names the entity that way, and changes another table, has not moved past the save.
    it("brings the registry row up over a later legacy migration whose header lists every entity", async () => {
      const t = await boot();
      await created(t);
      const realDelete = MetaService.prototype.delete;
      vi.spyOn(MetaService.prototype, "delete").mockImplementation(
        async function (this: MetaService, key: string) {
          if (key === RECORD_KEY) await stopHere("clear");
          return realDelete.call(this, key);
        }
      );
      await stopSave(
        t,
        [text("heading"), text("alpha")],
        point => point === "clear"
      );
      vi.mocked(MetaService.prototype.delete).mockRestore();
      const repo = new SchemaEventsRepository(
        t.adapter.getDrizzle(),
        t.adapter.dialect
      );
      const later = "29991231_000000_000_legacy.sql";
      writeFileSync(
        join(HISTORY_DIR(), later),
        [
          "-- Migration: legacy",
          `-- Singles: ${SLUG}, another_single`,
          "",
          "-- UP",
          'ALTER TABLE "dc_unrelated" ADD COLUMN "x" TEXT;',
          "",
          "-- DOWN",
          "SELECT 1;",
          "",
        ].join("\n")
      );
      await recordAlreadyApplied({ filename: later }, repo);
      // The row as it stood before the save's own write.
      await writeAppliedFieldsRow(t.adapter, {
        table: "dynamic_singles",
        slug: SLUG,
        fields: [text("heading")] as never,
        localized: false,
        schemaVersion: (await versionOf(t)) + 1,
      });

      const settled = await settle(t);

      expect(settled.map(s => s.outcome)).toEqual(["all"]);
      expect(await registryFieldNames(t)).toEqual(["heading", "alpha"]);
    }, 300_000);

    it("keeps the marker of an entity whose row cannot be read", async () => {
      const t = await boot();
      await created(t);
      await new MetaService(t.adapter, consoleLogger).set(
        RECORD_KEY,
        "not a save's record"
      );
      const marker = {
        id: "a-marker",
        kind: "single",
        slug: SLUG,
        startedAt: new Date().toISOString(),
        host: hostname(),
        database: "unknown",
        definitionFile: "schema/builder.json",
        definitionBefore: null,
      };
      const folder = join(basePath, ".nextly", "save-in-progress");
      mkdirSync(folder, { recursive: true });
      const file = join(folder, `single-${SLUG}-a-marker.json`);
      writeFileSync(file, JSON.stringify(marker));

      await settle(t);

      expect(existsSync(file)).toBe(true);
    }, 300_000);

    // The development start's own entry: it settles under the project root the app's saves write
    // to, not the process's folder.
    it("settles at the development start under the project root the saves write to", async () => {
      const t = await boot();
      await created(t);
      const definitionBefore = definitionText();
      const filesBefore = sqlFiles();
      await stopSave(
        t,
        [text("heading"), text("alpha")],
        point =>
          point.startsWith(`file:${HISTORY_DIR()}`) && point.endsWith(".sql")
      );
      expect(process.cwd()).not.toBe(basePath);
      // The start takes the schema lock, which the stopped save, still in this process, holds.
      lockPassesThrough.on = true;

      await runBootTimeApplyIfDev({ caller: "settle test" });

      expect(await recordRow(t)).toBeUndefined();
      expect(sqlFiles()).toEqual(filesBefore);
      expect(definitionText()).toBe(definitionBefore);
    }, 300_000);

    // A delete whose transaction committed, stopped before its record cleared: the table and the
    // registry row are gone, which the settle takes as all of it, touching nothing more.
    it("settles a Single's delete stopped before its record cleared as all of it", async () => {
      const t = await boot();
      await created(t);
      const filesBefore = sqlFiles();
      const realDelete = MetaService.prototype.delete;
      vi.spyOn(MetaService.prototype, "delete").mockImplementation(
        async function (this: MetaService, key: string) {
          if (key === RECORD_KEY) await stopHere("clear");
          return realDelete.call(this, key);
        }
      );
      const reached = new Promise<void>(resolve => {
        kill.reached = resolve;
      });
      kill.at = point => point === "clear";
      stopped = dispatchSingles("deleteSingle", { slug: SLUG }, {}).catch(
        (error: unknown) => error
      );
      const outcome = await Promise.race([
        reached.then(() => "reached"),
        stopped.then(answer => `the delete ended first: ${String(answer)}`),
      ]);
      expect(outcome, "the delete never reached the kill point").toBe(
        "reached"
      );
      vi.mocked(MetaService.prototype.delete).mockRestore();
      expect(await recordRow(t), "the record before the settle").toBeDefined();
      expect(await liveColumns(t, TABLE), "the table").toEqual([]);
      const written = sqlFiles().filter(f => !filesBefore.includes(f));
      const filesAfterDelete = sqlFiles();

      const settled = await settle(t);

      expect(settled.map(s => s.outcome)).toEqual(["all"]);
      expect(await recordRow(t)).toBeUndefined();
      expect(sqlFiles()).toEqual(filesAfterDelete);
      const [row] = await t.adapter.select("dynamic_singles", {
        where: { and: [{ column: "slug", op: "=", value: SLUG }] },
      });
      expect(row, "the registry row").toBeUndefined();
      const repo = new SchemaEventsRepository(
        t.adapter.getDrizzle(),
        t.adapter.dialect
      );
      for (const file of written) {
        expect(await repo.isFileApplied(file), file).toBe(true);
      }
    }, 300_000);

    // The same delete with its registry row still there, as MySQL leaves it where the drop committed
    // and the row's removal did not: the settle removes the row as the migrations remove a dropped
    // entity's.
    it("removes a deleted Single's registry row its stopped delete left behind", async () => {
      const t = await boot();
      await created(t);
      const [kept] = await t.adapter.select<Record<string, unknown>>(
        "dynamic_singles",
        { where: { and: [{ column: "slug", op: "=", value: SLUG }] } }
      );
      const realDelete = MetaService.prototype.delete;
      vi.spyOn(MetaService.prototype, "delete").mockImplementation(
        async function (this: MetaService, key: string) {
          if (key === RECORD_KEY) await stopHere("clear");
          return realDelete.call(this, key);
        }
      );
      const reached = new Promise<void>(resolve => {
        kill.reached = resolve;
      });
      kill.at = point => point === "clear";
      stopped = dispatchSingles("deleteSingle", { slug: SLUG }, {}).catch(
        (error: unknown) => error
      );
      await reached;
      vi.mocked(MetaService.prototype.delete).mockRestore();
      await t.adapter.insert("dynamic_singles", kept as never);

      const settled = await settle(t);

      expect(settled.map(s => s.outcome)).toEqual(["all"]);
      const [row] = await t.adapter.select("dynamic_singles", {
        where: { and: [{ column: "slug", op: "=", value: SLUG }] },
      });
      expect(row, "the registry row").toBeUndefined();
      expect(await recordRow(t)).toBeUndefined();
    }, 300_000);

    /**
     * The state a save whose files do not run together leaves when stopped between them: its main
     * file applied and recorded, its translations file not started. On PostgreSQL and SQLite a
     * save's files run in one transaction, which the stop rolled back whole, so the main file is
     * run alone here through the normal runner, the translations file set aside meanwhile.
     */
    async function firstFileAlone(
      t: TestNextly,
      written: readonly string[]
    ): Promise<void> {
      const aside = mkdtempSync(join(tmpdir(), "nextly-settle-aside-"));
      const later = written.filter(f => f.includes("localization"));
      expect(later.length, "the translations file").toBeGreaterThan(0);
      for (const file of later) {
        renameSync(join(HISTORY_DIR(), file), join(aside, file));
      }
      try {
        await clearStoppedHolds(t);
        await runFileMigrations({
          adapter: t.adapter as never,
          db: t.adapter.getDrizzle(),
          dialect: t.adapter.dialect,
          migrationsDir: HISTORY_DIR(),
          logger: createLogger({ quiet: true }),
        });
      } finally {
        for (const file of later) {
          renameSync(join(aside, file), join(HISTORY_DIR(), file));
        }
        rmSync(aside, { recursive: true, force: true });
      }
    }

    // A file runs and is recorded in one transaction on PostgreSQL and SQLite, so a file with no
    // ledger row never ran. MySQL records a file's attempt before its statements, outside any
    // transaction: there a stop between two files leaves an attempt that cannot be told from one
    // stopped inside its statements, which the case below keeps for the stopped-save step.
    it.skipIf(dialect === "mysql")(
      "settles a translated Single stopped between its files as pending: the start's migration step finishes it",
      async () => {
        const t = await boot();
        await created(t);
        const filesBefore = sqlFiles();
        await stopSave(
          t,
          [text("heading", { localized: true })],
          point => point.startsWith("unit:") && point.includes("localization"),
          true
        );
        const written = sqlFiles().filter(f => !filesBefore.includes(f));
        expect(written.some(f => f.includes("localization"))).toBe(true);
        await firstFileAlone(t, written);

        const settled = await settle(t);

        expect(settled.map(s => s.outcome)).toEqual(["pending"]);
        expect(await recordRow(t)).toBeUndefined();
        expect(sqlFiles()).toEqual([...filesBefore, ...written].sort());
        // The start's next step: every pending file runs through the normal runner and ledger.
        await clearStoppedHolds(t);
        await runFileMigrations({
          adapter: t.adapter as never,
          db: t.adapter.getDrizzle(),
          dialect: t.adapter.dialect,
          migrationsDir: HISTORY_DIR(),
          logger: createLogger({ quiet: true }),
        });
        const repo = new SchemaEventsRepository(
          t.adapter.getDrizzle(),
          t.adapter.dialect
        );
        for (const file of written) {
          expect(await repo.isFileApplied(file), file).toBe(true);
        }
        expect(await liveColumns(t, `${TABLE}_locales`)).toContain("heading");
      },
      300_000
    );

    it.runIf(dialect === "mysql")(
      "keeps the record of a translated Single stopped between its files on MySQL, for the stopped-save step",
      async () => {
        const t = await boot();
        await created(t);
        const filesBefore = sqlFiles();
        await stopSave(
          t,
          [text("heading", { localized: true })],
          point => point.startsWith("unit:") && point.includes("localization"),
          true
        );
        const written = sqlFiles().filter(f => !filesBefore.includes(f));

        const settled = await settle(t);

        expect(settled.map(s => s.outcome)).toEqual(["left"]);
        expect(await recordRow(t), "the record stays").toBeDefined();
        expect(sqlFiles()).toEqual([...filesBefore, ...written].sort());
      },
      300_000
    );

    // The Builder save's settle (`settleBeforeBuilderSave`, run inside its schema-change
    // exclusion), asked directly: the stopped save still holds this process's exclusion, which
    // only its process ending would release.
    // A settle that throws after it judged a record left (here, its last step, the removal of stale
    // markers) is taken as unsettled: the start runs no pending migration and registers nothing.
    it("holds back a start whose settle throws after leaving a record", async () => {
      const t = await boot();
      await createdTranslated();
      await stopSave(
        t,
        translatedAdd,
        point =>
          point.startsWith(`file:${HISTORY_DIR()}`) && point.endsWith(".sql"),
        true
      );
      lockPassesThrough.on = true;
      bootFolder.dir = HISTORY_DIR();
      migrateStep.watch = true;
      staleMarkers.fail = true;

      await runBootTimeApplyIfDev({ caller: "settle test" });

      expect(migrateStep.runs, "the start's migrate step ran").toBe(0);
      expect(
        migrateStep.registrations,
        "the start registered entities from the snapshots"
      ).toBe(0);
      expect(await recordRow(t), "the record stays").toBeDefined();
    }, 300_000);

    // A start keeps a pending save's record until the save's remaining files are recorded applied:
    // its migrate step reads the process's own folder, which here is not the one the save wrote to,
    // so they do not run, and the record stays to refuse a Builder save over them.
    it.skipIf(dialect === "mysql")(
      "keeps a pending save's record at a start whose migrate step does not run its files",
      async () => {
        const t = await boot();
        await created(t);
        const filesBefore = sqlFiles();
        await stopSave(
          t,
          [text("heading", { localized: true })],
          point => point.startsWith("unit:") && point.includes("localization"),
          true
        );
        const written = sqlFiles().filter(f => !filesBefore.includes(f));
        await firstFileAlone(t, written);
        lockPassesThrough.on = true;

        await runBootTimeApplyIfDev({ caller: "settle test" });

        expect(await recordRow(t), "the record stays").toBeDefined();
        const repo = new SchemaEventsRepository(
          t.adapter.getDrizzle(),
          t.adapter.dialect
        );
        const unrun = written.filter(f => f.includes("localization"));
        for (const file of unrun) {
          expect(await repo.isFileApplied(file), file).toBe(false);
        }
      },
      300_000
    );

    // A save still pending once the start's migrate step has had its run (its files not among
    // the ones it ran) holds back the start's registration from snapshots, as one left does.
    it.skipIf(dialect === "mysql")(
      "registers nothing from snapshots while a save stays pending after the start's migrate step",
      async () => {
        const t = await boot();
        await created(t);
        const filesBefore = sqlFiles();
        await stopSave(
          t,
          [text("heading", { localized: true })],
          point => point.startsWith("unit:") && point.includes("localization"),
          true
        );
        const written = sqlFiles().filter(f => !filesBefore.includes(f));
        await firstFileAlone(t, written);
        lockPassesThrough.on = true;
        bootFolder.dir = HISTORY_DIR();
        migrateStep.watch = true;
        migrateStep.runsNothing = true;

        await runBootTimeApplyIfDev({ caller: "settle test" });

        expect(migrateStep.runs, "the start's migrate step never ran").toBe(1);
        expect(
          migrateStep.registrations,
          "the start registered entities from the snapshots"
        ).toBe(0);
        expect(await recordRow(t), "the record stays").toBeDefined();
      },
      300_000
    );

    // Where the start's migrate step runs the save's remaining files, the settle after it finds
    // them recorded applied and clears the record.
    it.skipIf(dialect === "mysql")(
      "clears a pending save's record once the start's migrate step has run its files",
      async () => {
        const t = await boot();
        await created(t);
        const filesBefore = sqlFiles();
        await stopSave(
          t,
          [text("heading", { localized: true })],
          point => point.startsWith("unit:") && point.includes("localization"),
          true
        );
        const written = sqlFiles().filter(f => !filesBefore.includes(f));
        await firstFileAlone(t, written);
        lockPassesThrough.on = true;
        bootFolder.dir = HISTORY_DIR();
        migrateStep.watch = true;
        migrateStep.byFiles = true;

        await runBootTimeApplyIfDev({ caller: "settle test" });

        expect(migrateStep.runs, "the start's migrate step never ran").toBe(1);
        const repo = new SchemaEventsRepository(
          t.adapter.getDrizzle(),
          t.adapter.dialect
        );
        for (const file of written) {
          expect(await repo.isFileApplied(file), file).toBe(true);
        }
        expect(await recordRow(t), "the record clears").toBeUndefined();
      },
      300_000
    );

    it.skipIf(dialect === "mysql")(
      "refuses a Builder save while a save stopped between its files is pending, naming the start",
      async () => {
        const t = await boot();
        await created(t);
        await stopSave(
          t,
          [text("heading", { localized: true })],
          point => point.startsWith("unit:") && point.includes("localization"),
          true
        );
        await firstFileAlone(
          t,
          sqlFiles().filter(f => f.includes(SLUG))
        );

        const refused = await settleBeforeBuilderSave(
          t.adapter,
          HISTORY_DIR(),
          {
            info: () => undefined,
            warn: () => undefined,
          }
        ).then(
          () => undefined,
          (error: unknown) => error
        );

        expect(NextlyError.is(refused) ? refused.code : refused).toBe(
          "CONFLICT"
        );
        expect(NextlyError.is(refused) ? refused.publicMessage : "").toContain(
          "its start finishes the previous save"
        );
        expect(await recordRow(t), "the record stays").toBeDefined();
      },
      300_000
    );

    /** Stop a save of `fields` as the scope that made its record clears it: all else is done. */
    async function stoppedAtClear(
      t: TestNextly,
      fields: BuilderField[],
      key = RECORD_KEY,
      saving: () => Promise<unknown> = () => save(t, fields)
    ): Promise<void> {
      const realDelete = MetaService.prototype.delete;
      vi.spyOn(MetaService.prototype, "delete").mockImplementation(
        async function (this: MetaService, deleted: string) {
          if (deleted === key) await stopHere("clear");
          return realDelete.call(this, deleted);
        }
      );
      const reached = new Promise<void>(resolve => {
        kill.reached = resolve;
      });
      kill.at = point => point === "clear";
      stopped = saving().catch((error: unknown) => error);
      const outcome = await Promise.race([
        reached.then(() => "reached"),
        stopped.then(answer => `the save ended first: ${String(answer)}`),
      ]);
      vi.mocked(MetaService.prototype.delete).mockRestore();
      expect(outcome, "the save never reached its record's clear").toBe(
        "reached"
      );
      expect(await new MetaService(t.adapter, consoleLogger).get(key)).toEqual(
        expect.objectContaining({ id: expect.any(String) })
      );
    }

    // A save that applied whole and keeps its record (here, one from before the saved definition
    // was kept, so its registry row cannot be brought up) leaves the row as it may stand stale: the
    // start's registration from snapshots inserts only absent rows and cannot repair it, and its
    // code-first reload would go on over it. Both wait while the record stands.
    it("holds back a start's registration and reload while a save that applied whole keeps its record", async () => {
      const t = await boot();
      await created(t);
      await stoppedAtClear(t, [text("heading"), text("alpha")]);
      const { definitionAfter: _kept, ...older } = (await recordRow(t)) as {
        definitionAfter?: string;
      } & Record<string, unknown>;
      await new MetaService(t.adapter, consoleLogger).set(RECORD_KEY, older);
      lockPassesThrough.on = true;
      bootFolder.dir = HISTORY_DIR();
      migrateStep.watch = true;
      migrateStep.runsNothing = true;
      reloads.stub = true;

      await runBootTimeApplyIfDev({ caller: "settle test" });

      expect(await recordRow(t), "the record stays").toBeDefined();
      expect(
        migrateStep.registrations,
        "the start registered entities from the snapshots"
      ).toBe(0);
      expect(reloads.count, "the start's code-first reload ran").toBe(0);
    }, 300_000);

    // A collection's save that applied whole, stopped after its files were recorded and before its
    // registry row was written: the settle brings the row up from the saved definition, as it does
    // a Single's, and clears the record.
    it("brings a collection's registry row up for a save that applied whole, and clears its record", async () => {
      const t = await boot();
      const posts = "settle_posts";
      const key = `builder-save-in-progress:collection:${posts}`;
      await t.getService("collectionService").createCollection(
        {
          name: posts,
          label: posts,
          fields: [text("heading")],
        } as Parameters<CollectionService["createCollection"]>[0],
        {}
      );
      const rowOf = async () => {
        const [row] = await t.adapter.select<{
          fields: unknown;
          schema_version: unknown;
        }>("dynamic_collections", {
          columns: ["fields", "schema_version"],
          where: { and: [{ column: "slug", op: "=", value: posts }] },
        });
        return row;
      };
      const fieldNames = async () => {
        const fields = (await rowOf())?.fields;
        return (
          (typeof fields === "string" ? JSON.parse(fields) : fields) as Array<{
            name: string;
          }>
        ).map(field => field.name);
      };
      const before = await rowOf();
      expect(await fieldNames()).toEqual(["heading"]);
      await stoppedAtClear(t, [], key, () =>
        dispatchCollections(
          {} as ServiceContainer,
          "applySchemaChanges",
          { collectionName: posts },
          {
            fields: [text("heading"), text("alpha")],
            confirmed: true,
            schemaVersion: Number(before?.schema_version ?? 1),
          }
        )
      );
      // The row as a save stopped before its registry write leaves it: the fields it started from.
      await t.adapter.update(
        "dynamic_collections",
        {
          fields:
            typeof before?.fields === "string"
              ? before.fields
              : JSON.stringify(before?.fields),
        },
        { and: [{ column: "slug", op: "=", value: posts }] }
      );
      expect(await fieldNames()).toEqual(["heading"]);

      const settled = await settle(t);

      expect(settled.map(s => s.outcome)).toEqual(["all"]);
      expect(await fieldNames(), "the registry row").toEqual([
        "heading",
        "alpha",
      ]);
      expect(
        (await new MetaService(t.adapter, consoleLogger).getEntry(key)).present,
        "the record clears"
      ).toBe(false);
    }, 300_000);

    /** A record of a save of another Single, as another machine's process left it. */
    async function anotherHostsRecord(
      t: TestNextly,
      applies: boolean
    ): Promise<string> {
      const key = "builder-save-in-progress:single:settle_other";
      await new MetaService(t.adapter, consoleLogger).set(key, {
        id: "another-hosts-save",
        kind: "single",
        slug: "settle_other",
        startedAt: new Date().toISOString(),
        host: "another-host",
        database: "unknown",
        definitionFile: DEFINITION,
        definitionBefore: null,
        applies,
      });
      return key;
    }

    /** A save's answer: its refusal's message, or "saved". */
    const answerOf = (saving: Promise<unknown>): Promise<string> =>
      saving.then(
        answer =>
          NextlyError.is(answer)
            ? answer.publicMessage
            : answer instanceof Response && !answer.ok
              ? answer.text()
              : "saved",
        (error: unknown) =>
          NextlyError.is(error) ? error.publicMessage : String(error)
      );

    // Another machine's save that applied its own files and was left part-way may have changed this
    // database part-way: no Builder save runs over it, whatever the entity, until that machine's
    // start settles it.
    it("refuses a Builder save of another entity while another host's applying save is left", async () => {
      const t = await boot();
      await created(t);
      const key = await anotherHostsRecord(t, true);

      const answer = await answerOf(save(t, [text("heading"), text("alpha")]));

      expect(answer).toContain("another-host");
      expect(answer).toContain("left part-way");
      expect(await liveColumns(t, TABLE)).not.toContain("alpha");
      expect(
        await new MetaService(t.adapter, consoleLogger).get(key),
        "the other record stays"
      ).toBeDefined();
    }, 300_000);

    // Another machine's save made outside development changed no table: its files are on that
    // machine, for its `nextly migrate`. A save here goes on beside it.
    it("saves beside another host's save made outside development", async () => {
      const t = await boot();
      await created(t);
      const key = await anotherHostsRecord(t, false);

      const answer = await answerOf(save(t, [text("heading"), text("alpha")]));

      expect(answer).toBe("saved");
      expect(await liveColumns(t, TABLE)).toContain("alpha");
      expect(
        await new MetaService(t.adapter, consoleLogger).get(key),
        "the other record stays"
      ).toBeDefined();
    }, 300_000);

    // A create that applied whole and stopped before its registry row was written keeps its record:
    // the settle makes no row. While it stands, a save of any other entity is refused, naming the
    // way out: a development start, whose migrate step adds the row from the newest applied
    // snapshot and whose settle then brings it up and clears the record. After that start, the
    // other save goes through.
    it("refuses other saves over a create stopped before its row until a start clears it", async () => {
      const t = await boot();
      await created(t);
      await stoppedAtClear(t, [text("heading"), text("alpha")]);
      const left = await recordRow(t);
      // The stopped process ends as a killed one does: its record stays, its registry row is
      // missing, and nothing it held is still held.
      kill.release?.();
      kill.release = undefined;
      await stopped;
      stopped = undefined;
      await new MetaService(t.adapter, consoleLogger).set(RECORD_KEY, left);
      await t.adapter.delete("dynamic_singles", {
        and: [{ column: "slug", op: "=", value: SLUG }],
      });
      await clearStoppedHolds(t);
      const other = () =>
        answerOf(
          dispatchSingles(
            "createSingle",
            {},
            {
              slug: "settle_other",
              label: "settle_other",
              fields: [text("title")],
            }
          )
        );

      const refused = await other();
      expect(refused).toContain(`"${SLUG}"`);
      expect(refused).toContain("start the app in development");

      // The way out it names: a development start, its migrate step run for real.
      migrateStep.watch = true;
      reloads.stub = true;
      await runBootTimeApplyIfDev({ caller: "settle test" });

      expect(await recordRow(t), "the record clears").toBeUndefined();
      expect(await registryFieldNames(t), "the registry row").toEqual([
        "heading",
        "alpha",
      ]);
      expect(await other(), "the other save after the start").toBe("saved");
    }, 300_000);

    // A save of this host left as nothing could settle it refuses a save of any other entity too:
    // that save would write its files and snapshot over a state no file finishes describing.
    it("refuses a save of another entity while this host's save is left", async () => {
      const t = await boot();
      await created(t);
      await stopSave(
        t,
        [text("heading"), text("alpha")],
        point =>
          point.startsWith(`file:${HISTORY_DIR()}`) && point.endsWith(".sql")
      );
      await t.adapter.executeQuery(
        `ALTER TABLE ${dialect === "mysql" ? `\`${TABLE}\`` : `"${TABLE}"`} ADD COLUMN ${dialect === "mysql" ? "`by_hand`" : '"by_hand"'} ${dialect === "mysql" ? "VARCHAR(10)" : "TEXT"}`
      );
      expect((await settle(t)).map(s => s.outcome)).toEqual(["left"]);

      // The refusal every Builder save meets before it writes anything (`writeSave`), asked
      // directly: the stopped save still holds this process's exclusion, which a save through the
      // dispatcher would meet first.
      const answer = await answerOf(
        refuseBesideLeftSaves({
          adapter: t.adapter,
          projectRoot: basePath,
          kind: "single",
          slug: "settle_other",
          notify: () => undefined,
        })
      );

      expect(answer).toContain(`"${SLUG}"`);
      expect(answer).toContain("left part-way");
    }, 300_000);

    // A save beside another entity's left save is refused before anything is written, the work its
    // caller does first included (`beforeWrite`: a field leaving translation's archive, say): a
    // save refused as not started has changed nothing.
    it("refuses a save beside another entity's left save before the work its caller does first", async () => {
      const t = await boot();
      await anotherHostsRecord(t, true);
      const { container } = await import("../../../../di/container");
      const setup = container.get<BuilderSaveSetup>("builderSaveSetup");
      let wroteFirst = 0;

      const answer = await answerOf(
        writeCollectionSave(
          {
            ...setup,
            adapter: t.adapter,
            applies: true,
            logger: {
              info: () => undefined,
              warn: () => undefined,
              error: () => undefined,
            },
          },
          {
            slug: "settle_notes",
            previous: null,
            entity: {
              slug: "settle_notes",
              labels: { singular: "Note", plural: "Notes" },
              fields: [text("title")],
            } as never,
            change: "create",
          },
          {
            beforeWrite: async () => {
              wroteFirst += 1;
            },
          }
        )
      );

      expect(answer).toContain("another-host");
      expect(wroteFirst, "the work the caller does first ran").toBe(0);
    }, 300_000);

    // A save of the entity whose own record stands is refused before anything is written too, the
    // work its caller does first included: another host's applying save of it, or this host's that
    // its settle left and that this save does not finish.
    it.each(["another-host", "this host"])(
      "refuses a save over its entity's left record from %s before the work its caller does first",
      async host => {
        const t = await boot();
        await new MetaService(t.adapter, consoleLogger).set(
          "builder-save-in-progress:collection:settle_notes",
          {
            id: "a-left-save-of-notes",
            kind: "collection",
            slug: "settle_notes",
            startedAt: new Date().toISOString(),
            host: host === "this host" ? hostname() : host,
            database: "unknown",
            definitionFile: DEFINITION,
            definitionBefore: null,
            definitionAfter: "a definition this save does not write",
            applies: true,
          }
        );
        const { container } = await import("../../../../di/container");
        const setup = container.get<BuilderSaveSetup>("builderSaveSetup");
        let wroteFirst = 0;

        const answer = await answerOf(
          writeCollectionSave(
            {
              ...setup,
              adapter: t.adapter,
              applies: true,
              logger: {
                info: () => undefined,
                warn: () => undefined,
                error: () => undefined,
              },
            },
            {
              slug: "settle_notes",
              previous: null,
              entity: {
                slug: "settle_notes",
                labels: { singular: "Note", plural: "Notes" },
                fields: [text("title")],
              } as never,
              change: "create",
            },
            {
              beforeWrite: async () => {
                wroteFirst += 1;
              },
            }
          )
        );

        expect(answer).toContain("left part-way");
        expect(wroteFirst, "the work the caller does first ran").toBe(0);
      },
      300_000
    );

    // The start reads its configuration as it always has, from the process's own folder: an app
    // that hands its configuration to `getNextly` may give a `basePath` holding no configuration
    // file, and a pending save there still has its files run.
    it.skipIf(dialect === "mysql")(
      "runs a pending save's files where the app's base path holds no configuration file",
      async () => {
        const t = await boot();
        await created(t);
        const filesBefore = sqlFiles();
        await stopSave(
          t,
          [text("heading", { localized: true })],
          point => point.startsWith("unit:") && point.includes("localization"),
          true
        );
        const written = sqlFiles().filter(f => !filesBefore.includes(f));
        await firstFileAlone(t, written);
        lockPassesThrough.on = true;
        migrateStep.watch = true;
        migrateStep.byFiles = true;
        bootFolder.noConfigAt = basePath;

        await runBootTimeApplyIfDev({ caller: "settle test" });

        const repo = new SchemaEventsRepository(
          t.adapter.getDrizzle(),
          t.adapter.dialect
        );
        for (const file of written) {
          expect(await repo.isFileApplied(file), file).toBe(true);
        }
        expect(await recordRow(t), "the record clears").toBeUndefined();
      },
      300_000
    );

    // The start's migrate step reads the folder the app's saves write to, as its settle does, not
    // the process's own: a save left pending under the app's base path has its files run there.
    it.skipIf(dialect === "mysql")(
      "runs a pending save's files from the folder the app's saves write to",
      async () => {
        const t = await boot();
        await created(t);
        const filesBefore = sqlFiles();
        await stopSave(
          t,
          [text("heading", { localized: true })],
          point => point.startsWith("unit:") && point.includes("localization"),
          true
        );
        const written = sqlFiles().filter(f => !filesBefore.includes(f));
        await firstFileAlone(t, written);
        lockPassesThrough.on = true;
        migrateStep.watch = true;
        migrateStep.byFiles = true;

        await runBootTimeApplyIfDev({ caller: "settle test" });

        const repo = new SchemaEventsRepository(
          t.adapter.getDrizzle(),
          t.adapter.dialect
        );
        for (const file of written) {
          expect(await repo.isFileApplied(file), file).toBe(true);
        }
        expect(await recordRow(t), "the record clears").toBeUndefined();
      },
      300_000
    );
  }
);
