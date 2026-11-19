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
  rmSync,
  writeFileSync,
} from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runFileMigrations } from "../../../../cli/commands/migrate";
import { createLogger } from "../../../../cli/utils/logger";
import { writeAppliedFieldsRow } from "../../../../dispatcher/helpers/applied-fields-row";
import { dispatchSingles } from "../../../../dispatcher/handlers/single-dispatcher";
import { runBootTimeApplyIfDev } from "../../../../init/boot-apply";
import { NextlyError } from "../../../../errors/nextly-error";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import { consoleLogger } from "../../../../shared/types";
import { MetaService } from "../../../meta/services/meta-service";
import { SchemaEventsRepository } from "../../events/schema-events-repository";
import { recordAlreadyApplied } from "../../migrate/drift-reconcile";
import { WRITER_LOCK_FILE } from "../../migrate-create/writer-hold";
import { introspectLiveSnapshot } from "../../pipeline/diff/introspect-live";
import { SCHEMA_LOCK_TABLE } from "../../pipeline/schema-lock";
import {
  settleBeforeBuilderSave,
  settleLeftSaves,
  type SettledSave,
} from "../settle-left-save";
import { recordSaveStarted, withSaveRecords } from "../save-in-progress";
import { settleRegistryReader, settleRegistryWriter } from "../settle-registry";

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

/** The settle, as the next development start runs it, over the same database and folder. */
function settle(t: TestNextly): Promise<SettledSave[]> {
  return settleLeftSaves({
    adapter: t.adapter,
    projectRoot: basePath,
    migrationsDir: HISTORY_DIR(),
    logger: { info: () => undefined, warn: () => undefined },
    writeRegistry: settleRegistryWriter(t.adapter),
    registryHolds: settleRegistryReader(t.adapter),
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
    // the definition would be put back and the file left to run. The record stays.
    it("keeps a record where a file written as the save stopped cannot be told as its own", async () => {
      const t = await boot();
      await createdTranslated();
      const filesBefore = sqlFiles();
      const definitionBefore = definitionText();
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
      expect(definitionText(), "the definition is not put back").not.toBe(
        definitionBefore
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

    // On PostgreSQL and SQLite a file runs and is recorded in one transaction, so a file with no
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
  }
);
