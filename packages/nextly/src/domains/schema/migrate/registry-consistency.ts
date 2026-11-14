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
 * And, where the migrations folder is given, a fourth: a row that differs
 * from the newest applied migration's record of it, or is missing though
 * that record holds it. A production start of an earlier release rewrote
 * every row from its own configuration, so one still serving while a new
 * deployment migrated could leave rows behind; a start of this release
 * writes none, so they stay behind until `nextly migrate` runs. Judged by
 * the registry writer itself (`rowsBehindSource`), so a row named here is
 * exactly one `nextly migrate` would write.
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
import { liveColumnNames } from "../pipeline/diff/introspect-live";
import {
  builtByFor,
  isCodeOwned,
  type RegisteredCollectionRow,
} from "../pipeline/registered-collections";
import {
  getColumnDescriptor,
  getComponentRowColumnDescriptor,
} from "../services/field-column-descriptor";

import { configWatchAllowed } from "../../../runtime/hmr-listener";
import { SchemaEventsRepository } from "../events/schema-events-repository";

import { readRegistrySource } from "./registry-source";
import { rowsBehindSource, type RowBehindSource } from "./registry-writer";
import type { EntityKind } from "./resolved-schema";
import type { IsAppliedFn } from "./snapshot-source";

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
   * Rows that differ from the newest applied migration's record of them, or
   * that record holds and the registry lacks (`rowsBehindSource`). Empty
   * where no migrations folder was given, or its newest applied migration
   * records no registry.
   */
  behindSnapshot: RowBehindSource[];
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
    behindSnapshot: [],
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
  /**
   * The app's migrations folder and the ledger's answer to whether each of
   * its migrations is applied: given, the rows are also compared with the
   * newest applied migration's record of them (`behindSnapshot`).
   */
  migrations?: { dir: string; isApplied: IsAppliedFn };
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
  const live = await liveColumnNames(adapter.getDrizzle(), dialect, tables);

  const result = compareRegistryWithTables({
    rows,
    live,
    declared: args.declared,
    dialect,
  });
  if (args.migrations === undefined) return result;
  return withRowsBehindSnapshot(result, {
    adapter,
    logger: serviceLogger,
    migrations: args.migrations,
  });
}

/**
 * `result` with the rows behind the newest applied migration's record
 * (`behindSnapshot`). An entity whose row is missing is named there, where
 * `nextly migrate` writes it, and no longer as unregistered. A row the writer
 * could not judge is passed over and logged at debug level: the comparison
 * only reads, and a row it cannot judge is one `nextly migrate` would report
 * when it tried to write it.
 */
async function withRowsBehindSnapshot(
  result: RegistryDisagreements,
  args: {
    adapter: DrizzleAdapter;
    logger: Logger;
    migrations: { dir: string; isApplied: IsAppliedFn };
  }
): Promise<RegistryDisagreements> {
  const source = await readRegistrySource({
    migrationsDir: args.migrations.dir,
    isApplied: args.migrations.isApplied,
  });
  if (source.kind !== "snapshot") return result;
  const { behind, failed } = await rowsBehindSource(source, {
    adapter: args.adapter,
    logger: args.logger,
  });
  for (const row of failed) {
    args.logger.debug(`Could not compare the registry row of ${row}.`);
  }
  // A kind whose registry could not be read has no rows to compare.
  const judged = behind.filter(row => !result.unreadable.includes(row.kind));
  const missing = new Set(
    judged
      .filter(row => row.row === "missing")
      .map(row => `${row.kind}:${row.slug}`)
  );
  return {
    ...result,
    unregistered: result.unregistered.filter(
      entity => !missing.has(`${entity.kind}:${entity.slug}`)
    ),
    behindSnapshot: judged,
  };
}

/**
 * The migrations a command compares the registry rows with
 * (`findRegistryDisagreements`'s `migrations`): the app's folder, and the
 * ledger's answer to whether each is applied, asked once per file. None
 * where a live sync keeps the rows in step with the code as it is edited
 * (`next dev`): there a row differs from the newest applied migration by
 * design until the next `migrate:create`, and `nextly migrate` leaves it.
 */
export function migrationsToCompare(
  adapter: DrizzleAdapter,
  dialect: SupportedDialect,
  dir: string
): { dir: string; isApplied: IsAppliedFn } | undefined {
  if (configWatchAllowed()) return undefined;
  const events = new SchemaEventsRepository(adapter.getDrizzle(), dialect);
  const answers = new Map<string, Promise<boolean>>();
  return {
    dir,
    isApplied: filename => {
      let answer = answers.get(filename);
      if (answer === undefined) {
        answer = events.isFileApplied(filename);
        answers.set(filename, answer);
      }
      return answer;
    },
  };
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
    ...report.behindSnapshot.map(behindSnapshotLine),
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

/** What differs in a row behind the record: the fields each side lacks. */
function differences(row: RowBehindSource): string {
  const parts = [
    ...row.missingFields.map(name => `missing field "${name}"`),
    ...row.extraFields.map(name => `field "${name}" not in the record`),
  ];
  return parts.length === 0 ? "its settings differ" : parts.join(", ");
}

/** The line naming one row behind the newest applied migration's record. */
function behindSnapshotLine(row: RowBehindSource): string {
  return row.row === "missing"
    ? `${kindLabel(row.kind)} "${row.slug}": it has no registry row, though the newest applied migration records it. Run \`nextly migrate\` to write it.`
    : `${kindLabel(row.kind)} "${row.slug}": its registry row differs from the newest applied migration's record of it (${differences(row)}). Run \`nextly migrate\` to bring it back.`;
}
