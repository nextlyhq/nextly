/**
 * What a production start reads of the catalog once and answers from: which relations there
 * are, and how the server compares table names.
 *
 * A start asks whether a table exists, and which tables there are, from several places (the
 * empty-database refusal and the first-run probe, the field groups' registry name, the
 * per-language layout check, the Schema Builder registries), each a round trip of its own, and
 * on MySQL reads how the server compares names each time. A production start changes no table,
 * so one listing answers them all. While the start holds it open, the schema reads it still
 * makes (a few tables' columns, for the checks a production start keeps) send their catalog
 * queries together (`introspect-live`).
 *
 * Kept by the Drizzle handle the questions are asked through, and only while a production start
 * holds it open (`di/start-reads`): a question asked through any other handle, or by a
 * development start, a command or a request, reads the catalog as before. This module holds the
 * state alone and imports nothing that reads, so the readers it serves can import it.
 *
 * @module domains/schema/pipeline/diff/start-catalog-scope
 */
import type { IdentifierCaseRules } from "../../utils/resolve-catalog-name";

/** One relation as the start's catalog lists it. */
export interface StartCatalogRelation {
  name: string;
  /** A base table, as `listTables` lists them; a view is listed too, but is not one. */
  baseTable: boolean;
  /**
   * Whether `adapter.listTables()` names it: on PostgreSQL a base table of the `public` schema,
   * elsewhere every base table it lists.
   */
  listed: boolean;
  /**
   * Whether `adapter.tableExists(name)` answers true for it: on PostgreSQL the relation an
   * unqualified statement reaches; elsewhere every relation of the database.
   */
  reachable: boolean;
}

/** What one production start read of the catalog, each part read once and shared. */
export interface StartCatalog {
  relations: Promise<readonly StartCatalogRelation[]>;
  /** How this server compares table and column names (one read, on MySQL only). */
  caseRules: Promise<IdentifierCaseRules>;
}

const globalForCatalog = globalThis as unknown as {
  __nextly_startCatalogs?: WeakMap<object, StartCatalog>;
};

function catalogs(): WeakMap<object, StartCatalog> {
  globalForCatalog.__nextly_startCatalogs ??= new WeakMap();
  return globalForCatalog.__nextly_startCatalogs;
}

/** Serve the catalog questions asked through `db` from `catalog` until it is closed. */
export function openStartCatalog(db: unknown, catalog: StartCatalog): void {
  if (typeof db === "object" && db !== null) catalogs().set(db, catalog);
}

/** Stop serving `db`'s questions from the start's reading: they read the catalog again. */
export function closeStartCatalog(db: unknown): void {
  if (typeof db === "object" && db !== null) catalogs().delete(db);
}

/** The start's reading of the catalog for `db`, while one is open. */
export function startCatalogOf(db: unknown): StartCatalog | undefined {
  return typeof db === "object" && db !== null ? catalogs().get(db) : undefined;
}

/** What the table helpers below need of an adapter. */
interface TableCatalogAdapter {
  getDrizzle(): unknown;
  tableExists(name: string): Promise<boolean>;
  listTables(): Promise<string[]>;
}

/**
 * `adapter.tableExists(name)`, answered from the start's catalog while one is open. Compared as
 * the adapter's own query compares: exactly (SQLite's `name = ?` included), except on a MySQL
 * server that folds table names.
 */
export async function tableExistsAtStart(
  adapter: Pick<TableCatalogAdapter, "tableExists"> &
    Partial<Pick<TableCatalogAdapter, "getDrizzle">>,
  name: string
): Promise<boolean> {
  const catalog =
    typeof adapter.getDrizzle === "function"
      ? startCatalogOf(adapter.getDrizzle())
      : undefined;
  if (catalog === undefined) return adapter.tableExists(name);
  const [relations, rules] = await Promise.all([
    catalog.relations,
    catalog.caseRules,
  ]);
  const folds = rules.tables === "fold-unicode";
  const wanted = folds ? name.toLowerCase() : name;
  return relations.some(
    relation =>
      relation.reachable &&
      (folds ? relation.name.toLowerCase() : relation.name) === wanted
  );
}

/** `adapter.listTables()`, answered from the start's catalog while one is open. */
export async function listTablesAtStart(
  adapter: Pick<TableCatalogAdapter, "listTables"> &
    Partial<Pick<TableCatalogAdapter, "getDrizzle">>
): Promise<string[]> {
  const catalog =
    typeof adapter.getDrizzle === "function"
      ? startCatalogOf(adapter.getDrizzle())
      : undefined;
  if (catalog === undefined) return adapter.listTables();
  return (await catalog.relations)
    .filter(relation => relation.listed)
    .map(relation => relation.name)
    .sort();
}
