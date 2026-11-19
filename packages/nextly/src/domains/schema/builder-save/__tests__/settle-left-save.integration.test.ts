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
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runFileMigrations } from "../../../../cli/commands/migrate";
import { createLogger } from "../../../../cli/utils/logger";
import { dispatchSingles } from "../../../../dispatcher/handlers/single-dispatcher";
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
import { WRITER_LOCK_FILE } from "../../migrate-create/writer-hold";
import { introspectLiveSnapshot } from "../../pipeline/diff/introspect-live";
import { SCHEMA_LOCK_TABLE } from "../../pipeline/schema-lock";
import {
  settleBeforeBuilderSave,
  settleLeftSaves,
  type SettledSave,
} from "../settle-left-save";
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

      const settled = await settle(t);

      expect(settled.map(s => s.outcome)).toEqual(["all"]);
      expect(await recordRow(t)).toBeUndefined();
      expect(await liveColumns(t, TABLE)).toContain("alpha");
      expect(await registryFieldNames(t)).toContain("alpha");
      for (const file of written) {
        expect(await repo.isFileApplied(file), file).toBe(true);
      }
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
