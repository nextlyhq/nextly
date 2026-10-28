/**
 * Where the registry and the tables disagree, read and never repaired.
 *
 * The registry (`dynamic_collections`, `dynamic_singles` and the field-group
 * registry) is what a running instance serves from: a row names an entity's
 * table and records its fields. Nothing at a production start compares that
 * with the database, so three disagreements reach requests unannounced:
 *
 * - a row whose table does not exist, so every read and write of the entity
 *   fails;
 * - a field a row records whose column does not exist, so every read that
 *   selects it fails (a plugin's new field whose column was never added);
 * - an entity the configuration declares that has no row, so the instance
 *   does not know it.
 *
 * `nextly migrate`, once it has finished, and `nextly migrate:status` name
 * each one. Both report from {@link findRegistryDisagreements} and print
 * through {@link registryDisagreementLines}, so the two commands cannot
 * describe the same database differently.
 *
 * It only reads: the registry rows, and the live columns of the tables they
 * name through the introspection the schema diff uses (one catalog query for
 * every table, or one `PRAGMA` per table on SQLite).
 *
 * **Runtime restriction (F11):** CLI only; never import from runtime code.
 *
 * @module domains/schema/migrate/registry-consistency
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import type { Logger } from "../../../shared/types";
import { CollectionRegistryService } from "../../collections/services/collection-registry-service";
import { FieldGroupRegistryService } from "../../field-groups/services/field-group-registry-service";
import { resolveLocalizedFieldNames } from "../../i18n/classify-fields";
import { SingleRegistryService } from "../../singles/services/single-registry-service";
import { introspectLiveColumns } from "../pipeline/diff/introspect-live";
import {
  builtByFor,
  isCodeOwned,
  type RegisteredCollectionRow,
} from "../pipeline/registered-collections";
import {
  getColumnDescriptor,
  getComponentRowColumnDescriptor,
} from "../services/field-column-descriptor";

import type { EntityKind } from "./resolved-schema";

/** A registry row whose table does not exist. */
interface MissingTable {
  kind: EntityKind;
  slug: string;
  table: string;
}

/** A field a registry row records whose column its table does not have. */
interface MissingColumn {
  kind: EntityKind;
  slug: string;
  table: string;
  field: string;
  column: string;
}

/** An entity the configuration declares that has no registry row. */
interface UnregisteredEntity {
  kind: EntityKind;
  slug: string;
}

export interface RegistryDisagreements {
  missingTables: MissingTable[];
  missingColumns: MissingColumn[];
  unregistered: UnregisteredEntity[];
  /**
   * Registries that could not be read, so their rows were not compared and
   * their kind's declared entities were not looked for. Listed because a
   * registry that could not be read and one that agrees would otherwise both
   * report nothing.
   */
  unreadable: EntityKind[];
}

/** A registry row, as much of it as the comparison reads. */
type RegistryRow = RegisteredCollectionRow;

/** Each registry's rows, or `null` for one that could not be read. */
export type RegistryRows = ReadonlyMap<
  EntityKind,
  readonly RegistryRow[] | null
>;

/** The live columns of each live table, by lower-cased table name. */
export type LiveColumns = ReadonlyMap<string, ReadonlySet<string>>;

const KINDS: readonly EntityKind[] = ["collection", "single", "fieldGroup"];

/**
 * The column a field a registry row records occupies on its entity's table,
 * or null for a field stored elsewhere: a field group's or a many-to-many's
 * own table, nothing for a virtual field, or the `_locales` companion for a
 * translatable field of a localized entity.
 *
 * Asked of the column descriptor, the one answer to which fields have a
 * column and what it is called. A field group's row answers the component
 * question, where a many-to-many keeps its ids on the row.
 */
function columnOf(
  field: unknown,
  kind: EntityKind,
  row: RegistryRow,
  localized: ReadonlySet<string>,
  dialect: SupportedDialect
): string | null {
  if (typeof field !== "object" || field === null) return null;
  const name = (field as { name?: unknown }).name;
  if (typeof name !== "string" || name === "") return null;
  if (localized.has(name)) return null;
  const describe =
    kind === "fieldGroup"
      ? getComponentRowColumnDescriptor
      : getColumnDescriptor;
  const descriptor = describe(
    // A stored field has the shape the descriptor reads; the registry types
    // it as FieldConfig, which is structural to it but nominally apart.
    field as Parameters<typeof describe>[0],
    dialect,
    builtByFor(kind, !isCodeOwned(row))
  );
  return descriptor?.name ?? null;
}

/** The names of a row's fields that live in its `_locales` companion. */
function localizedNamesOf(row: RegistryRow): ReadonlySet<string> {
  const fields = (row.fields ?? []).filter(
    (field): field is { type: string; name: string } =>
      typeof field === "object" &&
      field !== null &&
      typeof (field as { type?: unknown }).type === "string" &&
      typeof (field as { name?: unknown }).name === "string"
  );
  return new Set(resolveLocalizedFieldNames(fields, row.localized === true));
}

/**
 * The fields `row` records whose column its live table, `columns`, lacks.
 */
function missingColumnsOf(
  kind: EntityKind,
  row: RegistryRow & { slug: string; tableName: string },
  columns: ReadonlySet<string>,
  dialect: SupportedDialect
): MissingColumn[] {
  const localized = localizedNamesOf(row);
  const missing: MissingColumn[] = [];
  for (const field of row.fields ?? []) {
    const column = columnOf(field, kind, row, localized, dialect);
    if (column === null || columns.has(column.toLowerCase())) continue;
    missing.push({
      kind,
      slug: row.slug,
      table: row.tableName,
      field: (field as { name: string }).name,
      column,
    });
  }
  return missing;
}

/**
 * One registry's rows against the live tables: each row whose table is
 * missing, and otherwise each recorded field whose column is. A row that
 * names no table is skipped: it identifies no table to look for. The table
 * is matched without regard to case, as MySQL's catalog may report it.
 */
function compareRows(
  kind: EntityKind,
  rows: readonly RegistryRow[],
  live: LiveColumns,
  dialect: SupportedDialect,
  result: RegistryDisagreements
): void {
  for (const row of rows) {
    const { slug, tableName } = row;
    if (!slug || !tableName) continue;
    const columns = live.get(tableName.toLowerCase());
    if (columns === undefined) {
      result.missingTables.push({ kind, slug, table: tableName });
      continue;
    }
    result.missingColumns.push(
      ...missingColumnsOf(kind, { ...row, slug, tableName }, columns, dialect)
    );
  }
}

/**
 * Compare registry rows with the live tables and the declared entities.
 *
 * Pure, so the rules are judged apart from the reads. A declared entity is
 * looked for in its own kind's registry only: one slug may name an entity of
 * each kind.
 */
export function compareRegistryWithTables(args: {
  rows: RegistryRows;
  live: LiveColumns;
  declared: readonly { kind: EntityKind; slug: string }[];
  dialect: SupportedDialect;
}): RegistryDisagreements {
  const result: RegistryDisagreements = {
    missingTables: [],
    missingColumns: [],
    unregistered: [],
    unreadable: [],
  };

  for (const kind of KINDS) {
    const rows = args.rows.get(kind) ?? null;
    if (rows === null) {
      result.unreadable.push(kind);
      continue;
    }
    compareRows(kind, rows, args.live, args.dialect, result);
    const registered = new Set(rows.map(row => row.slug));
    result.unregistered.push(
      ...args.declared
        .filter(e => e.kind === kind && !registered.has(e.slug))
        .map(e => ({ kind, slug: e.slug }))
    );
  }

  return result;
}

/**
 * Read the registry and the tables its rows name, and compare them with the
 * declared entities.
 *
 * Returns null when the database has no collection registry yet: no Nextly
 * schema has been created there, so there are no rows to compare, and every
 * declared entity reported as unregistered would only restate that.
 *
 * Each registry is read on its own, so one that cannot be read costs only its
 * own comparison and is listed in `unreadable`. The adapter must resolve
 * registry tables by name (`installRegistryResolver`).
 */
export async function findRegistryDisagreements(args: {
  adapter: DrizzleAdapter;
  dialect: SupportedDialect;
  declared: readonly { kind: EntityKind; slug: string }[];
  logger: { debug: (message: string) => void };
}): Promise<RegistryDisagreements | null> {
  const { adapter, dialect } = args;
  if (!(await adapter.tableExists("dynamic_collections"))) return null;

  // The services log with a metadata argument the CLI's logger has no
  // parameter for, and nothing they log here is a finding: their messages go
  // to debug output.
  const debug = (message: string) => args.logger.debug(message);
  const serviceLogger: Logger = {
    debug,
    info: debug,
    warn: debug,
    error: debug,
  };
  const readers: Record<EntityKind, () => Promise<readonly RegistryRow[]>> = {
    collection: () =>
      new CollectionRegistryService(adapter, serviceLogger).getAllCollections(),
    single: () =>
      new SingleRegistryService(adapter, serviceLogger).getAllSingles(),
    fieldGroup: () =>
      new FieldGroupRegistryService(adapter, serviceLogger).getAllComponents(),
  };

  const rows = new Map<EntityKind, readonly RegistryRow[] | null>();
  for (const kind of KINDS) {
    try {
      rows.set(kind, await readers[kind]());
    } catch (error) {
      rows.set(kind, null);
      args.logger.debug(
        `Could not read the ${kindLabel(kind)} registry: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  const tables = [
    ...new Set(
      [...rows.values()]
        .flatMap(list => list ?? [])
        .map(row => row.tableName)
        .filter((name): name is string => typeof name === "string" && !!name)
    ),
  ];
  const snapshot = await introspectLiveColumns(
    adapter.getDrizzle(),
    dialect,
    tables
  );
  const live = new Map(
    snapshot.tables.map(table => [
      table.name.toLowerCase(),
      new Set(table.columns.map(column => column.name.toLowerCase())),
    ])
  );

  return compareRegistryWithTables({
    rows,
    live,
    declared: args.declared,
    dialect,
  });
}

/** How a kind is named in what the commands print. */
function kindLabel(kind: EntityKind): string {
  return kind === "fieldGroup" ? "field group" : kind;
}

/**
 * One line per disagreement, each naming the entity first. Empty when there
 * is nothing to say, a database with no registry yet (`null`) included.
 *
 * The commands that add a missing table or column follow the lines naming
 * them. An entity with no row gets none: `nextly migrate` registers an entity
 * only from a migration snapshot that describes it, which a `migrate:create`
 * snapshot does not, so naming it there would send an operator to a command
 * that leaves the row missing.
 */
export function registryDisagreementLines(
  report: RegistryDisagreements | null
): string[] {
  if (report === null) return [];
  const lines: string[] = [
    ...report.missingTables.map(
      d =>
        `${kindLabel(d.kind)} "${d.slug}": its registry row names table "${d.table}", which does not exist.`
    ),
    ...report.missingColumns.map(
      d =>
        `${kindLabel(d.kind)} "${d.slug}": field "${d.field}" has no column "${d.column}" in table "${d.table}".`
    ),
  ];
  if (lines.length > 0) {
    lines.push(
      "The database has not been migrated for the tables and columns above. Run `nextly migrate:create` for a change that has no migration yet, then `nextly migrate`."
    );
  }
  lines.push(
    ...report.unregistered.map(
      d =>
        `${kindLabel(d.kind)} "${d.slug}" is declared in the configuration but has no registry row.`
    ),
    ...report.unreadable.map(
      kind =>
        `Could not read the ${kindLabel(kind)} registry, so its rows were not compared with the tables.`
    )
  );
  return lines;
}
