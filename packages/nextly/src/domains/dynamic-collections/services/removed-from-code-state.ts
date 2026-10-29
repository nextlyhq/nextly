/**
 * Where a collection or Single removed from code stands on its way to being
 * retired, and so the next step the admin names for it.
 *
 * Decided on the server from what the codebase already records, and nothing
 * else: whether the entity's main table exists, which of the app's migration
 * files drop that table (read from each file's UP statements, as `nextly
 * migrate` reads them), and what the migration ledger (`nextly_schema_events`)
 * says each of those files came to.
 *
 * The states named here:
 *
 * - `not-dropped`: its tables exist and no migration drops it. The step is
 *   `nextly migrate:create`, then `nextly migrate`.
 * - `drop-pending`: a written migration drops it, not yet applied and with no
 *   attempt to apply it stopped, and its main table exists. The step is
 *   `nextly migrate`, and the file is named.
 * - `half-retired`: an applied migration dropped its main table and its
 *   registry row is still there. Nothing in this release finishes such a
 *   retirement, so an earlier release left it part-retired, and `nextly prune`
 *   lists what remains.
 * - `other`: anything else (an attempt to apply a drop that stopped part way,
 *   a main table lost outside a migration, a table back after an applied
 *   drop). The admin still marks the entity and says it left the
 *   configuration; it names no step it cannot vouch for.
 *
 * @module domains/dynamic-collections/services/removed-from-code-state
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import {
  discoverMigrationGroups,
  getSortedBaseNames,
  selectVariant,
} from "../../../cli/utils/migration-discovery";

import type { RemovableEntityKind } from "./removed-from-code-writes";

/** Where a removed entity's retirement stands, as the admin reads it. */
export type RemovedFromCodeState =
  | { state: "not-dropped" }
  | { state: "drop-pending"; migration: string }
  | { state: "half-retired" }
  | { state: "other" };

/** What the ledger says of one migration file. */
export type MigrationLedgerState = "applied" | "stopped" | "pending";

/** One app migration file that drops the entity's main table. */
export interface DroppingMigration {
  /** The file's ledger name, `<base>.sql`. */
  file: string;
  ledger: MigrationLedgerState;
}

/** Everything {@link removedFromCodeState} decides from. */
export interface RetirementEvidence {
  mainTablePresent: boolean;
  /** The files dropping the main table, oldest first. */
  drops: readonly DroppingMigration[];
}

/**
 * The state the evidence describes. Pure, so the rule is read and tested
 * apart from the files and the database it is gathered from.
 */
export function removedFromCodeState(
  evidence: RetirementEvidence
): RemovedFromCodeState {
  const { mainTablePresent, drops } = evidence;
  // A stopped attempt is resolved with `migrate:resolve` before anything else
  // can move, whatever the table says.
  if (drops.some(drop => drop.ledger === "stopped")) return { state: "other" };
  const applied = drops.some(drop => drop.ledger === "applied");
  if (!mainTablePresent) {
    return applied ? { state: "half-retired" } : { state: "other" };
  }
  if (applied) return { state: "other" };
  const pending = drops.find(drop => drop.ledger === "pending");
  return pending === undefined
    ? { state: "not-dropped" }
    : { state: "drop-pending", migration: pending.file };
}

/** A removed entity whose state is asked for. */
export interface RemovedEntityRef {
  kind: RemovableEntityKind;
  slug: string;
  tableName: string;
}

/** The parts of the adapter the reading uses. */
export interface RetirementAdapter {
  dialect: SupportedDialect;
  tableExists: (name: string) => Promise<boolean>;
  getDrizzle: () => unknown;
}

/** The key a state is answered under: one slug may name one of each kind. */
export function removedEntityKey(
  kind: RemovableEntityKind,
  slug: string
): string {
  return `${kind}:${slug}`;
}

/**
 * Each app migration file, oldest first, with the tables its UP statements
 * drop, lower-cased.
 *
 * Read with the code `nextly migrate` runs a file by: the same discovery and
 * dialect variant, the same UP section, the same statement splitter, and the
 * drop guard's reading of a statement's dropped tables. Loaded on demand, so
 * only a request that has a removed entity to describe pays for it.
 */
async function migrationDrops(
  migrationsDir: string,
  dialect: SupportedDialect
): Promise<{ file: string; dropped: ReadonlySet<string> }[]> {
  const groups = await discoverMigrationGroups(migrationsDir);
  if (groups.size === 0) return [];
  const [
    { parseSqlSections },
    { splitSqlStatements, marksNoTransaction },
    { tablesDroppedIn },
  ] = await Promise.all([
    import("../../../cli/commands/migrate"),
    import("../../schema/migrate/split-sql"),
    import("../../schema/ownership/drop-guard"),
  ]);
  const files: { file: string; dropped: ReadonlySet<string> }[] = [];
  for (const baseName of getSortedBaseNames(groups)) {
    const variant = selectVariant(
      groups.get(baseName)?.variants ?? [],
      dialect
    );
    if (variant === undefined) continue;
    let content: string;
    try {
      content = await readFile(resolve(migrationsDir, variant), "utf-8");
    } catch {
      // A file that cannot be read is not evidence of a drop either way.
      continue;
    }
    const statements = splitSqlStatements(
      parseSqlSections(content).upSql,
      dialect,
      { transaction: !marksNoTransaction(content) }
    );
    const dropped = new Set(
      statements.flatMap(statement => tablesDroppedIn(statement, dialect))
    );
    files.push({ file: `${baseName}.sql`, dropped });
  }
  return files;
}

/**
 * The app's migrations' ledger state, by ledger filename: the newest
 * `file_apply` event per file decides, as everywhere the ledger is read. A
 * database with no ledger yet has applied nothing.
 */
async function ledgerStates(
  adapter: RetirementAdapter
): Promise<ReadonlyMap<string, MigrationLedgerState>> {
  if (!(await adapter.tableExists("nextly_schema_events"))) return new Map();
  const [
    { SchemaEventsRepository },
    { newestEventsByFilename },
    { scopeLedgerRows },
    { attemptUnfinished },
  ] = await Promise.all([
    import("../../schema/events/schema-events-repository"),
    import("../../schema/events/newest-event"),
    import("../../schema/events/ledger-scope"),
    import("../../schema/migrate/drift-reconcile"),
  ]);
  const rows = await new SchemaEventsRepository(
    adapter.getDrizzle(),
    adapter.dialect
  ).listFileApplies();
  const states = new Map<string, MigrationLedgerState>();
  for (const [filename, event] of newestEventsByFilename(
    scopeLedgerRows(rows)
  )) {
    states.set(
      filename,
      event.status === "applied"
        ? "applied"
        : attemptUnfinished(event)
          ? "stopped"
          : "pending"
    );
  }
  return states;
}

/**
 * The state of each removed entity, keyed by {@link removedEntityKey}.
 *
 * The migrations and the ledger are read once for all of them, and nothing at
 * all is read when there are none, which is every request on an install with
 * nothing removed.
 */
export async function readRemovedFromCodeStates(args: {
  adapter: RetirementAdapter;
  migrationsDir: string;
  entities: readonly RemovedEntityRef[];
}): Promise<Map<string, RemovedFromCodeState>> {
  const states = new Map<string, RemovedFromCodeState>();
  if (args.entities.length === 0) return states;
  const [files, ledger] = await Promise.all([
    migrationDrops(args.migrationsDir, args.adapter.dialect),
    ledgerStates(args.adapter),
  ]);
  for (const entity of args.entities) {
    const table = entity.tableName.toLowerCase();
    const drops = files
      .filter(file => file.dropped.has(table))
      .map(file => ({
        file: file.file,
        ledger: ledger.get(file.file) ?? "pending",
      }));
    states.set(
      removedEntityKey(entity.kind, entity.slug),
      removedFromCodeState({
        mainTablePresent: await args.adapter.tableExists(entity.tableName),
        drops,
      })
    );
  }
  return states;
}
