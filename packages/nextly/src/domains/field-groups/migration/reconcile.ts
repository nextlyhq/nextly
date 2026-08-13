/**
 * Decides a rename plan against what the database actually contains.
 *
 * The plan itself is a pure function of registry rows and knows nothing about
 * the database. Reconciling it needs four things the plan deliberately does not
 * have: the catalog, the server's rules for deciding whether two spellings are
 * one object, the columns those objects carry, and how far a run has already
 * got. Those live here.
 *
 * Nothing is removed from a plan. Progress is annotated, because the plan is
 * indexed by position and identified by hash: dropping an entry renumbers every
 * later step and changes the identity the marker recorded, so a resume would
 * refuse the plan it is resuming.
 *
 * @module domains/field-groups/migration/reconcile
 */

import { NextlyError } from "../../../errors/nextly-error";
import { STORAGE_FORMAT } from "../../../schemas/storage-format";
import {
  findCaseVariant,
  indexCatalog,
  resolveCatalogName,
  type CatalogIndex,
  type IdentifierCaseRules,
} from "../../schema/utils/resolve-catalog-name";

import type { MigratedObjectsVerification, StorageProbe } from "./guard";
import {
  MIGRATION_TARGET,
  retargetName,
  tableRenamesOf,
  type ManifestEntry,
  type RegistryRow,
  type TableRename,
} from "./manifest";
import { REFUSAL_KIND_KEY, type RefusalKind } from "./refusal-kind";
import type { MigrationDirection, StorageGeneration } from "./state";

/**
 * An entry, plus the physical table moves reconciliation found still outstanding.
 *
 * 🔴 Carried out of reconciliation rather than recomputed by whoever needs it, and that is the
 * point of the type. Deciding which renames remain means resolving each source in the catalog, and
 * reconciliation does exactly that, per physical rename, before collapsing the result into
 * `satisfied`. Anything that re-derives the question from `satisfied` is asking a COARSER one: an
 * entry moving a table and its `_locales` companion is unsatisfied while either remains, so a run
 * torn between the two reports the already-moved table as still to move.
 *
 * Required rather than optional, so the answer cannot be reached through a fallback that quietly
 * reintroduces the coarser derivation. A column entry moves no table and carries an empty list,
 * which is a real answer rather than a missing one.
 */
export type ReconciledEntry = ManifestEntry & {
  readonly pendingTableRenames: readonly TableRename[];
};

/** The columns one table carries, as the database reported them. */
export interface TableColumns {
  readonly table: string;
  readonly columns: readonly string[];
}

/**
 * How far a run has been recorded, which is what gives a half-applied database
 * its meaning.
 *
 * A target that exists while its source is gone is *completed work* only if the
 * run that did it got that far. Presence of a run record is not enough on its
 * own: a marker recording step 1 says nothing about step 7, so treating any
 * record as blanket permission would adopt an unrelated object that happened to
 * be sitting on step 7's target name.
 *
 * `step` is the last position whose postcondition verified, matching the marker,
 * so positions up to `step + 1` are explicable — `step + 1` being the crash
 * window the runner deliberately supports, where a statement committed but its
 * marker write did not.
 */
export type RunRecord =
  | { recorded: false }
  | { recorded: true; direction: MigrationDirection; step: number };

/**
 * Reconcile a plan against the catalog.
 *
 * Refuses rather than proceeding whenever the facts have no single reading.
 * Every refusal here costs an operator a look; the alternative is a run that
 * fails after its marker is written, leaving storage half-migrated.
 *
 * `direction` is the direction of the plan being handed in. It is checked
 * against the recorded run because the two must agree: a `down` plan is the
 * inverse of an `up` one, so scoring an `up` plan's positions against a `down`
 * run's progress would mark real work as already done and skip it.
 */
export function reconcilePlan(args: {
  entries: readonly ManifestEntry[];
  rows: readonly RegistryRow[];
  tables: readonly string[];
  columns: readonly TableColumns[];
  run: RunRecord;
  direction: MigrationDirection;
  identifierCase: IdentifierCaseRules;
}): ReconciledEntry[] {
  const { entries, rows, run, direction, identifierCase } = args;

  if (run.recorded && run.direction !== direction) {
    throw NextlyError.internal({
      logContext: {
        reason: "reconciled a plan against a run going the other way",
        planDirection: direction,
        runDirection: run.direction,
      },
    });
  }

  const catalog = indexCatalog(args.tables, identifierCase.tables);
  const columns = indexColumns(args.columns, catalog, identifierCase);

  // A column entry names one fixed spelling of its table, but the table itself
  // moves during the run, so the columns have to be findable under either name.
  // Which of the two is the "other" one depends on direction: going up a column
  // names the post-rename table and the other name is where it came from, while
  // a rollback keeps that same spelling as the name the table starts under, so
  // the other name is where the revert takes it. Recording both directions makes
  // the lookup independent of which way the run is going.
  const otherNames = new Map<string, string[]>();
  const linkNames = (name: string, other: string): void => {
    const existing = otherNames.get(name);
    if (existing === undefined) otherNames.set(name, [other]);
    else existing.push(other);
  };
  for (const entry of entries) {
    if (entry.kind === "column") continue;
    linkNames(entry.to, entry.from);
    linkNames(entry.from, entry.to);
  }

  // Built BEFORE the storage check, which needs it. A row's counterpart name
  // cannot be derived from the row alone: `retargetName` only maps a legacy
  // spelling forward, so during a rollback torn between a rename and its pointer
  // update — the registry still naming the migrated table, the catalog already
  // holding the legacy one — the row's storage looks absent. Only the directed
  // plan knows both sides of a rename it is undoing.
  assertEveryRowHasStorage(rows, catalog, otherNames);

  return entries.map((entry, index) => {
    const position = index + 1;
    if (entry.kind === "column") {
      // Attached here rather than threaded through `reconcileColumn`'s four return paths, which
      // all describe a column and would each have to restate the same empty list.
      return {
        ...reconcileColumn(entry, {
          catalog,
          columns,
          otherNames,
          position,
          run,
        }),
        pendingTableRenames: [],
      };
    }
    return reconcileRename(entry, catalog, position, run);
  });
}

/**
 * Build the probe the storage guard consumes.
 *
 * `migratedObjects` is what stops the guard trusting registry presence alone:
 * the read path turns a missing data table into an empty result, so an
 * incomplete rename would serve blank content rather than fail.
 *
 * `typeColumn` is the discriminator the generation being probed must carry —
 * the legacy spelling when probing legacy storage, the migrated one when probing
 * migrated storage. It is checked because a table present under its migrated
 * name while still holding the old column is *not* migrated storage, and reading
 * it addresses a column that is not there.
 */
export function probeStorage(args: {
  rows: readonly RegistryRow[];
  tables: readonly string[];
  columns: readonly TableColumns[];
  identifierCase: IdentifierCaseRules;
  generation: StorageGeneration;
}): StorageProbe {
  const { identifierCase, generation } = args;
  // Derived from the generation rather than passed alongside it, so the column
  // required and the names required cannot disagree.
  const typeColumn =
    generation === "field-groups-v2"
      ? MIGRATION_TARGET.columnType
      : STORAGE_FORMAT.columns.type;
  const catalog = indexCatalog(args.tables, identifierCase.tables);
  const columns = indexColumns(args.columns, catalog, identifierCase);
  const missing: string[] = [];
  // A settled marker is not exempt from ownership: a registry restored or
  // repaired with two rows that resolve to one table would otherwise be reported
  // complete, and the verdict would authorise both field groups against the same
  // storage.
  const claim = createClaimLedger();

  for (const row of args.rows) {
    for (const object of expectedStorage(row, generation)) {
      const found = resolveAny(catalog, object.names);
      if (found === undefined) {
        missing.push(object.names[0]);
        continue;
      }
      claim(found, claimantOf(row, object));
      // Only the base table carries the discriminator; companions hold
      // translations of individual fields and never the type.
      if (!object.isBase) continue;
      const tableColumns = columns.get(found);
      if (
        tableColumns === undefined ||
        resolveCatalogName(tableColumns, typeColumn) === undefined
      ) {
        missing.push(`${found}.${typeColumn}`);
      }
    }
  }

  const migratedObjects: MigratedObjectsVerification =
    missing.length === 0 ? { complete: true } : { complete: false, missing };

  return {
    targetRegistryPresent:
      resolveCatalogName(catalog, MIGRATION_TARGET.registryTable) !== undefined,
    legacyRegistryPresent:
      resolveCatalogName(catalog, STORAGE_FORMAT.registryTable) !== undefined,
    migratedObjects,
  };
}

/** One physical object a registry row requires, and the names it may go by. */
interface ExpectedObject {
  /** Acceptable names, stored name first. */
  readonly names: string[];
  /** The row's own table, as opposed to its companion. */
  readonly isBase: boolean;
}

/**
 * Which physical names count as satisfying a row.
 *
 * `either` is for reconciling a run in flight, where a row is under its stored
 * name until its rename commits and under the migrated name afterwards. The two
 * generation values are for *verifying a settled marker*, where only one name is
 * acceptable — accepting both there would report a migration complete that never
 * renamed anything.
 */
type StorageNaming = "either" | StorageGeneration;

/**
 * Every object a registry row requires to exist.
 *
 * The single definition of that question, shared by the up-front check and the
 * probe so the two cannot diverge: a check that ran before any rename while
 * omitting companions would pass a row whose companion is already gone, and the
 * loss would surface only after other objects had moved.
 *
 * A companion is included whenever one is physically present per the registry,
 * including for a row this plan leaves alone: `buildMigrationManifest` emits a
 * companion rename only for rows it retargets, so nothing else in the plan ever
 * names a custom-named row's companion.
 *
 * Both the stored name and the migrated name are acceptable because during a run
 * exactly one of them is real, and which one depends on whether this row's
 * rename has already committed. Accepting either is not a loophole for an
 * unexplained target: `reconcileRename` still refuses a target that no recorded
 * progress accounts for, and does it with a message that names the conflict.
 */
function expectedStorage(
  row: RegistryRow,
  naming: StorageNaming,
  /**
   * Names the directed plan says this row's table also travels under.
   *
   * Only consulted for `either`, which asks whether a row has storage *at all*
   * rather than whether it is at a particular generation. The other two modes
   * require one specific spelling, and widening them would let a half-applied
   * database satisfy a check about a finished one.
   */
  alternates?: readonly string[]
): ExpectedObject[] {
  const target = retargetName(row);
  const suffix = STORAGE_FORMAT.companionSuffix;

  const base = namesFor(row, target, naming, alternates);
  const objects: ExpectedObject[] = [{ names: base, isBase: true }];
  if (row.hasCompanion) {
    objects.push({
      names: base.map(name => `${name}${suffix}`),
      isBase: false,
    });
  }
  return objects;
}

/**
 * The base names acceptable for a row under a given naming mode.
 *
 * For `field-groups-v2` the retargeted name is **required**: a settled marker
 * plus a row still naming its legacy table means the rename never happened, and
 * accepting the legacy name there would authorise migrated storage that does not
 * exist. A row with no retarget — a custom name this migration leaves alone — is
 * already at its final name, so that name is the required one.
 */
function namesFor(
  row: RegistryRow,
  target: string | null,
  naming: StorageNaming,
  alternates?: readonly string[]
): string[] {
  if (naming === "legacy") return [row.tableName];
  if (naming === "field-groups-v2") return [target ?? row.tableName];
  // `retargetName` maps a legacy spelling forward and returns null for anything
  // else, so it cannot name where a rollback is taking a migrated table. The
  // directed plan can, and a torn rollback is exactly the state where the row
  // and the catalog disagree about which of the two names is current.
  const names = new Set([
    row.tableName,
    ...(target === null ? [] : [target]),
    ...(alternates ?? []),
  ]);
  return [...names];
}

/**
 * Records which registry row owns each physical object, and refuses a second
 * claim on one.
 *
 * Shared by the pre-run check and the settled-marker probe because they ask the
 * same question and an answer that differs between them is a hole: ownership
 * cannot be shared, whichever path notices. Claims are keyed by the **resolved**
 * catalog name, the only level at which two spellings are known to be one
 * object — the plan compares exactly, having no dialect.
 */
function createClaimLedger(): (found: string, claimant: string) => void {
  const claims = new Map<string, string>();
  return (found, claimant) => {
    const previous = claims.get(found);
    if (previous !== undefined) {
      throw refuse("one physical object is claimed by two field groups", {
        table: found,
        claimedBy: previous,
        alsoClaimedBy: claimant,
      });
    }
    claims.set(found, claimant);
  };
}

/** How a refusal names the owner of an expected object. */
function claimantOf(row: RegistryRow, object: ExpectedObject): string {
  return `${row.slug}${object.isBase ? "" : " companion"}`;
}

function resolveAny(
  catalog: CatalogIndex,
  names: readonly string[]
): string | undefined {
  for (const name of names) {
    const found = resolveCatalogName(catalog, name);
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * Index each table's columns under the server's column rules.
 *
 * Keyed by the catalog's own spelling of the table name, resolved through the
 * table rules, so a lookup that found a table can find its columns under the
 * same name.
 */
function indexColumns(
  tables: readonly TableColumns[],
  catalog: CatalogIndex,
  identifierCase: IdentifierCaseRules
): Map<string, CatalogIndex> {
  const byTable = new Map<string, CatalogIndex>();
  for (const entry of tables) {
    // Keyed by the catalog's spelling, because that is the spelling every lookup
    // here arrives with: callers resolve a table before asking for its columns.
    // Keying by the caller's spelling instead would miss on any server that
    // reports a name in a different case, and reconciliation would then refuse
    // storage that is present.
    const table = resolveCatalogName(catalog, entry.table);
    // Columns for a table the catalog does not list describe nothing that can be
    // renamed or verified.
    if (table === undefined) continue;
    byTable.set(table, indexCatalog(entry.columns, identifierCase.columns));
  }
  return byTable;
}

/**
 * Every registry row must have storage, including rows this plan leaves alone.
 *
 * A custom-named row produces no rename entry, so an entry-driven check cannot
 * see it. Its storage can still be missing — the legacy read path tolerates that
 * by returning an empty result — and the migration would then rename around a
 * row whose data is already gone.
 */
function assertEveryRowHasStorage(
  rows: readonly RegistryRow[],
  catalog: CatalogIndex,
  otherNames: ReadonlyMap<string, string[]>
): void {
  const missing: string[] = [];
  const caseVariants: Record<string, string> = {};
  const claim = createClaimLedger();

  for (const row of rows) {
    for (const object of expectedStorage(
      row,
      "either",
      otherNames.get(row.tableName)
    )) {
      const found = resolveAny(catalog, object.names);
      if (found === undefined) {
        missing.push(object.names[0]);
        // A name present under a different case is a different object on this
        // server, and saying so turns "a table is missing" into a row an operator
        // can correct.
        const variant = findCaseVariant(catalog, object.names[0]);
        if (variant !== undefined) caseVariants[object.names[0]] = variant;
        continue;
      }
      claim(found, claimantOf(row, object));
    }
  }

  if (missing.length === 0) return;
  throw refuse("registry rows name storage that does not exist", {
    missing,
    ...(Object.keys(caseVariants).length > 0 ? { caseVariants } : {}),
  });
}

/**
 * Whether recorded progress explains this position already being applied.
 *
 * Positions at or below the recorded step verified. The one after it is the
 * crash window the runner supports, where a statement committed before its
 * marker write. Anything beyond that has not been attempted, so an applied-looking
 * object there was not put in place by this run.
 */
function acceptsApplied(position: number, run: RunRecord): boolean {
  return run.recorded && position <= run.step + 1;
}

/**
 * Whether the marker claims this position's postcondition already verified.
 *
 * Stricter than `acceptsApplied` by exactly the crash window: a position at or
 * below the recorded step was verified and **will never run again**, because the
 * guard resumes at `step + 1`. So finding its source still in place is not
 * outstanding work — nothing will pick it up — it is the marker and the database
 * contradicting each other.
 */
function recordedAsDone(position: number, run: RunRecord): boolean {
  return run.recorded && position <= run.step;
}

/**
 * Decide a column rename against the columns the table actually has.
 *
 * The table's presence says nothing about the column: a rename that commits
 * before its marker write leaves the table in place both before and after, so
 * without looking at the columns a resume cannot tell outstanding work from work
 * already done and would retry a rename whose source column is gone.
 */
function reconcileColumn(
  entry: ManifestEntry,
  context: {
    catalog: CatalogIndex;
    columns: Map<string, CatalogIndex>;
    otherNames: Map<string, string[]>;
    position: number;
    run: RunRecord;
  }
): ManifestEntry {
  const { catalog, columns, otherNames, position, run } = context;
  const table = entry.table;
  if (table === undefined) return entry;

  // Either side of its table's rename: the name the entry carries if the table
  // is still under it, otherwise whichever name the plan moves it to or from.
  const current =
    resolveCatalogName(catalog, table) ??
    resolveAny(catalog, otherNames.get(table) ?? []);

  // Neither the table nor its predecessor exists. There is no work to do and
  // nothing to verify, and the missing storage is reported by the row check
  // rather than here, where the table is not the subject.
  if (current === undefined) return { ...entry, satisfied: true };

  const tableColumns = columns.get(current);
  if (tableColumns === undefined) {
    throw NextlyError.internal({
      logContext: {
        reason: "reconciliation was given no columns for a table that exists",
        table: current,
        // The catalog is read as two queries — the table list, then the columns of those tables —
        // so a rename landing between them leaves a name in the list that introspection no longer
        // finds. For an unlocked reader that is a torn read rather than an impossible state, and
        // re-reading resolves it.
        [REFUSAL_KIND_KEY]: "torn-read",
      },
    });
  }

  const hasFrom = resolveCatalogName(tableColumns, entry.from) !== undefined;
  const hasTo = resolveCatalogName(tableColumns, entry.to) !== undefined;

  if (hasFrom && hasTo) {
    throw refuse("both discriminator columns exist on one table", {
      table: current,
      from: entry.from,
      to: entry.to,
    });
  }

  if (hasFrom) {
    if (recordedAsDone(position, run)) {
      throw refuseProgressMismatch(
        "a column rename the marker records as verified has not been applied",
        position,
        run,
        { table: current, from: entry.from, to: entry.to }
      );
    }
    return entry;
  }

  if (hasTo) {
    if (!acceptsApplied(position, run)) {
      throw refuseProgressMismatch(
        "a column carries the migrated name but no recorded progress accounts for it",
        position,
        run,
        { table: current, from: entry.from, to: entry.to }
      );
    }
    return { ...entry, satisfied: true };
  }

  // Every field-group data table carries the discriminator: the schema service
  // emits it unconditionally. A table holding neither spelling is not field-group
  // storage this migration can reason about.
  throw refuse("field group table has no discriminator column", {
    table: current,
    from: entry.from,
    to: entry.to,
  });
}

function reconcileRename(
  entry: ManifestEntry,
  catalog: CatalogIndex,
  position: number,
  run: RunRecord
): ReconciledEntry {
  // A table entry moves its companion as well as itself, and the two are not
  // always in the same state: MySQL commits each rename separately, so a crash
  // between them leaves the base migrated and the companion still under its old
  // name. The entry only counts as done once every table it moves is done —
  // marking it satisfied on the base alone would let the step skip a companion
  // that is still sitting there.
  let allApplied = true;
  // Collected from the same resolution that decides `allApplied`, so the two answers come from one
  // pass over one catalog. The step executes exactly these: it re-resolves each source against a
  // catalog read at its own turn, and skips the ones already gone.
  const pendingTableRenames: TableRename[] = [];

  for (const rename of tableRenamesOf(entry)) {
    const source = resolveCatalogName(catalog, rename.from);
    const target = resolveCatalogName(catalog, rename.to);

    if (source !== undefined && target !== undefined) {
      throw refuse("migration target name is already in use", {
        from: rename.from,
        to: rename.to,
        occupiedBy: target,
      });
    }

    if (source !== undefined) {
      if (recordedAsDone(position, run)) {
        throw refuseProgressMismatch(
          "a rename the marker records as verified has not been applied",
          position,
          run,
          { from: rename.from, to: rename.to }
        );
      }
      pendingTableRenames.push(rename);
      allApplied = false;
      continue;
    }

    if (target !== undefined) {
      // Source gone, target present. Only progress that reached this position
      // makes it our own finished work; otherwise it is an object belonging to
      // something else, sitting on the name this migration wants, and adopting
      // it would treat a stranger's table as migrated field-group storage.
      if (!acceptsApplied(position, run)) {
        throw refuseProgressMismatch(
          "an object using the migrated storage name exists but no recorded progress accounts for it",
          position,
          run,
          { from: rename.from, to: rename.to, occupiedBy: target }
        );
      }
      continue;
    }

    throw refuse("migration source object is missing", {
      from: rename.from,
      to: rename.to,
    });
  }

  return allApplied
    ? { ...entry, satisfied: true, pendingTableRenames }
    : { ...entry, pendingTableRenames };
}

/**
 * Refusals are 503: the database is in a shape a human has to look at, and the
 * process must not serve or migrate until they have. Detail goes to `logContext`
 * so operators get the full picture while the public message stays generic.
 *
 * 🔴 Defaults to `permanent`, and the asymmetry is deliberate. The two mistakes
 * are not equally bad: a torn refusal left unmarked simply is not retried, which
 * costs an operator a re-read, while a permanent one marked torn would be
 * retried until the attempts ran out and then reported as contention — turning a
 * loud, correct refusal about their data into a soft wrong answer. A refusal
 * added later therefore has to opt IN to being retryable.
 */
function refuse(
  reason: string,
  context: Record<string, unknown>,
  kind: RefusalKind = "permanent"
): NextlyError {
  return NextlyError.serviceUnavailable({
    logMessage: `field-group migration refused to proceed: ${reason}`,
    logContext: { reason, [REFUSAL_KIND_KEY]: kind, ...context },
  });
}

/**
 * The marker and the catalog disagree about how far a rename has progressed.
 *
 * 🔴 One helper for every such refusal, rather than the kind stamped at each
 * site. Tables and columns are reconciled by different functions and each raises
 * the same PAIR — a source still present at a position the marker vouches for,
 * and a target present that no recorded progress accounts for — so the
 * classification was applied to one pair and missed on the other, which is
 * exactly the divergence a second implementation of one question produces.
 *
 * Routing all four through here also makes the tag unavoidable: a fifth
 * progress-mismatch refusal cannot be added untagged without deliberately
 * bypassing the only function that takes a `position` and a `run`.
 *
 * Every one of these is a torn read BY CONSTRUCTION. The disagreement is
 * between the recorded position and the catalog, and those are separate reads
 * for an unlocked observer; a writer advancing between them produces a pair no
 * instant ever held. Refusals that do NOT compare the two — a target name
 * occupied, both discriminators present, storage missing entirely — describe the
 * database itself and stay permanent.
 */
function refuseProgressMismatch(
  reason: string,
  position: number,
  run: RunRecord,
  context: Record<string, unknown>
): NextlyError {
  return refuse(
    reason,
    {
      ...context,
      position,
      recordedStep: run.recorded ? run.step : null,
    },
    "torn-read"
  );
}
