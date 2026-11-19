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
  companionDriftItems,
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
  /** The record's id, which tells this left save from a later one of the same entity. */
  id: string;
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
  /** Only the records with these ids, where given: those a settle before a save left standing. */
  only?: ReadonlySet<string>;
  /**
   * Whether the entity's registry row already holds the saved fields and translation flag. For a
   * collection, whose row this step does not write.
   */
  registryHolds(entity: {
    kind: AddressKind;
    slug: string;
    saved: SavedEntity | null;
  }): Promise<boolean>;
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
    if (deps.only !== undefined && !deps.only.has(row.record.id)) continue;
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
): Promise<string[]> {
  const settled = await settleHeld(adapter, migrationsDir, logger);
  const pending = settled.filter(s => s.outcome === "pending");
  if (pending.length > 0) throw pendingSaveRefusal(pending);
  // The records this settle judged: those still standing (left, or a collection's kept for its
  // registry row) are judged again after the save; one cleared is not read again.
  return settled.map(s => s.id);
}

/**
 * Settle again, once a Builder save has ended and still holding what it held, the records the
 * settle before it left standing (`standing`): a save that finished one left part-way (the same
 * save again) brought the database to it, and its record clears now. A record the save itself
 * left is not judged here: the save has said how it ended, and the next start settles it. Nothing
 * is refused here; the save has ended.
 */
export async function settleAfterBuilderSave(
  adapter: DrizzleAdapter,
  migrationsDir: string,
  logger: SettleDeps["logger"],
  standing: readonly string[]
): Promise<void> {
  if (standing.length === 0) return;
  await settleHeld(adapter, migrationsDir, logger, new Set(standing));
}

/** `settleLeftSaves` over the app's Builder setup, keeping a "pending" record. */
async function settleHeld(
  adapter: DrizzleAdapter,
  migrationsDir: string,
  logger: SettleDeps["logger"],
  only?: ReadonlySet<string>
): Promise<SettledSave[]> {
  // Loaded on demand, as the exclusion loads the writer hold: this runs only where a save writes.
  const [{ container }, { settleRegistryReader, settleRegistryWriter }] =
    await Promise.all([
      import("../../../di/container"),
      import("./settle-registry"),
    ]);
  if (!container.has("builderSaveSetup")) return [];
  const setup = container.get<{ projectRoot: string; database: string }>(
    "builderSaveSetup"
  );
  return settleLeftSaves({
    adapter,
    projectRoot: setup.projectRoot,
    migrationsDir,
    database: setup.database,
    logger,
    keepPending: true,
    ...(only === undefined ? {} : { only }),
    writeRegistry: settleRegistryWriter(adapter),
    registryHolds: settleRegistryReader(adapter),
  });
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
  const notes: string[] = [];
  const outcome = await settledOutcome(deps, record, notes);
  return {
    id: record.id,
    kind: record.kind,
    slug: record.slug,
    outcome,
    notes,
  };
}

/** What `settleLeftSave` did, with what it could not do added to `notes`. */
async function settledOutcome(
  deps: SettleDeps,
  record: LeftSave,
  notes: string[]
): Promise<SettledOutcome> {
  if (record.applies === false) {
    // Made outside development, the save left its files for `nextly migrate`: its tables stand
    // where it started whether or not it finished, so they cannot say how far it got, and removing
    // its files would take a deploy's migration away. Nothing of it is touched; the record stays.
    deps.logger.warn(
      `A Builder save of the ${described(record)} was made outside development, its migration files left for \`nextly migrate\`. It is not settled here; its record stays.`
    );
    return "left";
  }
  const dialect = deps.adapter.getCapabilities().dialect;
  const repo = new SchemaEventsRepository(deps.adapter.getDrizzle(), dialect);
  const { files, unclear } = await filesOfSave(deps, record);
  if (unclear.length > 0) {
    // A file named for the save's moment, with no ledger row, that the settle cannot tell as the
    // save's (one whose header names the entity only in its settings line, say): judged without
    // it, the save could be undone around it and the file left to run. The record stays.
    deps.logger.warn(
      `A Builder save of the ${described(record)} was left part-way, and ${unclear.join(", ")}, written as it ran, cannot be told as its own or not. It is not settled here; its record stays.`
    );
    notes.push(`${unclear.join(", ")} could not be told as the save's own`);
    return "left";
  }
  const judged = await judge(deps, repo, record, files);
  if (judged === "left") {
    // A MySQL save stopped inside a file: what landed is settled from the live tables by the
    // step for a stopped save, which this one does not run yet. The record stays, refusing.
    deps.logger.warn(
      `A Builder save of the ${described(record)} stopped part-way through a migration file, with part of it applied. It is not settled here yet; its record stays.`
    );
    return "left";
  }
  if (judged === "none") return settleNone(deps, repo, record, files, notes);
  // "all" or "pending": the saved definition stands, which its files are written from.
  notes.push(...(await keepSavedDefinition(deps, record)));
  if (judged === "pending") return settlePending(deps, record);
  return settleAll(deps, repo, record, files, notes);
}

/** A save none of which applied: its files go and its definition is put back, by rule. */
async function settleNone(
  deps: SettleDeps,
  repo: SchemaEventsRepository,
  record: LeftSave,
  files: readonly string[],
  notes: string[]
): Promise<SettledOutcome> {
  // The definition first: one that cannot be told from the save's own write (a record from
  // before it kept that write) keeps the record, and nothing else is touched, so the person can
  // settle it by hand from the record.
  const definition = await definitionAgainstRecord(deps, record);
  if (definition === "unknown") {
    deps.logger.warn(
      `A Builder save of the ${described(record)} stopped before any of it applied, but ${record.definitionFile} has changed since it started and its record does not say whether the save made that change. Its record stays.`
    );
    notes.push(
      `${record.definitionFile} could not be told apart from the save's own write`
    );
    return "left";
  }
  for (const filename of files) {
    // A failed attempt a file left in the ledger is cleared as the save's own withdrawal does.
    await settleRemovedFileAttempts(deps.adapter, repo, filename);
    await rm(join(deps.migrationsDir, filename), { force: true });
    await rm(
      snapshotPathOf(join(deps.migrationsDir, "meta"), baseName(filename)),
      { force: true }
    );
  }
  notes.push(...(await putDefinitionBack(deps, record, definition)));
  await clearSettledSave(deps.adapter, deps.projectRoot, record);
  deps.logger.info(
    `Settled a Builder save of the ${described(record)} that stopped before any of it applied: its files are removed and the definition put back.`
  );
  return "none";
}

/**
 * A save stopped between its files: the rest are pending. At a start they run as any pending
 * migration and the record clears; at a Builder save it is kept, to refuse the save.
 */
async function settlePending(
  deps: SettleDeps,
  record: LeftSave
): Promise<SettledOutcome> {
  if (deps.keepPending === true) return "pending";
  await clearSettledSave(deps.adapter, deps.projectRoot, record);
  deps.logger.info(
    `A Builder save of the ${described(record)} stopped between its migration files: the rest are pending, and run as any pending migration.`
  );
  return "pending";
}

/** A save that applied whole: its files recorded applied, its registry row brought up. */
async function settleAll(
  deps: SettleDeps,
  repo: SchemaEventsRepository,
  record: LeftSave,
  files: readonly string[],
  notes: string[]
): Promise<SettledOutcome> {
  for (const filename of files) {
    if (!(await repo.isFileApplied(filename))) {
      await recordAlreadyApplied({ filename }, repo);
    }
  }
  // A file applied after the save's last one: the schema has moved past this save (another
  // host's save, say), so its registry row is not written again over what came after.
  if (await movedPast(repo, files)) {
    await clearSettledSave(deps.adapter, deps.projectRoot, record);
    deps.logger.info(
      `A Builder save of the ${described(record)} applied whole before it stopped, and later migrations have applied since: its record is cleared, and its registry row left as they left it.`
    );
    notes.push(
      "later migrations applied since; the registry row is left as it is"
    );
    return "all";
  }
  const saved = savedEntity(record.definitionAfter, record.kind, record.slug);
  if (record.kind === "collection") {
    // A collection's registry row is written by its own service, which this step cannot reach
    // yet. Where the row already holds the saved fields (a retry's push wrote it), there is nothing
    // left to bring up and the record clears; otherwise its files are recorded and it stays.
    if (
      await deps.registryHolds({ kind: "collection", slug: record.slug, saved })
    ) {
      await clearSettledSave(deps.adapter, deps.projectRoot, record);
      deps.logger.info(
        `Settled a Builder save of the ${described(record)} that applied whole before it stopped: its files are recorded applied, and its registry row already holds the saved fields.`
      );
      return "all";
    }
    deps.logger.warn(
      `A Builder save of the ${described(record)} applied whole before it stopped, and its files are now recorded applied, but its registry row cannot be brought up here yet. Its record stays.`
    );
    notes.push("the collection's registry row is not brought up yet");
    return "all";
  }
  await deps.writeRegistry({ kind: record.kind, slug: record.slug, saved });
  await clearSettledSave(deps.adapter, deps.projectRoot, record);
  deps.logger.info(
    `Settled a Builder save of the ${described(record)} that applied whole before it stopped: its files are recorded applied and its registry row brought up.`
  );
  return "all";
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
  // No file of the save, and its tables not as it started: nothing says how they got there.
  if (facts.recorded + facts.unrecorded === 0) return "left";
  if (facts.unrecorded === 0) return "all";
  // Where no file is recorded and none started, the files were never run: tables standing at the
  // target were brought there another way, a push that did the whole change, whose companion
  // files have no snapshot to judge them by. Where some are recorded, an unrecorded file is taken
  // as landed only by a snapshot of its own; the rest are pending.
  if (
    facts.started === 0 &&
    facts.atTarget &&
    (facts.recorded === 0 || facts.unrecordedHaveSnapshots)
  ) {
    return "all";
  }
  // Some files ran and were recorded, and none of the rest started: on a database that runs a file
  // and records it together, those are files that never ran. The tables need not stand at the
  // target: a translation turned on leaves its main column for its translations file to move.
  if (facts.recorded > 0 && facts.started === 0) return "pending";
  return "left";
}

/** Whether the ledger records a file applied that is named after every one of `files`. */
async function movedPast(
  repo: SchemaEventsRepository,
  files: readonly string[]
): Promise<boolean> {
  const last = [...files].sort().at(-1);
  if (last === undefined) return false;
  return (await repo.listFileApplies()).some(
    row =>
      row.status === "applied" &&
      typeof row.filename === "string" &&
      row.filename > last &&
      !files.includes(row.filename)
  );
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
  // The tables the save changes, and the entity's own table always: a save stopped before its
  // first snapshot was written has no target to tell its changes by, and one that changes only
  // translated columns changes none of the main table's that the equivalence compares (they are
  // recorded on it as `localizedColumns`), yet its translations table is still to be judged.
  const tables = [
    ...new Set([
      ...changedTables(before, target ?? before),
      ...entityTables(record),
    ]),
  ];
  const live =
    tables.length === 0
      ? { tables: [] }
      : await introspectLiveSnapshot(
          deps.adapter.getDrizzle(),
          deps.adapter.getCapabilities().dialect,
          tables
        );
  // A translated table stands where a snapshot says only with its translations table: a save whose
  // main statements committed and whose translations table did not follow is at neither end.
  const companionsAt = async (snapshot: NextlySchemaSnapshot) => {
    for (const table of only(snapshot, tables).tables) {
      if (table.localized !== true) continue;
      if ((await companionDriftItems(deps, table.name, table)).length > 0) {
        return false;
      }
    }
    return true;
  };
  return {
    atBefore:
      snapshotsEquivalent(only(before, tables), live) &&
      (await companionsAt(before)),
    atTarget:
      target !== undefined &&
      snapshotsEquivalent(only(target, tables), live) &&
      (await companionsAt(target)),
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
): Promise<{ files: string[]; unclear: string[] }> {
  const named = new Set(record.files ?? []);
  const unclear: string[] = [];
  const present = await sqlFilesIn(deps.migrationsDir);
  const isOfSave = laterFileOfSave(deps, record);
  for (const name of present) {
    if (named.has(name)) continue;
    const verdict = await isOfSave(name);
    if (verdict === "save") named.add(name);
    else if (verdict === "unclear") unclear.push(name);
  }
  // Only the files still there: one a settle already removed is not judged again.
  return {
    files: [...named].filter(n => present.includes(n)).sort(),
    unclear,
  };
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
 * Whether a file the record does not name is the save's all the same ("save"): written after the
 * record last learned a name, with no ledger row, named for a moment at or after the save started,
 * and naming the entity or changing its tables. One that has the first three and neither of the
 * last ("unclear") cannot be told; any other file is not the save's ("other").
 */
function laterFileOfSave(
  deps: SettleDeps,
  record: LeftSave
): (name: string) => Promise<"save" | "unclear" | "other"> {
  const dialect = deps.adapter.getCapabilities().dialect;
  const repo = new SchemaEventsRepository(deps.adapter.getDrizzle(), dialect);
  const window = nameWindow(record);
  const tables = entityTables(record);
  return async name => {
    if (window === undefined) return "other";
    const stamp = name.slice(0, window.from.length);
    if (stamp < window.from || stamp > window.to) return "other";
    if (await repo.isFileApplied(name)) return "other";
    const content = await readFile(join(deps.migrationsDir, name), "utf-8");
    return namesEntity(content, record) || touches(content, tables, dialect)
      ? "save"
      : "unclear";
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
 * Where the definition file stands against the record: as before the save (`before`), as the save
 * wrote it (`saved`), changed since in another way (`edited`), or changed where the record does not
 * keep the save's own text to tell (`unknown`).
 */
async function definitionAgainstRecord(
  deps: SettleDeps,
  record: LeftSave
): Promise<"before" | "saved" | "edited" | "unknown"> {
  const current = await readIfPresent(
    join(deps.projectRoot, record.definitionFile)
  );
  if (current === (record.definitionBefore ?? undefined)) return "before";
  if (record.definitionAfter === undefined) return "unknown";
  return current === record.definitionAfter ? "saved" : "edited";
}

/**
 * Put the definition back as it was before the save, where it is still what the save wrote. One
 * already as it was is left. One edited since is left as it is, and named.
 */
async function putDefinitionBack(
  deps: SettleDeps,
  record: LeftSave,
  definition: "before" | "saved" | "edited"
): Promise<string[]> {
  if (definition === "before") return [];
  if (definition === "saved") {
    const path = join(deps.projectRoot, record.definitionFile);
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
 * The moments a file of the save can be named for (`formatTimestamp`), first and last. A record
 * that keeps the moment the save's files are named for (`filesAt`) allows a second either side of
 * it: a file that must run before the save's main one (a translation turned off) is named a few
 * milliseconds before it, the files after it a few after. One that does not, written before that
 * moment was kept, allows from a second before the save started to five minutes after: the time a
 * save takes to reach its files. A file named outside these is another writer's, even where it
 * names the entity.
 */
function nameWindow(
  record: LeftSave
): { from: string; to: string } | undefined {
  const filesAt =
    record.filesAt === undefined
      ? undefined
      : new Date(record.filesAt).getTime();
  const startedAt = new Date(record.startedAt).getTime();
  if (filesAt !== undefined && !Number.isNaN(filesAt)) {
    return {
      from: formatTimestamp(new Date(filesAt - 1000)),
      to: formatTimestamp(new Date(filesAt + 1000)),
    };
  }
  if (Number.isNaN(startedAt)) return undefined;
  return {
    from: formatTimestamp(new Date(startedAt - 1000)),
    to: formatTimestamp(new Date(startedAt + 5 * 60 * 1000)),
  };
}

function kindName(kind: AddressKind): string {
  return kind === "fieldGroup" ? "field group" : kind;
}

function described(record: LeftSave): string {
  return `${kindName(record.kind)} "${record.slug}", started ${record.startedAt}`;
}
