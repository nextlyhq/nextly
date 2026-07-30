/**
 * Decides a rename plan against what the database actually contains.
 *
 * The plan itself is a pure function of registry rows and knows nothing about
 * the database. Reconciling it needs three things the plan deliberately does not
 * have: the catalog, the dialect's rules for deciding whether two spellings are
 * one table, and whether a migration run is already recorded. Those live here.
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
  indexCatalog,
  resolveCatalogName,
  type CatalogIndex,
} from "../../schema/utils/resolve-catalog-name";

import type { MigratedObjectsVerification, StorageProbe } from "./guard";
import {
  MIGRATION_TARGET,
  type ManifestEntry,
  type RegistryRow,
} from "./manifest";

/**
 * Whether a migration run is on record.
 *
 * This is the fact that gives a half-applied database its meaning. A target that
 * exists while its source is gone is *completed work* if a run is recorded, and
 * *someone else's table* if none is — and the two call for opposite responses,
 * so the state is passed in rather than guessed from the objects.
 */
export type RunRecord = { recorded: true } | { recorded: false };

/**
 * Reconcile a plan against the catalog.
 *
 * Refuses rather than proceeding whenever the pair of facts has no single
 * reading. Every refusal here costs an operator a look; the alternative is a run
 * that fails after its marker is written, leaving storage half-migrated.
 */
export function reconcilePlan(args: {
  entries: readonly ManifestEntry[];
  rows: readonly RegistryRow[];
  tables: readonly string[];
  run: RunRecord;
}): ManifestEntry[] {
  const { entries, rows, run } = args;
  const catalog = indexCatalog(args.tables);

  assertEveryRowHasStorage(rows, catalog);

  // Names this plan will bring into existence count as present for the entries
  // that follow them: a column names its post-rename table, which is legitimately
  // absent from a pre-migration catalog.
  const willExist = new Set<string>();
  for (const entry of entries) {
    if (entry.kind !== "column") willExist.add(entry.to);
  }

  return entries.map(entry => {
    if (entry.kind === "column")
      return reconcileColumn(entry, catalog, willExist);
    return reconcileRename(entry, catalog, run);
  });
}

/**
 * Build the probe the storage guard consumes.
 *
 * `migratedObjects` is what stops the guard trusting registry presence alone:
 * the read path turns a missing data table into an empty result, so an
 * incomplete rename would serve blank content rather than fail.
 */
export function probeStorage(args: {
  rows: readonly RegistryRow[];
  tables: readonly string[];
}): StorageProbe {
  const catalog = indexCatalog(args.tables);
  const missing: string[] = [];

  for (const row of args.rows) {
    if (resolveCatalogName(catalog, row.tableName) === undefined) {
      missing.push(row.tableName);
    }
    if (!row.hasCompanion) continue;
    const companion = `${row.tableName}${STORAGE_FORMAT.companionSuffix}`;
    if (resolveCatalogName(catalog, companion) === undefined) {
      missing.push(companion);
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

/**
 * Every registry row must have storage, including rows this plan leaves alone.
 *
 * A custom-named row produces no rename entry, so an entry-driven check cannot
 * see it. Its table can still be missing — the legacy read path tolerates that
 * by returning an empty result — and the migration would then rename around a
 * row whose data is already gone.
 */
function assertEveryRowHasStorage(
  rows: readonly RegistryRow[],
  catalog: CatalogIndex
): void {
  const missing = rows
    .filter(row => resolveCatalogName(catalog, row.tableName) === undefined)
    .map(row => row.tableName);
  if (missing.length === 0) return;
  throw refuse("registry rows name storage that does not exist", { missing });
}

function reconcileColumn(
  entry: ManifestEntry,
  catalog: CatalogIndex,
  willExist: ReadonlySet<string>
): ManifestEntry {
  const table = entry.table;
  if (table === undefined) return entry;
  const present =
    resolveCatalogName(catalog, table) !== undefined || willExist.has(table);
  // A column on a table that neither exists nor is coming is not work, and
  // cannot be verified either.
  return present ? entry : { ...entry, satisfied: true };
}

function reconcileRename(
  entry: ManifestEntry,
  catalog: CatalogIndex,
  run: RunRecord
): ManifestEntry {
  const source = resolveCatalogName(catalog, entry.from);
  const target = resolveCatalogName(catalog, entry.to);

  if (source !== undefined && target !== undefined) {
    throw refuse("migration target name is already in use", {
      from: entry.from,
      to: entry.to,
      occupiedBy: target,
    });
  }

  if (source !== undefined) return entry;

  if (target !== undefined) {
    // Source gone, target present. Only a recorded run makes this our own
    // finished work; with no run on record it is a table belonging to something
    // else, sitting on the name this migration wants, and adopting it would
    // treat a stranger's table as migrated field-group storage.
    if (!run.recorded) {
      throw refuse(
        "an object using the migrated storage name exists but no migration recorded it",
        { from: entry.from, to: entry.to, occupiedBy: target }
      );
    }
    return { ...entry, satisfied: true };
  }

  throw refuse("migration source object is missing", {
    from: entry.from,
    to: entry.to,
  });
}

/**
 * Refusals are 503: the database is in a shape a human has to look at, and the
 * process must not serve or migrate until they have. Detail goes to `logContext`
 * so operators get the full picture while the public message stays generic.
 */
function refuse(reason: string, context: Record<string, unknown>): NextlyError {
  return NextlyError.serviceUnavailable({
    logMessage: `field-group migration refused to proceed: ${reason}`,
    logContext: { reason, ...context },
  });
}
