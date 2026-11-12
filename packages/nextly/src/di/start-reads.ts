/**
 * What a production start reads once and hands every step that asks: the catalog
 * (`domains/schema/pipeline/diff/start-catalog-scope`) and the three Schema Builder registries.
 *
 * The start used to read each registry four or five times (to register the runtime tables, for
 * the stored webhook policies, for the per-language layout check, for the Builder entities the
 * plugins extend), one statement after another, and to ask the catalog the same questions from
 * several places. A production start writes no registry row and changes no table, so one reading
 * of each serves them all, and the reads go together: the relations and the collections' and
 * Singles' registries first, then the columns, indexes and constraints and the field groups'
 * registry, whose name the relations decide.
 *
 * Only a production start opens them (`isProductionStart`); a development start writes the
 * registry between its reads and keeps reading it as before. They are closed before the
 * migrations at start, which change both, and whenever the registration ends.
 *
 * @module di/start-reads
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { resolveFieldGroupRegistryName } from "../domains/field-groups/storage/resolve-storage-names";
import { readStartCatalog } from "../domains/schema/pipeline/diff/start-catalog";
import {
  closeStartCatalog,
  openStartCatalog,
  tableExistsAtStart,
  type StartCatalog,
} from "../domains/schema/pipeline/diff/start-catalog-scope";

/** One registry table as the start read it. */
export interface RegistryRead {
  /** Whether the table is there, as `adapter.tableExists` would answer. */
  exists: boolean;
  /**
   * Its columns, as the catalog reports them; undefined when the catalog does not describe it, and
   * a reader then reads the table itself, as it did before.
   */
  columns: ReadonlySet<string> | undefined;
  /** Every row, every column (`SELECT *`), read once; rejects as the read did. */
  rows(): Promise<Record<string, unknown>[]>;
}

/** The registries a production start read once, by table name. */
export interface StartRegistry {
  read(table: string): Promise<RegistryRead>;
}

interface OpenStartReads {
  db: unknown;
  registry: StartRegistry;
}

const globalForStartReads = globalThis as unknown as {
  __nextly_startReads?: OpenStartReads;
};

/**
 * Begin a production start's shared reads through `adapter`, replacing any still open. The reads
 * that need nothing else start at once, together.
 */
export function beginStartReads(adapter: DrizzleAdapter): StartRegistry {
  endStartReads();
  const db = adapter.getDrizzle();
  const catalog = readStartCatalog(db, adapter.getCapabilities().dialect);
  openStartCatalog(db, catalog);
  const registry = startRegistry(adapter, catalog);
  globalForStartReads.__nextly_startReads = { db, registry };
  return registry;
}

/** The registries of the production start under way, when one is. */
export function startRegistryNow(): StartRegistry | undefined {
  return globalForStartReads.__nextly_startReads?.registry;
}

/** Close the start's shared reads: every later question reads the database again. */
export function endStartReads(): void {
  const open = globalForStartReads.__nextly_startReads;
  if (open === undefined) return;
  globalForStartReads.__nextly_startReads = undefined;
  closeStartCatalog(open.db);
}

function startRegistry(
  adapter: DrizzleAdapter,
  catalog: StartCatalog
): StartRegistry {
  const rowsByTable = new Map<string, Promise<Record<string, unknown>[]>>();
  const rowsOf = (table: string): Promise<Record<string, unknown>[]> => {
    let rows = rowsByTable.get(table);
    if (rows === undefined) {
      // Every column, so each reader takes the ones it needs and a registry older than the code
      // simply lacks the newest; the table name is one of the registry's own.
      rows = adapter.executeQuery<Record<string, unknown>>(
        `SELECT * FROM ${table}`
      );
      // Awaited by the steps that read it; a registry no step reads must not end the process.
      rows.catch(() => {});
      rowsByTable.set(table, rows);
    }
    return rows;
  };
  // Asked for at once: the two registries every set-up database has, beside the catalog's first
  // read. One that is not there fails its read, and `exists` says so before anyone reads it.
  void rowsOf("dynamic_collections");
  void rowsOf("dynamic_singles");
  // The field groups' registry as soon as the relations name it.
  resolveFieldGroupRegistryName(adapter).then(
    table => void rowsOf(table),
    () => {}
  );
  return {
    async read(table) {
      const [exists, snapshot] = await Promise.all([
        tableExistsAtStart(adapter, table),
        catalog.snapshot,
      ]);
      const spec = snapshot.tables.find(entry => entry.name === table);
      return {
        exists,
        columns: spec
          ? new Set(spec.columns.map(column => column.name))
          : undefined,
        rows: () => rowsOf(table),
      };
    },
  };
}

/**
 * Run independent start steps together where the database serves them concurrently, one after
 * another on SQLite: its driver is synchronous, so nothing is gained there, and two steps that
 * each open a transaction would share its one connection.
 */
export async function runStartStepsTogether(
  dialect: string,
  steps: ReadonlyArray<() => Promise<unknown>>
): Promise<void> {
  if (dialect === "sqlite") {
    for (const step of steps) await step();
    return;
  }
  await Promise.all(steps.map(step => step()));
}
