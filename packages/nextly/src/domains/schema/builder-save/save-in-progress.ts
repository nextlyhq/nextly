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
import { createHash, randomUUID } from "node:crypto";
import {
  link,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { hostname } from "node:os";
import { dirname, join, relative } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { like, type SQL } from "drizzle-orm";

import { loadedDialect } from "../../../database/dialect-tables";
import { NextlyError } from "../../../errors/nextly-error";
import type { AddressKind } from "../../../shared/address-rule";
import { consoleLogger } from "../../../shared/types";
import { MetaService } from "../../meta/services/meta-service";

/** The kinds of entity a Builder save writes. */
export type SaveInProgressKind = AddressKind;

/** One save's record that it has started. */
export interface SaveInProgress {
  /** Tells this save's record from another's for the same entity. */
  id: string;
  kind: SaveInProgressKind;
  slug: string;
  /** When the save started, as an ISO timestamp. */
  startedAt: string;
  /** The host the save ran on. */
  host: string;
  /** The database it wrote to, as `databaseIdentity` names it. */
  database: string;
  /** The definition file, relative to the project root. */
  definitionFile: string;
  /** The definition file's text before the save; null where there was none. */
  definitionBefore: string | null;
}

const KEY_PREFIX = "builder-save-in-progress:";

/** The `nextly_meta` key an entity's record is kept under. */
export function saveInProgressKey(
  kind: SaveInProgressKind,
  slug: string
): string {
  return `${KEY_PREFIX}${kind}:${slug}`;
}

/** The folder of the project's markers. */
export function saveInProgressFolder(projectRoot: string): string {
  return join(projectRoot, ".nextly", "save-in-progress");
}

/** The marker file an entity's record is kept in. */
function markerPath(
  projectRoot: string,
  kind: SaveInProgressKind,
  slug: string
): string {
  return join(saveInProgressFolder(projectRoot), `${kind}-${slug}.json`);
}

/**
 * The database `url` reaches, named by a hash of its host, port and database name (a SQLite
 * file's path): the same database gives the same name on every machine, and no user name or
 * password goes into it. `url` defaults to `DATABASE_URL`, which the app and the CLI both connect
 * with.
 */
export function databaseIdentity(
  url: string | undefined = process.env.DATABASE_URL
): string {
  let where = url ?? "";
  try {
    const parsed = new URL(where);
    where = `${parsed.hostname}:${parsed.port}${parsed.pathname}`;
  } catch {
    // Not a URL (a bare SQLite path): hashed as it is, so nothing of it is kept either way.
  }
  return createHash("sha256").update(where).digest("hex").slice(0, 32);
}

/**
 * A record a scope made, and what its save said of how it ended: `withdrawn` where it failed and
 * removed everything it wrote, `left` where it kept part of itself with nothing recording what.
 */
interface MadeRecord {
  adapter: DrizzleAdapter;
  projectRoot: string;
  record: SaveInProgress;
  ending: "open" | "withdrawn" | "left";
}

/** What a writer tells its record of how the save ended. */
export interface StartedSave {
  /** The save failed and withdrew everything it wrote: its record clears with the scope. */
  withdrawn(): void;
  /** Part of the save was kept and nothing records what: its record stays. */
  left(): void;
}

/** For a save that made no record of its own (one already stood for the entity). */
const NO_RECORD: StartedSave = {
  withdrawn: () => undefined,
  left: () => undefined,
};

const scopes = new AsyncLocalStorage<MadeRecord[]>();

/** The records of `made` an ending clears: a save that ended, or one that withdrew everything. */
function clearedBy(made: readonly MadeRecord[], ended: boolean): MadeRecord[] {
  return made.filter(({ ending }) =>
    ended ? ending !== "left" : ending === "withdrawn"
  );
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
    await clearRecords(clearedBy(made, ended), logger);
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
    end: ended => clearRecords(clearedBy(made, ended), logger),
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
    database: databaseIdentity(),
    definitionFile: relative(args.projectRoot, args.definitionFile),
    definitionBefore: args.definitionBefore ?? null,
  };
  const meta = new MetaService(args.adapter, consoleLogger);
  const key = saveInProgressKey(args.kind, args.slug);
  await meta.insertIfAbsent(key, record);
  // Read back, since the insert does not say whether it wrote: a record that stood already is kept.
  const standing = await meta.get<SaveInProgress>(key);
  if (standing?.id !== record.id) return NO_RECORD;
  const entry: MadeRecord = {
    adapter: args.adapter,
    projectRoot: args.projectRoot,
    record,
    ending: "open",
  };
  made.push(entry);
  await placeMarker(markerPath(args.projectRoot, args.kind, args.slug), record);
  return {
    withdrawn: () => {
      if (entry.ending === "open") entry.ending = "withdrawn";
    },
    left: () => {
      entry.ending = "left";
    },
  };
}

/**
 * Put `record` at `path` whole and only where no marker is there: written aside, then linked into
 * place, which refuses a path that exists, so a reader never sees half a marker and one already
 * there is never replaced.
 */
async function placeMarker(
  path: string,
  record: SaveInProgress
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
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
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
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
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
      await removeMarker(
        markerPath(projectRoot, record.kind, record.slug),
        record
      );
    } catch (error) {
      logger.warn(
        `The record that the save of ${record.kind} "${record.slug}" was in progress could not be cleared (${error instanceof Error ? error.message : String(error)}); the next development start settles it.`
      );
    }
  }
}

/** A marker as read: the record, or why it could not be read. */
export type ReadMarker =
  | { file: string; record: SaveInProgress }
  | { file: string; unreadable: string };

/** The project's markers, each read, in file-name order. */
export async function readSaveMarkers(
  projectRoot: string
): Promise<ReadMarker[]> {
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
      read.push({
        file,
        record: JSON.parse(await readFile(file, "utf-8")) as SaveInProgress,
      });
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
  notice(line: string): void;
}): Promise<void> {
  const here = hostname();
  const database = databaseIdentity(args.databaseUrl);
  const left: string[] = [];
  for (const marker of await readSaveMarkers(args.projectRoot)) {
    if ("unreadable" in marker) {
      left.push(
        `${relative(args.projectRoot, marker.file)}, which could not be read`
      );
      continue;
    }
    const { record } = marker;
    if (record.host === here && record.database === database) {
      left.push(described(record));
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
      where(condition: SQL): PromiseLike<Array<{ value: unknown }>>;
    };
  };
}

/**
 * The records the database holds, in one select over their keys. Each value is the JSON text
 * `MetaService` stores, which MySQL's driver hands back as a string and the others as stored.
 */
export async function readSavesInProgress(
  adapter: DrizzleAdapter
): Promise<SaveInProgress[]> {
  const table = loadedDialect(adapter.getCapabilities().dialect).tables
    .nextlyMeta;
  const rows = await adapter
    .getDrizzle()
    .select({ value: table.value })
    .from(table)
    .where(like(table.key, `${KEY_PREFIX}%`));
  return rows.map(
    ({ value }) =>
      (typeof value === "string" ? JSON.parse(value) : value) as SaveInProgress
  );
}

/**
 * Refuse while the database records a Builder save left part-way, for `nextly migrate`, which
 * would apply files beside a change no file finished recording.
 *
 * @throws NextlyError `CONFLICT` naming each save and the one step that settles it
 */
export async function refuseWhileSaveInProgress(
  adapter: DrizzleAdapter
): Promise<void> {
  const records = await readSavesInProgress(adapter);
  if (records.length === 0) return;
  throw NextlyError.conflict({
    reason: "state",
    message: `A Builder save was left part-way, so the database does not match its migrations yet: ${records.map(described).join("; ")}. To settle it, ${SETTLES}.`,
    logContext: {
      reason: "builder-save-left-part-way",
      saves: records.map(record => saveInProgressKey(record.kind, record.slug)),
    },
  });
}
