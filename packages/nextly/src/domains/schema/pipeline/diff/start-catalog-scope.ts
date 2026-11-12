/**
 * The catalog a production start reads once and asks every structural question of: which tables
 * there are, what their columns, indexes and constraints are, and how the server compares names.
 *
 * A start asks the catalog the same kinds of question from several places (the retired
 * `access_rules` warning, the field groups' discriminator columns, the per-language layout check,
 * the registry's own name, whether the database is set up at all). Each used to read it again,
 * a few round trips apiece, and on SQLite once per table, so the start's waits grew with the
 * number of field groups. A production start changes no table, so one reading answers them all.
 *
 * Kept by the Drizzle handle the questions are asked through, and only while a production start
 * holds it open (`di/start-reads`): a question asked through any other handle, or by a
 * development start, a command or a request, reads the catalog as before. This module holds the
 * state alone and imports nothing that reads, so the readers it serves can import it.
 *
 * @module domains/schema/pipeline/diff/start-catalog-scope
 */
import type { IdentifierCaseRules } from "../../utils/resolve-catalog-name";

import type { NextlySchemaSnapshot } from "./types";

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
  /** The columns, indexes and constraints of every reachable relation. */
  snapshot: Promise<NextlySchemaSnapshot>;
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
