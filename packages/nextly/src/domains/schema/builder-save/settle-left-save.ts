/**
 * Settling a Builder save the process left part-way, from what the database and the migration
 * folder hold.
 *
 * A save records that it has started (`save-in-progress`) before its first write and clears the
 * record once it ends. A record that stands at the next development start or Builder save is a save
 * whose process stopped. This step judges how far it got and finishes what is left to the ordinary
 * machinery, running no schema statement of its own:
 *
 * - **none** of it landed: no file of the save is recorded applied and the save's tables stand as
 *   the snapshot it started from. Its files and their snapshots go and the definition is put back.
 * - **all** of it landed: every file is recorded applied, or the ones that are not stand applied in
 *   the live tables. The rest are recorded applied, and the definition and the registry row are
 *   brought to the saved shape.
 * - **pending**: some files are recorded, the rest never ran (a save whose files each run in a
 *   transaction of their own, stopped between two of them). The files and the saved definition
 *   stay: they are ordinary pending migrations, which the development start's next step, or
 *   `nextly migrate`, runs through the normal runner. A Builder save cannot run them, so it is
 *   refused until a start has.
 * - **left**: the tables stand at neither end (a MySQL save stopped inside a file, whose schema
 *   statements committed one by one). The record stays, refusing as it does, until that state can
 *   be settled from what landed.
 *
 * Only records of this host are settled: the files they name are in this project's folder. A
 * record that cannot be read is left as it is, refusing with the step that clears it by hand.
 *
 * @module domains/schema/builder-save/settle-left-save
 */
import { readdir, readFile, rm } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { NextlyError } from "../../../errors/nextly-error";
import { parseUiSchema } from "../../../schemas/_zod/ui-schema";
import type { AddressKind } from "../../../shared/address-rule";
import { unresolvedAttempts } from "../events/migration-state";
import { SchemaEventsRepository } from "../events/schema-events-repository";
import {
  recordAlreadyApplied,
  snapshotsEquivalent,
} from "../migrate/drift-reconcile";
import { splitSqlStatements } from "../migrate/split-sql";
import { parseSqlSections } from "../migrate/sql-sections";
import { tablesChangedIn } from "../migrate/statement-targets";
import { parseEntityHeaders } from "../migrate-create/entity-headers";
import { formatTimestamp } from "../migrate-create/format-file";
import {
  EMPTY_SNAPSHOT,
  parseSnapshotFile,
  snapshotPathOf,
} from "../migrate-create/snapshot-io";
import { introspectLiveSnapshot } from "../pipeline/diff/introspect-live";
import type { NextlySchemaSnapshot } from "../pipeline/diff/types";
import { uiToMinimal } from "../ui-schema/merge";

import {
  saveKindOf,
  settleRemovedFileAttempts,
  writeAtomically,
} from "./collection-save";
import {
  clearSettledSave,
  readSavesInProgress,
  removeStaleMarkers,
  type LeftSave,
} from "./save-in-progress";

/** How a left save was settled. */
export type SettledOutcome = "none" | "all" | "pending" | "left";

/** One left save, and how it was settled. */
export interface SettledSave {
  kind: AddressKind;
  slug: string;
  outcome: SettledOutcome;
  /** What the settle could not do, to say to whoever is told: a definition edited since, say. */
  notes: string[];
}

/** What the settle works with. */
export interface SettleDeps {
  adapter: DrizzleAdapter;
  /** The project root, which a record names its definition file from. */
  projectRoot: string;
  migrationsDir: string;
  /** This process's database (`savedDatabase`), whose stale markers are removed. */
  database?: string | undefined;
  logger: {
    info(message: string): void;
    warn(message: string): void;
  };
  /**
   * The registry row's write for a Single or a field group whose save landed whole: its fields and
   * whether it is translated, as the saved definition holds them. A collection's waits on its own
   * service, and its record stays (`settleLeftSave`).
   */
  /**
   * Keep the record of a save left "pending" rather than clear it: at a Builder save, which cannot
   * run the save's remaining files and is refused until a start has.
   */
  keepPending?: boolean;
  writeRegistry(entity: {
    kind: "single" | "fieldGroup";
    slug: string;
    /** The entity as the saved definition holds it; null where the save deleted it. */
    saved: SavedEntity | null;
  }): Promise<void>;
}

/** An entity as a definition file holds it. */
export interface SavedEntity {
  fields: unknown[];
  localized?: boolean;
  tableName?: string;
}

/**
 * Settle every record of this host the database holds, in turn. A record whose settle throws is
 * left, logged, and the rest go on: what one record holds says nothing of another.
 */
export async function settleLeftSaves(
  deps: SettleDeps
): Promise<SettledSave[]> {
  const settled: SettledSave[] = [];
  // A database that has no meta table yet (a project's first start) holds no record.
  if (!(await deps.adapter.tableExists("nextly_meta"))) return settled;
  const here = hostname();
  for (const row of await readSavesInProgress(deps.adapter)) {
    // An unreadable record names no save to judge: it refuses as it is, with its hand step.
    if (!("record" in row)) continue;
    // Another machine's save wrote its files there, not here: its own start settles it.
    if (row.record.host !== here) continue;
    try {
      settled.push(await settleLeftSave(deps, row.record));
    } catch (error) {
      deps.logger.warn(
        `A Builder save of the ${described(row.record)} was left part-way, and settling it failed (${error instanceof Error ? error.message : String(error)}). Its record stays, and the next development start tries again.`
      );
    }
  }
  const stale = await removeStaleMarkers({
    adapter: deps.adapter,
    projectRoot: deps.projectRoot,
    database: deps.database,
  });
  for (const file of stale) {
    deps.logger.info(
      `Removed ${file}: it recorded a Builder save no database row stands behind.`
    );
  }
  return settled;
}

/**
 * Settle the left saves before a Builder save, inside its schema-change exclusion, with the schema
 * lock and the project's migration files held. A save left "pending" refuses this one: its
 * remaining files have to run first, which a development start does.
 */
export async function settleBeforeBuilderSave(
  adapter: DrizzleAdapter,
  migrationsDir: string,
  logger: SettleDeps["logger"]
): Promise<void> {
  // Loaded on demand, as the exclusion loads the writer hold: this runs only where a save writes.
  const [{ container }, { settleRegistryWriter }] = await Promise.all([
    import("../../../di/container"),
    import("./settle-registry"),
  ]);
  if (!container.has("builderSaveSetup")) return;
  const setup = container.get<{ projectRoot: string; database: string }>(
    "builderSaveSetup"
  );
  const settled = await settleLeftSaves({
    adapter,
    projectRoot: setup.projectRoot,
    migrationsDir,
    database: setup.database,
    logger,
    keepPending: true,
    writeRegistry: settleRegistryWriter(adapter),
  });
  const pending = settled.filter(s => s.outcome === "pending");
  if (pending.length > 0) throw pendingSaveRefusal(pending);
}

/** The refusal for a Builder save while a left save's remaining files are still to be run. */
function pendingSaveRefusal(saves: readonly SettledSave[]): NextlyError {
  return NextlyError.conflict({
    reason: "state",
    message: `An earlier Builder save stopped between its migration files (${saves.map(s => `${kindName(s.kind)} "${s.slug}"`).join(", ")}), and the rest of them have not run yet. Start the app in development (\`next dev\`): its start finishes the previous save. Then save again.`,
    logContext: {
      reason: "builder-save-pending-files",
      saves: saves.map(s => `${s.kind}:${s.slug}`),
    },
  });
}

/**
 * Settle one record: judge how far its save got (`judge`), then do what that outcome asks. Every
 * step reads before it writes, so a settle that stops is done again by the next one, and nothing
 * runs twice.
 */
async function settleLeftSave(
  deps: SettleDeps,
  record: LeftSave
): Promise<SettledSave> {
  const dialect = deps.adapter.getCapabilities().dialect;
  const repo = new SchemaEventsRepository(deps.adapter.getDrizzle(), dialect);
  const files = await filesOfSave(deps, record);
  const judged = await judge(deps, repo, record, files);
  const notes: string[] = [];
  const result = (outcome: SettledOutcome): SettledSave => ({
    kind: record.kind,
    slug: record.slug,
    outcome,
    notes,
  });

  if (judged === "left") {
    // A MySQL save stopped inside a file: what landed is settled from the live tables by the
    // step for a stopped save, which this one does not run yet. The record stays, refusing.
    deps.logger.warn(
      `A Builder save of the ${described(record)} stopped part-way through a migration file, with part of it applied. It is not settled here yet; its record stays.`
    );
    return result("left");
  }

  if (judged === "none") {
    for (const filename of files) {
      // A failed attempt a file left in the ledger is cleared as the save's own withdrawal does.
      await settleRemovedFileAttempts(deps.adapter, repo, filename);
      await rm(join(deps.migrationsDir, filename), { force: true });
      await rm(
        snapshotPathOf(join(deps.migrationsDir, "meta"), baseName(filename)),
        { force: true }
      );
    }
    notes.push(...(await putDefinitionBack(deps, record)));
    await clearSettledSave(deps.adapter, deps.projectRoot, record);
    deps.logger.info(
      `Settled a Builder save of the ${described(record)} that stopped before any of it applied: its files are removed and the definition put back.`
    );
    return result("none");
  }

  // "all" or "pending": the saved definition stands, which its files are written from.
  notes.push(...(await keepSavedDefinition(deps, record)));

  if (judged === "pending") {
    if (deps.keepPending === true) return result("pending");
    await clearSettledSave(deps.adapter, deps.projectRoot, record);
    deps.logger.info(
      `A Builder save of the ${described(record)} stopped between its migration files: the rest are pending, and run as any pending migration.`
    );
    return result("pending");
  }

  for (const filename of files) {
    if (!(await repo.isFileApplied(filename))) {
      await recordAlreadyApplied({ filename }, repo);
    }
  }
  if (record.kind === "collection") {
    // A collection's registry row is written by its own service, which this step cannot reach
    // yet: its files are recorded, and its record stays until the row can be written.
    deps.logger.warn(
      `A Builder save of the ${described(record)} applied whole before it stopped, and its files are now recorded applied, but its registry row cannot be brought up here yet. Its record stays.`
    );
    notes.push("the collection's registry row is not brought up yet");
    return result("all");
  }
  await deps.writeRegistry({
    kind: record.kind,
    slug: record.slug,
    saved: savedEntity(record.definitionAfter, record.kind, record.slug),
  });
  await clearSettledSave(deps.adapter, deps.projectRoot, record);
  deps.logger.info(
    `Settled a Builder save of the ${described(record)} that applied whole before it stopped: its files are recorded applied and its registry row brought up.`
  );
  return result("all");
}

/**
 * How far the save got:
 *
 * - `none`: no file is recorded applied and the save's tables stand as its starting snapshot;
 * - `all`: every file is recorded, or the unrecorded ones stand applied in the live tables (each
 *   with a snapshot of its own to judge it by);
 * - `pending`: some files are recorded and none of the rest started (an attempt left in the ledger
 *   is a file that started);
 * - `left`: anything else, the tables at neither end, or a file whose attempt stopped part-way on
 *   a database that commits schema statements one by one.
 */
async function judge(
  deps: SettleDeps,
  repo: SchemaEventsRepository,
  record: LeftSave,
  files: readonly string[]
): Promise<"none" | "all" | "pending" | "left"> {
  const ledger = await ledgerOf(repo, files);
  const unrecorded = files.filter(f => !ledger.recorded.includes(f));
  return decide({
    recorded: ledger.recorded.length,
    unrecorded: unrecorded.length,
    started: ledger.started.length,
    // On MySQL a file stopped inside its statements kept what it ran; elsewhere it ran in a
    // transaction, which the stop rolled back.
    stoppedInside:
      deps.adapter.getCapabilities().dialect === "mysql" &&
      ledger.started.length > 0,
    ...(await whereTablesStand(deps, record, files)),
    unrecordedHaveSnapshots: await everyHasSnapshot(deps, unrecorded),
  });
}

/** The outcome, from the facts `judge` gathered. */
function decide(facts: {
  recorded: number;
  unrecorded: number;
  started: number;
  stoppedInside: boolean;
  atBefore: boolean;
  atTarget: boolean;
  unrecordedHaveSnapshots: boolean;
}): "none" | "all" | "pending" | "left" {
  if (facts.recorded === 0 && !facts.stoppedInside && facts.atBefore) {
    return "none";
  }
  if (facts.unrecorded === 0) return "all";
  // An unrecorded file is taken as landed only where the live tables say so: one with a snapshot
  // of its own. A companion file has none, so it is judged by whether it ran.
  if (facts.started === 0 && facts.atTarget && facts.unrecordedHaveSnapshots) {
    return "all";
  }
  // Some files ran and were recorded, and none of the rest started: on a database that runs a file
  // and records it together, those are files that never ran. The tables need not stand at the
  // target: a translation turned on leaves its main column for its translations file to move.
  if (facts.recorded > 0 && facts.started === 0) return "pending";
  return "left";
}

/** Which of `files` the ledger records applied, and which have an attempt still unresolved. */
async function ledgerOf(
  repo: SchemaEventsRepository,
  files: readonly string[]
): Promise<{ recorded: string[]; started: string[] }> {
  const recorded: string[] = [];
  const started: string[] = [];
  for (const filename of files) {
    if (await repo.isFileApplied(filename)) recorded.push(filename);
    else if (
      unresolvedAttempts(filename, await repo.findFileApplies(filename))
        .length > 0
    ) {
      started.push(filename);
    }
  }
  return { recorded, started };
}

/**
 * Whether the tables the save changes stand as the snapshot it started from, or as the newest of
 * its files says: only the tables the two hold differently are read.
 */
async function whereTablesStand(
  deps: SettleDeps,
  record: LeftSave,
  files: readonly string[]
): Promise<{ atBefore: boolean; atTarget: boolean }> {
  const before = await snapshotNamed(deps, record.startedFrom ?? null);
  const target = await newestSnapshotOf(deps, files);
  const tables = changedTables(before, target ?? before);
  const live =
    tables.length === 0
      ? { tables: [] }
      : await introspectLiveSnapshot(
          deps.adapter.getDrizzle(),
          deps.adapter.getCapabilities().dialect,
          tables
        );
  return {
    atBefore: snapshotsEquivalent(only(before, tables), live),
    atTarget:
      target !== undefined && snapshotsEquivalent(only(target, tables), live),
  };
}

/**
 * The save's files: those its record names, and any the folder holds that it wrote after the
 * record last learned a name. Such a file has no ledger row, is named for a moment at or after the
 * save started, and either names the entity in its header or changes one of its tables (a delete's
 * file cannot name an entity the definition no longer holds).
 */
async function filesOfSave(
  deps: SettleDeps,
  record: LeftSave
): Promise<string[]> {
  const named = new Set(record.files ?? []);
  const present = await sqlFilesIn(deps.migrationsDir);
  const isOfSave = laterFileOfSave(deps, record);
  for (const name of present) {
    if (!named.has(name) && (await isOfSave(name))) named.add(name);
  }
  // Only the files still there: one a settle already removed is not judged again.
  return [...named].filter(n => present.includes(n)).sort();
}

/** The migration files in `dir`, in name order; none where it is absent. */
async function sqlFilesIn(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).filter(n => n.endsWith(".sql")).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

/**
 * Whether a file the record does not name is the save's all the same: written after the record
 * last learned a name, with no ledger row, named for a moment at or after the save started, and
 * naming the entity or changing its tables.
 */
function laterFileOfSave(
  deps: SettleDeps,
  record: LeftSave
): (name: string) => Promise<boolean> {
  const dialect = deps.adapter.getCapabilities().dialect;
  const repo = new SchemaEventsRepository(deps.adapter.getDrizzle(), dialect);
  const since = sinceStamp(record.startedAt);
  const tables = entityTables(record);
  return async name => {
    if (since === undefined || name.slice(0, since.length) < since) {
      return false;
    }
    if (await repo.isFileApplied(name)) return false;
    const content = await readFile(join(deps.migrationsDir, name), "utf-8");
    return namesEntity(content, record) || touches(content, tables, dialect);
  };
}

/** Whether a file's header names the record's entity. */
function namesEntity(content: string, record: LeftSave): boolean {
  const headers = parseEntityHeaders(content);
  const list =
    record.kind === "collection"
      ? headers.collections
      : record.kind === "single"
        ? headers.singles
        : headers.components;
  return list.includes(record.slug);
}

/** Whether a file's UP changes one of `tables`, or a table named from one of them. */
function touches(
  content: string,
  tables: readonly string[],
  dialect: ReturnType<DrizzleAdapter["getCapabilities"]>["dialect"]
): boolean {
  if (tables.length === 0) return false;
  const { upSql } = parseSqlSections(content);
  return splitSqlStatements(upSql, dialect).some(statement =>
    (tablesChangedIn(statement, dialect) ?? []).some(changed =>
      tables.some(t => changed === t || changed.startsWith(`${t}_`))
    )
  );
}

/** The entity's main table, from the definition before the save or after it. */
function entityTables(record: LeftSave): string[] {
  const { prefix } = saveKindOf(record.kind);
  for (const text of [record.definitionAfter, record.definitionBefore]) {
    const entity = rawEntity(text ?? null, record.kind, record.slug);
    if (entity === null) continue;
    try {
      return [uiToMinimal(entity as never, prefix).tableName];
    } catch {
      // An entity the merge cannot read names no table; the header test still applies.
    }
  }
  return [];
}

/** The entity of `kind` `slug` in a definition's text, as written; null where absent. */
function rawEntity(
  text: string | null,
  kind: AddressKind,
  slug: string
): Record<string, unknown> | null {
  if (text === null) return null;
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  const parsed = parseUiSchema(json);
  if (!parsed.success) return null;
  const list = (parsed.data as Record<string, unknown>)[
    saveKindOf(kind).manifest
  ];
  if (!Array.isArray(list)) return null;
  const found = list.find(
    (e: unknown) => (e as { slug?: unknown }).slug === slug
  );
  return (found as Record<string, unknown> | undefined) ?? null;
}

/** The entity as the saved definition holds it, for its registry row. */
function savedEntity(
  text: string | undefined,
  kind: AddressKind,
  slug: string
): SavedEntity | null {
  const entity = rawEntity(text ?? null, kind, slug);
  if (entity === null) return null;
  return {
    fields: Array.isArray(entity.fields) ? entity.fields : [],
    ...(typeof entity.localized === "boolean"
      ? { localized: entity.localized }
      : {}),
  };
}

/**
 * Put the definition back as it was before the save, where it is still what the save wrote. One
 * that is already as it was is left. One edited since, or whose saved text the record does not
 * keep, is left as it is, and named.
 */
async function putDefinitionBack(
  deps: SettleDeps,
  record: LeftSave
): Promise<string[]> {
  const path = join(deps.projectRoot, record.definitionFile);
  const current = await readIfPresent(path);
  if (current === (record.definitionBefore ?? undefined)) return [];
  if (
    record.definitionAfter !== undefined &&
    current === record.definitionAfter
  ) {
    if (record.definitionBefore === null) await rm(path, { force: true });
    else await writeAtomically(path, record.definitionBefore);
    return [];
  }
  const note = `${record.definitionFile} was not put back: it changed after the save of the ${described(record)} started, so it is left as it is`;
  deps.logger.warn(`${note}.`);
  return [note];
}

/**
 * Keep the saved definition: where the file is what the save wrote, nothing to do. Anything else
 * is left as it is, and named: the files are written from the saved shape, so a difference is the
 * person's to settle.
 */
async function keepSavedDefinition(
  deps: SettleDeps,
  record: LeftSave
): Promise<string[]> {
  const path = join(deps.projectRoot, record.definitionFile);
  const current = await readIfPresent(path);
  if (
    record.definitionAfter !== undefined &&
    current === record.definitionAfter
  ) {
    return [];
  }
  const note = `${record.definitionFile} is not the definition the save of the ${described(record)} wrote, so it is left as it is; its migration files are written from the saved one`;
  deps.logger.warn(`${note}.`);
  return [note];
}

async function readIfPresent(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/** The snapshot of the file named `name` (its base name), or the empty one where there is none. */
async function snapshotNamed(
  deps: SettleDeps,
  name: string | null
): Promise<NextlySchemaSnapshot> {
  if (name === null) return EMPTY_SNAPSHOT;
  const path = join(deps.migrationsDir, "meta", name);
  return parseSnapshotFile(await readFile(path, "utf-8"), name).snapshot;
}

/** The snapshot of the newest of `files` that has one; undefined where none does. */
async function newestSnapshotOf(
  deps: SettleDeps,
  files: readonly string[]
): Promise<NextlySchemaSnapshot | undefined> {
  for (const filename of [...files].reverse()) {
    const path = snapshotPathOf(
      join(deps.migrationsDir, "meta"),
      baseName(filename)
    );
    const text = await readIfPresent(path);
    if (text !== undefined) return parseSnapshotFile(text, path).snapshot;
  }
  return undefined;
}

async function everyHasSnapshot(
  deps: SettleDeps,
  files: readonly string[]
): Promise<boolean> {
  for (const filename of files) {
    const path = snapshotPathOf(
      join(deps.migrationsDir, "meta"),
      baseName(filename)
    );
    if ((await readIfPresent(path)) === undefined) return false;
  }
  return true;
}

/** The tables one snapshot holds differently from the other, or holds and the other does not. */
function changedTables(
  a: NextlySchemaSnapshot,
  b: NextlySchemaSnapshot
): string[] {
  const names = new Set([
    ...a.tables.map(t => t.name),
    ...b.tables.map(t => t.name),
  ]);
  return [...names].filter(
    name => !snapshotsEquivalent(only(a, [name]), only(b, [name]))
  );
}

function only(
  snapshot: NextlySchemaSnapshot,
  tables: readonly string[]
): NextlySchemaSnapshot {
  return {
    ...snapshot,
    tables: snapshot.tables.filter(t => tables.includes(t.name)),
  };
}

function baseName(filename: string): string {
  return filename.replace(/\.sql$/, "");
}

/**
 * The earliest name a file of the save can have: the moment it started, as migration files are
 * named (`formatTimestamp`), less a second, since a file that must run before the save's main one
 * (a translation turned off) is named a few milliseconds before it.
 */
function sinceStamp(startedAt: string): string | undefined {
  const at = new Date(startedAt).getTime();
  if (Number.isNaN(at)) return undefined;
  return formatTimestamp(new Date(at - 1000));
}

function kindName(kind: AddressKind): string {
  return kind === "fieldGroup" ? "field group" : kind;
}

function described(record: LeftSave): string {
  return `${kindName(record.kind)} "${record.slug}", started ${record.startedAt}`;
}
