/**
 * A Builder save's record that it has started, so a save the process never finished is known
 * afterwards.
 *
 * A save writes its definition, its migration files and, in development, its statements, its
 * ledger rows and its registry row, in that order, and a process killed between two of them leaves
 * the project part-way with nothing saying so. The record is written before the first of those
 * writes and cleared once the save has ended, written or refused: a record that stands is a save
 * whose process stopped.
 *
 * It is kept twice, as one record:
 *
 * - a `nextly_meta` row, under a key per entity, for every reader with a database: another
 *   process writing through REST, the development start, `nextly migrate`;
 * - a marker file in the project's `.nextly/` folder, for `migrate:check` and `migrate:create`,
 *   which connect to no database.
 *
 * The marker names the host it was written on and the database it belongs to (a hash of the URL's
 * host, port and database name, never the URL), so a project that commits `.nextly/` does not
 * refuse on another machine or against another database: there it is one line of notice.
 *
 * A record is cleared when the scope that made it ends (`withSaveRecords`): the schema-change
 * exclusion every Builder save runs in, so the registry write after the save's files is inside it,
 * or the writer itself where nothing opened one. It is cleared only where the save's outcome is
 * itself recorded: a save that ended, or one that failed and withdrew everything it wrote. A save
 * that ended with part of it kept and nothing recording what (a MySQL save stopped part-way, whose
 * files stay recorded applied nowhere), or that failed before withdrawing, keeps its record.
 *
 * A record already standing for the entity, from a process that stopped, is neither replaced nor
 * cleared by a later save: it describes where that save started from. Nor is a marker another
 * machine left, which a project committing `.nextly/` carries.
 *
 * @module domains/schema/builder-save/save-in-progress
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import {
  link,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { hostname } from "node:os";
import { dirname, join, relative } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { like, type SQL } from "drizzle-orm";
import { z } from "zod";

import { loadedDialect } from "../../../database/dialect-tables";
import { NextlyError } from "../../../errors/nextly-error";
import type { AddressKind } from "../../../shared/address-rule";
import { consoleLogger } from "../../../shared/types";
import { MetaService } from "../../meta/services/meta-service";
import { busyTableBounds } from "../busy-table/bounds";
import { endedWaiting } from "../busy-table/ended-waiting";
import { readHolders } from "../busy-table/holder";
import { tableBusyError, tryNotice } from "../busy-table/report";
import { boundSqliteWait } from "../busy-table/session-try";
import { withBusyTableTries } from "../busy-table/tries";
import { assertSchemaLockHeld } from "../pipeline/schema-lock";
import { readSchemaVersion } from "../schema-version";

import { databaseIdentity, UNKNOWN_DATABASE } from "./saved-database";

/** The kinds of entity a Builder save writes. */
export type SaveInProgressKind = AddressKind;

/**
 * One save's record that it has started, as it is stored and as a marker is parsed back: a marker
 * of any other shape is one whose save cannot be told, and is read as unreadable.
 */
const savedRecord = z.object({
  /** Tells this save's record from another's for the same entity. */
  id: z.string().min(1),
  kind: z.enum(["collection", "single", "fieldGroup"] satisfies AddressKind[]),
  slug: z.string().min(1),
  /** When the save started, as an ISO timestamp. */
  startedAt: z.string(),
  /** The host the save ran on. */
  host: z.string(),
  /** The database it wrote to, as `savedDatabase` names it: a hash, or `unknown`. */
  database: z.union([
    z.literal(UNKNOWN_DATABASE),
    z.string().regex(/^[0-9a-f]{32}$/),
  ]),
  /** The definition file, relative to the project root. */
  definitionFile: z.string(),
  /** The definition file's text before the save; null where there was none. */
  definitionBefore: z.string().nullable(),
  /**
   * The text the save writes to the definition file, so a settle tells the save's own write from
   * an edit made since. Absent from a record written before it was kept.
   */
  definitionAfter: z.string().optional(),
  /**
   * The snapshot the save's files chain from, which a settle judges "none of it landed" against:
   * the newest on disk when the save started, applied or not. Null where there was none; absent
   * from a record written before it was kept.
   */
  startedFrom: z.string().nullable().optional(),
  /**
   * The migration files the save wrote, as it learned each one's name. A file written after the
   * last of these updates is found by the settle from the folder itself.
   */
  files: z.array(z.string()).optional(),
  /**
   * The moment the save's migration files are named for (`formatTimestamp`), recorded before any
   * is written: a file the record has not named yet is the save's only where its name is of that
   * moment. Absent from a record written before it was kept.
   */
  filesAt: z.string().optional(),
  /**
   * Whether the save applies its files itself (in development), false where it leaves them for
   * `nextly migrate`: such a save's tables stand where they started by design, so no settle judges
   * it from them. Absent from a record written before it was kept.
   */
  applies: z.boolean().optional(),
});
type SaveInProgress = z.infer<typeof savedRecord>;

/** A record of a save that has started, as a settle reads it. */
export type LeftSave = SaveInProgress;

const KEY_PREFIX = "builder-save-in-progress:";

/** The `nextly_meta` key an entity's record is kept under. */
function saveInProgressKey(kind: SaveInProgressKind, slug: string): string {
  return `${KEY_PREFIX}${kind}:${slug}`;
}

/** The folder of the project's markers. */
export function saveInProgressFolder(projectRoot: string): string {
  return join(projectRoot, ".nextly", "save-in-progress");
}

/**
 * The marker file a record is kept in: one per record, named by its entity and its id, so no
 * marker, another machine's included, is ever in the place of another.
 */
function markerPath(projectRoot: string, record: SaveInProgress): string {
  return join(
    saveInProgressFolder(projectRoot),
    `${record.kind}-${record.slug}-${record.id}.json`
  );
}

/**
 * A record a scope made, and what its save said of how it ended: `withdrawn` where it failed and
 * removed everything it wrote, `settled` where it stopped part way and recorded what applied,
 * `left` where it kept part of itself with nothing recording what.
 */
interface MadeRecord {
  adapter: DrizzleAdapter;
  projectRoot: string;
  record: SaveInProgress;
  ending: "open" | "withdrawn" | "settled" | "left";
  /**
   * The stored schema version's count of registry writes when the record was made (`seq`),
   * undefined where none was stored: a save whose registry write committed moved it since.
   */
  registryWritesBefore: number | undefined;
}

/** What a writer tells its record of how the save went. */
export interface StartedSave {
  /**
   * The save wrote these migration files: they join the record's `files`, in the row and then the
   * marker, so a settle after a stop knows them by name.
   */
  filesWritten(names: readonly string[]): Promise<void>;
  /** The save failed and withdrew everything it wrote: its record clears with the scope. */
  withdrawn(): void;
  /**
   * The save stopped part way and what applied was recorded (`settleStoppedSave`): its record
   * clears with the scope, though the save is thrown as a failure.
   */
  settled(): void;
  /** Part of the save was kept and nothing records what: its record stays. */
  left(): void;
}

/** For a save that made no record of its own (one already stood for the entity). */
const NO_RECORD: StartedSave = {
  filesWritten: () => Promise.resolve(),
  withdrawn: () => undefined,
  settled: () => undefined,
  left: () => undefined,
};

const scopes = new AsyncLocalStorage<MadeRecord[]>();

/**
 * The records of `made` an ending clears: one whose save withdrew everything it wrote, or settled
 * what applied of a part-way stop, and, where the work ended without throwing, one whose save's
 * registry write committed, which moves the stored schema version (`registryWritten`). A resolved
 * scope alone says nothing: a service can answer a failed registry write as a result, after the
 * definition, files and statements were written. A record left part-way never clears.
 */
async function clearedBy(
  made: readonly MadeRecord[],
  ended: boolean,
  logger: { warn(message: string): void }
): Promise<MadeRecord[]> {
  const cleared: MadeRecord[] = [];
  for (const entry of made) {
    if (entry.ending === "withdrawn" || entry.ending === "settled") {
      cleared.push(entry);
    } else if (
      ended &&
      entry.ending === "open" &&
      (await registryWritten(entry, logger))
    ) {
      cleared.push(entry);
    }
  }
  return cleared;
}

/** The stored schema version's count of registry writes, or undefined where none is stored. */
async function registryWrites(
  adapter: DrizzleAdapter
): Promise<number | undefined> {
  const stored = await readSchemaVersion(
    adapter.getDrizzle(),
    adapter.getCapabilities().dialect
  );
  return stored.present ? stored.version?.seq : undefined;
}

/**
 * Whether the save's registry write committed since its record was made: the count of registry
 * writes moved. A count that cannot be read keeps the record, which the next start settles.
 */
async function registryWritten(
  entry: MadeRecord,
  logger: { warn(message: string): void }
): Promise<boolean> {
  try {
    const now = await registryWrites(entry.adapter);
    if (now === undefined) return false;
    return (
      entry.registryWritesBefore === undefined ||
      now > entry.registryWritesBefore
    );
  } catch (error) {
    logger.warn(
      `Whether the save of ${entry.record.kind} "${entry.record.slug}" recorded its registry row could not be read (${error instanceof Error ? error.message : String(error)}), so its record that it was in progress stays. ${clearByHand(entry.projectRoot, entry.record)}`
    );
    return false;
  }
}

/**
 * Run `work` in a scope that clears the records made inside it when it ends, as their saves'
 * outcomes allow (`clearedBy`). A scope inside another joins it, so the outermost clears: the
 * schema-change exclusion, around the save and the registry write after it.
 *
 * Clearing that fails is logged, never thrown: the save's own outcome stands, and the record left
 * is one the next start settles, which finds nothing to settle.
 */
export async function withSaveRecords<T>(
  work: () => Promise<T>,
  logger: { warn(message: string): void } = consoleLogger
): Promise<T> {
  if (scopes.getStore() !== undefined) return work();
  const made: MadeRecord[] = [];
  let ended = false;
  try {
    const result = await scopes.run(made, work);
    ended = true;
    return result;
  } finally {
    await clearRecords(await clearedBy(made, ended, logger), logger);
  }
}

/**
 * A scope opened now and ended by the caller later, for a writer whose save ends after it returns
 * (`prepareCollectionSave`): `end(true)` once the save ended, `end(false)` once it failed. Inside a
 * scope already open it joins that one, and `end` does nothing.
 */
export function openSaveRecords(
  logger: { warn(message: string): void } = consoleLogger
): {
  run<T>(work: () => Promise<T>): Promise<T>;
  end(ended: boolean): Promise<void>;
} {
  if (scopes.getStore() !== undefined) {
    return { run: work => work(), end: () => Promise.resolve() };
  }
  const made: MadeRecord[] = [];
  return {
    run: work => scopes.run(made, work),
    end: async ended =>
      clearRecords(await clearedBy(made, ended, logger), logger),
  };
}

/**
 * Record that a save of `kind` `slug` has started: the row, then the marker. Called before the
 * save's first write, inside a scope (`withSaveRecords`), which clears it when it ends.
 *
 * Where a record already stands for the entity, a save whose process stopped, it is kept as it is
 * and this save makes none: it is what that save started from. A marker already in place, another
 * machine's, is kept the same way, and this save's record is the row alone.
 */
export async function recordSaveStarted(args: {
  adapter: DrizzleAdapter;
  projectRoot: string;
  kind: SaveInProgressKind;
  slug: string;
  /** The definition file's absolute path. */
  definitionFile: string;
  definitionBefore: string | undefined;
  /** The text the save is about to write to the definition file. */
  definitionAfter?: string;
  /** The newest snapshot on disk when the save started, which its files chain from. */
  startedFrom?: string | null;
  /** The moment the save's migration files are named for, as an ISO timestamp. */
  filesAt?: string;
  /** Whether the save applies its own files (in development) rather than leaving them. */
  applies?: boolean;
  /** The database the save writes to (`savedDatabase`); unknown where not given. */
  database: string | undefined;
  /** The save's log, which a try after the first is noticed in while the database is busy. */
  notify: (line: string) => void;
}): Promise<StartedSave> {
  const made = scopes.getStore();
  // Every writer opens a scope before it gets here; without one, nothing would clear the record.
  if (made === undefined) {
    throw NextlyError.internal({
      logContext: {
        reason: "a save's record made outside a scope",
        slug: args.slug,
      },
    });
  }
  const record: SaveInProgress = {
    id: randomUUID(),
    kind: args.kind,
    slug: args.slug,
    startedAt: new Date().toISOString(),
    host: hostname(),
    database: args.database ?? UNKNOWN_DATABASE,
    definitionFile: relative(args.projectRoot, args.definitionFile),
    definitionBefore: args.definitionBefore ?? null,
    ...(args.definitionAfter === undefined
      ? {}
      : { definitionAfter: args.definitionAfter }),
    ...(args.startedFrom === undefined
      ? {}
      : { startedFrom: args.startedFrom }),
    ...(args.filesAt === undefined ? {} : { filesAt: args.filesAt }),
    ...(args.applies === undefined ? {} : { applies: args.applies }),
  };
  const meta = new MetaService(args.adapter, consoleLogger);
  const key = saveInProgressKey(args.kind, args.slug);
  // Read before anything of the save: its registry write, once it commits, moves the count.
  const registryWritesBefore = await registryWrites(args.adapter);
  await insertInTries(meta, key, record, args.adapter, args.notify);
  // Read back, since the insert does not say whether it wrote: a record that stood already is kept.
  const standing = await meta.get<unknown>(key);
  const stood = savedRecord.safeParse(standing);
  if (!stood.success) {
    // A record that cannot be read names no save to keep a marker for: the save is refused, so
    // nothing more is written over a part-way state that cannot be told. Nothing settles such a
    // record yet, so the refusal names the one row and the step that clears it by hand.
    throw NextlyError.conflict({
      reason: "state",
      message: `A Builder save of this ${args.kind === "fieldGroup" ? "field group" : args.kind} was left part-way, and its record cannot be read. ${unreadableRecordStep(key)}`,
      logContext: { reason: "builder-save-record-unreadable", key },
    });
  }
  // A later step of the save that made the record in this scope (a Single's save writes a field
  // leaving translation as a step of its own, then the rest): the record is this save's, and goes on
  // for it, saying what the save now writes.
  const own = made.find(entry => entry.record.id === stood.data.id);
  if (own !== undefined) return joinedStep(own, meta, key, args);
  if (stood.data.id !== record.id) {
    return beside(args, key, stood.data);
  }
  const entry: MadeRecord = {
    adapter: args.adapter,
    projectRoot: args.projectRoot,
    record,
    ending: "open",
    registryWritesBefore,
  };
  made.push(entry);
  try {
    await placeMarker(markerPath(args.projectRoot, record), record);
  } catch (error) {
    // Nothing of the save is written yet: without its marker, the row alone would stand for a
    // save the commands with no database cannot see, so it goes too and the save is refused. A
    // marker the failure came after (its temporary copy not removed, say) goes first.
    made.splice(made.indexOf(entry), 1);
    try {
      await removeMarker(markerPath(args.projectRoot, record), record);
    } finally {
      await meta.delete(key);
    }
    throw error;
  }
  return {
    filesWritten: names => noteFilesWritten(entry, meta, key, names),
    withdrawn: () => {
      if (entry.ending === "open") entry.ending = "withdrawn";
    },
    settled: () => {
      if (entry.ending === "open") entry.ending = "settled";
    },
    left: () => {
      entry.ending = "left";
    },
  };
}

/**
 * Add `names` to the record's files: the row, only while it is still this record (a row another
 * process moved is left to that process), then the marker, replaced whole. A stop between the two
 * leaves the row ahead of the marker, which the commands with no database read only for the save
 * it names.
 */
/**
 * A save of an entity whose record already stands, a save whose process stopped. Its marker stays
 * in place, put back where it went missing (the row written, the process stopped before the
 * marker), so the commands with no database see it while this save runs. The save goes on beside
 * it, making no record of its own, or is refused (below).
 */
async function beside(
  args: { projectRoot: string; definitionAfter?: string },
  key: string,
  stood: SaveInProgress
): Promise<StartedSave> {
  await placeMarker(markerPath(args.projectRoot, stood), stood, {
    kept: true,
  });
  // One of this host's that its settle, which ran before this save, could not settle: a save of
  // the entity over it would write past a state nothing has finished. Another host's is settled
  // by that host's start, and this save goes on beside it.
  // The same save again (its definition the one the left save was writing) goes on: it is the
  // way that save is finished, and the settle after it (`withSchemaChangeExcluded`) judges the
  // record then. Any other save of the entity is refused.
  const finishing =
    args.definitionAfter !== undefined &&
    stood.definitionAfter === args.definitionAfter;
  // A record of a save that applied nothing (outside development, its files left for
  // `nextly migrate`) is not one a settle judges: a save goes on beside it, as beside another
  // host's.
  if (stood.host === hostname() && stood.applies !== false && !finishing) {
    throw NextlyError.conflict({
      reason: "state",
      message: `${described(stood).replace(/^a /, "A ")} was left part-way and could not be settled, so this save was not started. ${clearByHand(args.projectRoot, stood)}`,
      logContext: {
        reason: "builder-save-left-unsettled",
        key,
        record: stood.id,
      },
    });
  }
  return NO_RECORD;
}

/**
 * The record a save's later step goes on with: the save's own, made by its first step in this
 * scope, brought to what the step writes (its definition, and the moment its files are named for,
 * which a file not yet noted is of). The step's files join the record; how the save ended stays
 * the first step's to say, except that a step that kept part of what it wrote leaves the record.
 */
async function joinedStep(
  entry: MadeRecord,
  meta: MetaService,
  key: string,
  step: { definitionAfter?: string; filesAt?: string }
): Promise<StartedSave> {
  const next: SaveInProgress = {
    ...entry.record,
    ...(step.definitionAfter === undefined
      ? {}
      : { definitionAfter: step.definitionAfter }),
    ...(step.filesAt === undefined ? {} : { filesAt: step.filesAt }),
  };
  if (await meta.compareAndSet(key, entry.record, next)) {
    const path = markerPath(entry.projectRoot, entry.record);
    entry.record = next;
    await replaceMarker(path, next);
  }
  return {
    filesWritten: names => noteFilesWritten(entry, meta, key, names),
    withdrawn: () => undefined,
    left: () => {
      entry.ending = "left";
    },
  };
}

async function noteFilesWritten(
  entry: MadeRecord,
  meta: MetaService,
  key: string,
  names: readonly string[]
): Promise<void> {
  if (names.length === 0) return;
  const next: SaveInProgress = {
    ...entry.record,
    files: [...(entry.record.files ?? []), ...names],
  };
  if (!(await meta.compareAndSet(key, entry.record, next))) return;
  const path = markerPath(entry.projectRoot, entry.record);
  entry.record = next;
  await replaceMarker(path, next);
}

/**
 * Put `record` at `path` in place of the marker there, whole: written aside, then renamed over it,
 * so a reader sees the old marker or the new one, never half of either.
 */
async function replaceMarker(
  path: string,
  record: SaveInProgress
): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, {
      encoding: "utf-8",
      flag: "wx",
    });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

/**
 * Insert `record` under `key` unless one stands, waiting for a busy database as the save's own
 * statements wait. On SQLite another connection's write transaction holds the whole database, so
 * the insert, the save's first write, waits in tries within the save's busy bounds, with a notice
 * at each try after the first, and stops as table busy, nothing changed, where they run out: a
 * save never goes on without its record. Elsewhere a held table holds no other, and it runs once.
 */
async function insertInTries(
  meta: MetaService,
  key: string,
  record: SaveInProgress,
  adapter: DrizzleAdapter,
  notify: (line: string) => void
): Promise<void> {
  const dialect = adapter.getCapabilities().dialect;
  if (dialect !== "sqlite") {
    await meta.insertIfAbsent(key, record);
    return;
  }
  await withBusyTableTries(
    {
      bounds: busyTableBounds({ env: process.env }),
      change: `the record that the save of ${record.kind} "${record.slug}" is in progress`,
      appliedBefore: [],
      notify,
      notice: tryNotice,
      assertHeld: assertSchemaLockHeld,
      stopped: tableBusyError,
    },
    async (_tryNumber, tryMs) => {
      // Each try waits for the database no longer than its own bound, as the save's tries do.
      const restore = await boundSqliteWait(adapter, tryMs);
      try {
        await meta.insertIfAbsent(key, record);
        return { kind: "done", value: undefined };
      } catch (error) {
        if (!endedWaiting(error, dialect, false)) throw error;
        // One statement in no transaction, which did not run: nothing of it stays.
        return {
          kind: "ended",
          ended: {
            table: null,
            holder: await readHolders(adapter, dialect, undefined),
          },
          undone: true,
          committed: [],
        };
      } finally {
        await restore();
      }
    }
  );
}

/**
 * Put `record` at `path` whole: written aside, then linked into place, so a reader never sees half
 * a marker, and a path already taken (a record's own id, so never another's) is never replaced.
 */
async function placeMarker(
  path: string,
  record: SaveInProgress,
  options: {
    /** Putting back a standing record's marker: one already there is that record's, and stays. */
    kept?: boolean;
  } = {}
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, {
      encoding: "utf-8",
      flag: "wx",
    });
    await link(temporary, path);
  } catch (error) {
    if (
      !(
        options.kept === true &&
        (error as NodeJS.ErrnoException).code === "EEXIST"
      )
    ) {
      throw error;
    }
  } finally {
    await rm(temporary, { force: true });
  }
}

/** Remove the marker at `path` where it is `record`'s, and leave anyone else's. */
async function removeMarker(
  path: string,
  record: SaveInProgress
): Promise<void> {
  let standing: unknown;
  try {
    standing = JSON.parse(await readFile(path, "utf-8"));
  } catch (error) {
    // No marker there: none was placed, or its folder could not be made (a file in its way).
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return;
    throw error;
  }
  if ((standing as { id?: unknown } | null)?.id === record.id) {
    await rm(path, { force: true });
  }
}

/**
 * Clear each of `made`, the row and then the marker: a marker left with no row behind it is one
 * the next start removes, while a row left without its marker would go unseen by the commands
 * that read only markers.
 */
async function clearRecords(
  made: readonly MadeRecord[],
  logger: { warn(message: string): void }
): Promise<void> {
  for (const { adapter, projectRoot, record } of made) {
    try {
      await new MetaService(adapter, consoleLogger).delete(
        saveInProgressKey(record.kind, record.slug)
      );
      await removeMarker(markerPath(projectRoot, record), record);
    } catch (error) {
      logger.warn(
        `The save of ${record.kind} "${record.slug}" ended, but its record that it was in progress could not be cleared (${error instanceof Error ? error.message : String(error)}). ${clearByHand(projectRoot, record)}`
      );
    }
  }
}

/**
 * The way out of a record left by a save that ended, which nothing clears by itself yet: the row
 * and the marker, removed by hand once the save is known to have finished.
 */
function clearByHand(projectRoot: string, record: SaveInProgress): string {
  return `Once you have checked that the save finished and no Builder save is running, remove the row "${saveInProgressKey(record.kind, record.slug)}" from the nextly_meta table and the file ${relative(projectRoot, markerPath(projectRoot, record))}.`;
}

/** A marker as read: the record, or why it could not be read. */
type ReadMarker =
  | { file: string; record: SaveInProgress }
  | { file: string; unreadable: string };

/** The project's markers, each read, in file-name order. */
async function readSaveMarkers(projectRoot: string): Promise<ReadMarker[]> {
  const folder = saveInProgressFolder(projectRoot);
  let names: string[];
  try {
    names = (await readdir(folder))
      .filter(name => name.endsWith(".json"))
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const read: ReadMarker[] = [];
  for (const name of names) {
    const file = join(folder, name);
    try {
      const parsed = savedRecord.safeParse(
        JSON.parse(await readFile(file, "utf-8"))
      );
      read.push(
        parsed.success
          ? { file, record: parsed.data }
          : { file, unreadable: "it is not a save's record" }
      );
    } catch (error) {
      read.push({
        file,
        unreadable: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return read;
}

/** How a record names its save, in a refusal or a notice. */
function described(record: SaveInProgress): string {
  const kind = record.kind === "fieldGroup" ? "field group" : record.kind;
  return `a Builder save of the ${kind} "${record.slug}", started ${record.startedAt} on ${record.host}`;
}

/**
 * The way out of an unreadable record, which nothing settles yet: the one row, removed by hand once
 * no save is running, after which the next save starts its own record.
 */
function unreadableRecordStep(key: string): string {
  return `To clear it, first check that no Builder save is running, then remove the one row "${key}" from the nextly_meta table; the next save then records its own.`;
}

const SETTLES =
  "start the app in development (`next dev`) on this project: its start settles the save";

/**
 * Refuse while the project's markers record a save left part-way on this host against this
 * database, for the commands that connect to none (`migrate:check`, `migrate:create`): what they
 * would write or check from is not what the database holds. A marker from another host or another
 * database (a committed `.nextly/`, CI, a teammate) does not refuse: `notice` is given one line for
 * it. A marker that cannot be read refuses, since whose it is cannot be told.
 *
 * @throws NextlyError `CONFLICT` naming each save and the one step that settles it
 */
export async function refuseWhileSaveLeftPartWay(args: {
  projectRoot: string;
  /** The URL the command would reach; `DATABASE_URL` where not given. */
  databaseUrl?: string;
  /** `db.postgres.schema`, which the URL does not carry. */
  postgresSchema?: string;
  notice(line: string): void;
}): Promise<void> {
  const here = hostname();
  const database = databaseIdentity(args.databaseUrl, args.postgresSchema);
  const left: string[] = [];
  for (const marker of await readSaveMarkers(args.projectRoot)) {
    if ("unreadable" in marker) {
      left.push(
        `${relative(args.projectRoot, marker.file)}, which could not be read`
      );
      continue;
    }
    const { record } = marker;
    // Every marker of this host and database refuses, each named with its file: two for one entity
    // (a stopped save whose row was lost, then another) are both named, never one picked. A marker
    // whose database could not be told (an adapter handed in) is taken as this one's: it refuses.
    if (
      record.host === here &&
      (record.database === database || record.database === UNKNOWN_DATABASE)
    ) {
      left.push(
        `${described(record)} (${relative(args.projectRoot, marker.file)})`
      );
    } else {
      args.notice(
        `${described(record)} is recorded in .nextly/ as left part-way; it is settled by a development start on that machine.`
      );
    }
  }
  if (left.length === 0) return;
  throw NextlyError.conflict({
    reason: "state",
    message: `A Builder save was left part-way, so the project's migrations do not describe the database yet: ${left.join("; ")}. To settle it, ${SETTLES}.`,
    logContext: { reason: "builder-save-left-part-way", saves: left },
  });
}

/** The `nextly_meta` select this module reads records through, as far as it goes. */
interface RecordRows {
  select(fields: Record<string, unknown>): {
    from(table: unknown): {
      where(
        condition: SQL
      ): PromiseLike<Array<{ key: string; value: unknown }>>;
    };
  };
}

/**
 * The records the database holds, in one select over their keys. Each value is the JSON text
 * `MetaService` stores, which MySQL's driver hands back as a string and the others as stored.
 */
export async function readSavesInProgress(
  adapter: DrizzleAdapter
): Promise<ReadRow[]> {
  const table = loadedDialect(adapter.getCapabilities().dialect).tables
    .nextlyMeta;
  const rows = await adapter
    .getDrizzle<RecordRows>()
    .select({ key: table.key, value: table.value })
    .from(table)
    .where(like(table.key, `${KEY_PREFIX}%`));
  return rows.map(({ key, value }) => {
    try {
      const parsed = savedRecord.safeParse(
        typeof value === "string" ? JSON.parse(value) : value
      );
      return parsed.success
        ? { key, record: parsed.data }
        : { key, unreadable: "it is not a save's record" };
    } catch (error) {
      return {
        key,
        unreadable: error instanceof Error ? error.message : String(error),
      };
    }
  });
}

/** A record's row as read: the record, or why it could not be read, by its key. */
export type ReadRow =
  | { key: string; record: SaveInProgress }
  | { key: string; unreadable: string };

/**
 * Refuse while the database records a Builder save left part-way, for `nextly migrate`, which
 * would apply files beside a change no file finished recording.
 *
 * @throws NextlyError `CONFLICT` naming each save and the one step that settles it
 */
export async function refuseWhileSaveInProgress(
  adapter: DrizzleAdapter
): Promise<void> {
  const rows = await readSavesInProgress(adapter);
  if (rows.length === 0) return;
  // A row that cannot be read still stands for a save: it refuses, named by its key.
  const named = rows.map(row =>
    "record" in row
      ? described(row.record)
      : `the record ${row.key}, which could not be read (${unreadableRecordStep(row.key)})`
  );
  throw NextlyError.conflict({
    reason: "state",
    message: `A Builder save was left part-way, so the database does not match its migrations yet: ${named.join("; ")}. To settle it, ${SETTLES}.`,
    logContext: {
      reason: "builder-save-left-part-way",
      saves: rows.map(row => row.key),
    },
  });
}

/**
 * Clear a record a settle has settled: its row, only while it is still this record (a save that
 * started since made its own), then its marker, only where it is this record's.
 */
export async function clearSettledSave(
  adapter: DrizzleAdapter,
  projectRoot: string,
  record: LeftSave
): Promise<void> {
  const meta = new MetaService(adapter, consoleLogger);
  const key = saveInProgressKey(record.kind, record.slug);
  const standing = savedRecord.safeParse(await meta.get<unknown>(key));
  if (standing.success && standing.data.id === record.id) {
    await meta.delete(key);
  }
  await removeMarker(markerPath(projectRoot, record), record);
}

/**
 * Remove each marker of this host and `database` that no row stands behind: one left where a save's
 * row was cleared and its marker was not, which the commands with no database would otherwise
 * refuse over for good. A marker of another host or database, or one that cannot be read, stays.
 */
export async function removeStaleMarkers(args: {
  adapter: DrizzleAdapter;
  projectRoot: string;
  /** This process's database (`savedDatabase`). */
  database: string | undefined;
}): Promise<string[]> {
  const here = hostname();
  const rows = await readSavesInProgress(args.adapter);
  const standing = new Set(
    rows.flatMap(row => ("record" in row ? [row.record.id] : []))
  );
  // A row that cannot be read still stands for its entity's save: that entity's markers stay.
  const unreadable = new Set(
    rows.flatMap(row => ("record" in row ? [] : [row.key]))
  );
  const removed: string[] = [];
  for (const marker of await readSaveMarkers(args.projectRoot)) {
    if ("unreadable" in marker) continue;
    const { record } = marker;
    if (record.host !== here) continue;
    if (
      args.database !== undefined &&
      record.database !== args.database &&
      record.database !== UNKNOWN_DATABASE
    ) {
      continue;
    }
    if (standing.has(record.id)) continue;
    if (unreadable.has(saveInProgressKey(record.kind, record.slug))) continue;
    await removeMarker(marker.file, record);
    removed.push(relative(args.projectRoot, marker.file));
  }
  return removed;
}
