/**
 * The settle of a Builder save the process left part-way runs the migration history's checks
 * before its first write, as a Builder save does, and records each file it adopts with the checksum
 * `nextly migrate` checks it by.
 *
 * A settle writes migration files and ledger rows: on a history those checks cannot vouch for (an
 * applied file edited, an applied migration missing from the folder, an unresolved attempt) it
 * stops with the check's refusal and writes nothing, the record kept, so the save stays unsettled
 * until the history is put right. Run at the development start and before a Builder save.
 *
 * A kill is made as the record's own suite makes one: the step at the kill point runs and then
 * never returns, so no `catch` or `finally` of the save runs.
 */
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { folderSnapshot } from "../../../../cli/__tests__/helpers/folder-snapshot";
import { dispatchSingles } from "../../../../dispatcher/handlers/single-dispatcher";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import { consoleLogger } from "../../../../shared/types";
import { MetaService } from "../../../meta/services/meta-service";
import { SchemaEventsRepository } from "../../events/schema-events-repository";
import { checksumOf } from "../../migrate/applied-checksums";
import { WRITER_LOCK_FILE } from "../../migrate-create/writer-hold";
import { introspectLiveSnapshot } from "../../pipeline/diff/introspect-live";
import { SCHEMA_LOCK_TABLE } from "../../pipeline/schema-lock";
import {
  settleBeforeBuilderSave,
  settleLeftSaves,
  type SettledSave,
} from "../settle-left-save";
import { settleRegistryWriter } from "../settle-registry";

/** Where the save is stopped, and how to let it go. Shared with the module mock below. */
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
const SLUG = "history_hero";
const TABLE = "single_history_hero";
const RECORD_KEY = `builder-save-in-progress:single:${SLUG}`;

let current: TestNextly | undefined;
let basePath: string;
let stopped: Promise<unknown> | undefined;

beforeEach(() => {
  basePath = mkdtempSync(join(tmpdir(), "nextly-settle-history-"));
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
const logger = { info: () => undefined, warn: () => undefined };

async function versionOf(t: TestNextly): Promise<number> {
  const [row] = await t.adapter.select<{ schemaVersion: unknown }>(
    "dynamic_singles",
    { where: { and: [{ column: "slug", op: "=", value: SLUG }] } }
  );
  return Number(row?.schemaVersion ?? 1);
}

async function recordRow(t: TestNextly): Promise<unknown> {
  const entry = await new MetaService(t.adapter, consoleLogger).getEntry(
    RECORD_KEY
  );
  return entry.present ? entry.value : undefined;
}

async function liveColumns(t: TestNextly): Promise<string[]> {
  const live = await introspectLiveSnapshot(
    t.adapter.getDrizzle(),
    t.adapter.dialect,
    [TABLE]
  );
  return (live.tables.find(each => each.name === TABLE)?.columns ?? []).map(
    column => column.name
  );
}

function save(t: TestNextly, fields: BuilderField[]): Promise<unknown> {
  return versionOf(t).then(schemaVersion =>
    dispatchSingles(
      "applySingleSchemaChanges",
      { slug: SLUG },
      { fields, confirmed: true, schemaVersion }
    )
  );
}

/** Start a save of `fields` and stop it where `at` says; resolves once it has stopped there. */
async function stopSave(
  t: TestNextly,
  fields: BuilderField[],
  at: (point: string) => boolean
): Promise<void> {
  const reached = new Promise<void>(resolve => {
    kill.reached = resolve;
  });
  kill.at = at;
  stopped = save(t, fields).catch((error: unknown) => error);
  const outcome = await Promise.race([
    reached.then(() => "reached"),
    stopped.then(answer => `the save ended first: ${String(answer)}`),
  ]);
  expect(outcome, "the save never reached the kill point").toBe("reached");
}

/** What the stopped process held, cleared as its lapse would clear it. */
async function clearStoppedHolds(t: TestNextly): Promise<void> {
  await t.adapter.executeQuery(`DELETE FROM ${SCHEMA_LOCK_TABLE}`);
  rmSync(join(HISTORY_DIR(), WRITER_LOCK_FILE), { force: true });
}

/** The settle, as the next development start runs it, over the same database and folder. */
function settleAtStart(t: TestNextly): Promise<SettledSave[]> {
  return settleLeftSaves({
    adapter: t.adapter,
    projectRoot: basePath,
    migrationsDir: HISTORY_DIR(),
    logger,
    writeRegistry: settleRegistryWriter(t.adapter),
  });
}

/** The settle a Builder save runs first, asked directly as the record's own suite asks it. */
function settleBeforeSave(t: TestNextly): Promise<unknown> {
  return settleBeforeBuilderSave(t.adapter, HISTORY_DIR(), logger);
}

/** Each way the history fails the checks, made on the folder or the ledger. */
const HISTORY_FAULTS: Array<{
  name: string;
  make: (t: TestNextly, applied: string) => Promise<void>;
}> = [
  {
    name: "an applied file edited",
    make: async (_t, applied) => {
      const path = join(HISTORY_DIR(), applied);
      writeFileSync(path, `${readFileSync(path, "utf-8")}\n-- edited\n`);
    },
  },
  {
    name: "an applied migration missing from the folder",
    make: async (_t, applied) => {
      rmSync(join(HISTORY_DIR(), applied));
    },
  },
  {
    name: "an unresolved attempt",
    make: async t => {
      const repo = new SchemaEventsRepository(
        t.adapter.getDrizzle(),
        t.adapter.dialect
      );
      await repo.recordStart({
        eventType: "file_apply",
        source: "cli-migrate",
        filename: "29990101_000000_000_unresolved.sql",
      } as Parameters<SchemaEventsRepository["recordStart"]>[0]);
    },
  },
];

const SETTLES: Array<{
  road: string;
  run: (t: TestNextly) => Promise<unknown>;
}> = [
  { road: "at the development start", run: settleAtStart },
  { road: "before a Builder save", run: settleBeforeSave },
];

describe.each(getConfiguredTestDialects())(
  "the settle of a save left part-way, over the migration history (%s)",
  dialect => {
    async function boot(): Promise<TestNextly> {
      vi.stubEnv("NODE_ENV", "development");
      current = await createTestNextly({
        dialect,
        basePath,
        db: { migrationsDir: HISTORY, uiSchemaFile: DEFINITION },
      });
      await dispatchSingles(
        "createSingle",
        {},
        { slug: SLUG, label: SLUG, fields: [text("heading")] }
      );
      expect(await recordRow(current), "after the create").toBeUndefined();
      return current;
    }

    // The control: the same stop over a history with no fault settles, as none of it applied, so
    // each refusal below is its fault's, not one every such stop meets.
    for (const settle of SETTLES) {
      it(`settles the same stop ${settle.road} over a history with no fault`, async () => {
        const t = await boot();
        const before = sqlFiles();
        await stopSave(t, [text("heading"), text("alpha")], point =>
          point.startsWith("unit:")
        );
        await clearStoppedHolds(t);
        expect(sqlFiles().length, "the stopped save's file").toBeGreaterThan(
          before.length
        );

        await settle.run(t);

        expect(await recordRow(t), "the record clears").toBeUndefined();
        expect(sqlFiles(), "the stopped save's file removed").toEqual(before);
      }, 300_000);
    }

    for (const fault of HISTORY_FAULTS) {
      for (const settle of SETTLES) {
        it(`refuses with the check's message and writes nothing ${settle.road}, with ${fault.name}`, async () => {
          const t = await boot();
          // The Single's create file, applied: the one the history faults are made on.
          const [applied] = sqlFiles();
          expect(applied, "the applied create file").toBeDefined();
          // Stopped before its file ran: a settle would remove the file and put the definition back.
          await stopSave(t, [text("heading"), text("alpha")], point =>
            point.startsWith("unit:")
          );
          await clearStoppedHolds(t);
          await fault.make(t, applied!);
          // Every file of the folder by its content, the snapshots included, and the record: a
          // settle that rewrote one under the same name, or changed the record, is told apart.
          const folder = folderSnapshot(HISTORY_DIR());
          const definition = definitionText();
          const record = await recordRow(t);

          await expect(settle.run(t)).rejects.toThrow(
            expect.objectContaining({
              code: "NEXTLY_MIGRATION_HISTORY_REFUSED",
            })
          );

          expect(folderSnapshot(HISTORY_DIR())).toEqual(folder);
          expect(definitionText()).toBe(definition);
          expect(record, "the stopped save's record").toBeDefined();
          expect(await recordRow(t), "the record stays as it was").toEqual(
            record
          );
        }, 300_000);
      }
    }

    // Two saves left on this host: one the settle leaves as it stands (made outside development,
    // its files left for `nextly migrate`), with an attempt at its file unresolved, and one it can
    // settle. An attempt is passed over only while its own save is settled: the other's refuses
    // the settle before anything of the one it could settle is written.
    it("refuses to settle a save over another save's unresolved attempt that it leaves, writing nothing", async () => {
      const t = await boot();
      const side = "history_side";
      const sideFile = "29990101_000000_000_history_side_update.sql";
      await dispatchSingles(
        "createSingle",
        {},
        { slug: side, label: side, fields: [text("heading")] }
      );
      await stopSave(t, [text("heading"), text("alpha")], point =>
        point.startsWith("unit:")
      );
      await clearStoppedHolds(t);
      // The other save's record, as one made outside development stands: its file in the folder and
      // named, its attempt at it started under `nextly migrate` and never ended. In the folder, so
      // no check of a missing file refuses before the attempts are judged.
      writeFileSync(
        join(HISTORY_DIR(), sideFile),
        "-- UP\nSELECT 1;\n\n-- DOWN\nSELECT 1;\n"
      );
      const stood = (await recordRow(t)) as Record<string, unknown>;
      await new MetaService(t.adapter, consoleLogger).set(
        `builder-save-in-progress:single:${side}`,
        {
          ...stood,
          id: randomUUID(),
          slug: side,
          applies: false,
          files: [sideFile],
        }
      );
      await new SchemaEventsRepository(
        t.adapter.getDrizzle(),
        t.adapter.dialect
      ).recordStart({
        eventType: "file_apply",
        source: "cli-migrate",
        filename: sideFile,
      } as Parameters<SchemaEventsRepository["recordStart"]>[0]);
      const folder = folderSnapshot(HISTORY_DIR());
      const definition = definitionText();

      await expect(settleAtStart(t)).rejects.toThrow(
        expect.objectContaining({ code: "NEXTLY_MIGRATION_HISTORY_REFUSED" })
      );

      expect(folderSnapshot(HISTORY_DIR())).toEqual(folder);
      expect(definitionText()).toBe(definition);
      expect(await recordRow(t), "the record it could settle stays").toEqual(
        stood
      );
    }, 300_000);

    // A Single whose row the table holds takes a field with a default by the push, which fills the
    // row; the save's files are recorded after it. Stopped before the first is recorded, the table
    // stands at the save's target with its files unrecorded: the settle records them itself.
    // Reached on SQLite alone, where the push commits before its files are recorded. On PostgreSQL
    // the push's transaction is still open as they are recorded (a reader of the table waits on
    // it), so a stop there leaves none of the change. On MySQL this save runs its own file, whose
    // attempt is recorded before its statements: a stop before the record leaves nothing applied,
    // and one after it is a stop inside the file, which the stopped-save settle records.
    it.runIf(dialect === "sqlite")(
      "records each file it adopts with the checksum nextly migrate checks it by",
      async () => {
        const t = await boot();
        // The Single's one row, which a field with a default fills.
        await t.nextly.updateSingle({
          slug: SLUG,
          data: { heading: "Hello", _overwrite: true },
        } as never);
        const before = sqlFiles();
        const realStart = SchemaEventsRepository.prototype.recordStart;
        vi.spyOn(
          SchemaEventsRepository.prototype,
          "recordStart"
        ).mockImplementation(async function (
          this: SchemaEventsRepository,
          ...args: Parameters<SchemaEventsRepository["recordStart"]>
        ) {
          await stopHere("record");
          return realStart.apply(this, args);
        });
        await stopSave(
          t,
          [text("heading"), text("alpha", { defaultValue: "a" })],
          point => point === "record"
        );
        vi.mocked(SchemaEventsRepository.prototype.recordStart).mockRestore();
        await clearStoppedHolds(t);
        // The push applied the change; nothing of it is recorded yet.
        expect(await liveColumns(t)).toContain("alpha");
        const written = sqlFiles().filter(f => !before.includes(f));
        expect(written.length).toBeGreaterThan(0);
        const repo = new SchemaEventsRepository(
          t.adapter.getDrizzle(),
          t.adapter.dialect
        );
        for (const file of written) {
          expect(await repo.isFileApplied(file), file).toBe(false);
        }

        const settled = await settleAtStart(t);

        expect(settled.map(s => s.outcome)).toEqual(["all"]);
        const rows = await repo.listFileApplies();
        for (const file of written) {
          const row = rows.find(
            r => r.filename === file && r.status === "applied"
          );
          expect(row?.sha256, file).toBe(
            checksumOf(readFileSync(join(HISTORY_DIR(), file), "utf-8"))
          );
        }
      },
      300_000
    );
  }
);
