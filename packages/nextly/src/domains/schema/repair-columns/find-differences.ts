// Find every column whose type or nullability differs from its field's descriptor.
//
// Read-only: it introspects the live tables once, reads the rows of each differing column to class
// it, and changes nothing in the database. Each column is judged against its field AS THE DATABASE
// LAST HAD IT APPLIED, never against a newer
// configuration, because a change the configuration holds and no migration has applied is that
// migration's to make: converting the column towards it here would let a repair stand in for a
// reviewed migration file. Such a change is reported on its own record, so the owner sees both what
// is wrong with the column today and what the next migration will do to it.
//
// @module domains/schema/repair-columns/find-differences

import { sql } from "drizzle-orm";

import { isNextlyOwnedDocumentColumn } from "../../../lib/system-columns";
import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import { resolveLocalizedFieldNames } from "../../i18n/classify-fields";
import { storesPerLanguage } from "../../i18n/per-language-storage";
import { querySqlRows } from "../pipeline/classifier/count-helpers";
import { introspectLiveColumns } from "../pipeline/diff/introspect-live";
import type { ColumnSpec } from "../pipeline/diff/types";
import {
  getColumnDescriptor,
  getComponentRowColumnDescriptor,
  type SupportedDialect,
} from "../services/field-column-descriptor";
import { keyedByOf, type KeyedBy } from "../value-conversion/read-values";

import { classifyDifference, planDifference } from "./classify";
import { compareColumn } from "./column-comparison";
import type { ColumnConversionPlan } from "./conversion/types";
import { differenceCause } from "./difference-cause";
import type { TableLockFacts } from "./outcome";
import type { TableWaits } from "./table-wait";
import type {
  ColumnFinding,
  ColumnLocation,
  ColumnState,
  EntityDefinition,
  RepairColumnOrigin,
  RepairEntity,
} from "./types";
import { userFieldColumn } from "./user-field-columns";

/** The table a localized entity keeps its translatable fields in. */
function translationTableOf(table: string): string {
  return `${table}_locales`;
}

/** One column a definition names: where it is, which field it holds, and its expected state. */
interface NamedColumn {
  location: ColumnLocation;
  field: FieldDefinition;
  expected: ColumnState;
}

/**
 * One field's column as the builder `origin` names makes it: its name, type and nullability, or
 * null where that builder gives the field no column.
 *
 * `user_ext` has its own builder, which is asked directly. Every other table is built from the
 * descriptor: a field-group row answers the component question, where a many-to-many keeps its ids
 * on the row, and a translation table the plain question whatever the entity, as its own builder
 * does.
 */
function describeColumn(
  entity: RepairEntity,
  origin: RepairColumnOrigin,
  field: FieldDefinition,
  translation: boolean,
  dialect: SupportedDialect
): (ColumnState & { name: string }) | null {
  if (origin === "userFields") return userFieldColumn(field, dialect);
  const describe =
    entity.kind === "fieldGroup" && !translation
      ? getComponentRowColumnDescriptor
      : getColumnDescriptor;
  const descriptor = describe(field, dialect, origin);
  return descriptor === null
    ? null
    : {
        name: descriptor.name,
        type: descriptor.dialectType,
        nullable: descriptor.nullable,
      };
}

/**
 * The column one field names, on the entity's own table or in its translation table, or null where
 * the field has no column.
 */
function namedColumn(
  entity: RepairEntity,
  origin: RepairColumnOrigin,
  field: FieldDefinition,
  translation: boolean,
  dialect: SupportedDialect
): NamedColumn | null {
  const column = describeColumn(entity, origin, field, translation, dialect);
  if (column === null) return null;
  return {
    location: {
      kind: entity.kind,
      slug: entity.slug,
      field: field.name,
      table: translation ? translationTableOf(entity.table) : entity.table,
      column: column.name,
      translation,
    },
    field,
    expected: {
      type: column.type,
      // The translation table's builder makes every field column nullable, a required field's
      // included: a translatable field's `required` is enforced by the application, not by its
      // column. So nullable is what that table holds, whatever the descriptor says.
      nullable: translation ? true : column.nullable,
    },
  };
}

/**
 * Every column a definition's fields name, in field order: on the entity's own table, or in its
 * translation table for a translatable field of a localized entity.
 *
 * Asked of the descriptor as the definition's own builder answers it, the one answer to which
 * fields have a column and what it is.
 */
function columnsNamedBy(
  entity: RepairEntity,
  definition: EntityDefinition,
  dialect: SupportedDialect
): NamedColumn[] {
  // Kept per language when the entity is translated, or for every entity under the setting.
  const translatable = storesPerLanguage(definition)
    ? new Set(resolveLocalizedFieldNames([...definition.fields], true))
    : new Set<string>();
  const columns: NamedColumn[] = [];
  for (const field of definition.fields) {
    if (typeof field?.name !== "string" || field.name === "") continue;
    const column = namedColumn(
      entity,
      definition.origin,
      field,
      translatable.has(field.name),
      dialect
    );
    if (column !== null) columns.push(column);
  }
  return columns;
}

/** One live table: its name as the database spells it, and its columns by lower-cased name. */
interface LiveTable {
  name: string;
  columns: ReadonlyMap<string, ColumnSpec>;
}

/** The live tables, by lower-cased name. */
type LiveTables = ReadonlyMap<string, LiveTable>;

const key = (table: string, column: string) =>
  `${table.toLowerCase()}\u0000${column.toLowerCase()}`;

/** A live column's state, as the model carries it. */
function stateOf(spec: ColumnSpec): ColumnState {
  return {
    type: spec.type,
    nullable: spec.nullable,
    ...(spec.typeModifier !== undefined
      ? { typeModifier: spec.typeModifier }
      : {}),
  };
}

/** The live column at a location, or undefined where its table or the column does not exist. */
function liveColumnAt(
  live: LiveTables,
  location: ColumnLocation
): ColumnSpec | undefined {
  return live
    .get(location.table.toLowerCase())
    ?.columns.get(location.column.toLowerCase());
}

/**
 * The table and column at a location as the database spells them, for a query to name, and how the
 * table's rows are keyed, from its primary key.
 */
function liveNamesOf(
  live: LiveTables,
  location: ColumnLocation
): { liveTable: string; liveColumn: string; keyedBy: KeyedBy } {
  const table = live.get(location.table.toLowerCase());
  return {
    keyedBy: keyedByOf([...(table?.columns.values() ?? [])]),
    liveTable: table?.name ?? location.table,
    liveColumn:
      table?.columns.get(location.column.toLowerCase())?.name ??
      location.column,
  };
}

/** A live column's state, or null where the column does not exist, as a pending change holds it. */
function liveStateOf(found: ColumnSpec | undefined): ColumnState | null {
  return found === undefined ? null : stateOf(found);
}

/** The owner a finding names: the plugin that owns its entity, and nothing for any other entity. */
function ownedBy(plugin: string | undefined): { plugin?: string } {
  return plugin !== undefined ? { plugin } : {};
}

/** One entity, with the columns its applied and configured definitions name. */
interface PlannedEntity {
  entity: RepairEntity;
  applied: NamedColumn[] | null;
  configured: NamedColumn[] | null;
}

/** The live columns of every table the planned columns are in, read in one introspection. */
/** Every table the planned columns are in, once each. */
function tableNamesOf(planned: readonly PlannedEntity[]): string[] {
  return [
    ...new Set(
      planned.flatMap(({ applied, configured }) =>
        [...(applied ?? []), ...(configured ?? [])].map(c => c.location.table)
      )
    ),
  ];
}

async function readLiveTables(
  db: unknown,
  dialect: SupportedDialect,
  tableNames: readonly string[]
): Promise<Map<string, LiveTable>> {
  const snapshot = await introspectLiveColumns(db, dialect, [...tableNames]);
  return new Map(
    snapshot.tables.map(table => [
      table.name.toLowerCase(),
      {
        name: table.name,
        // The per-document columns are Nextly's own, added by `nextly
        // migrate` rather than by any field, so no comparison sees them.
        columns: new Map(
          table.columns
            .filter(c => !isNextlyOwnedDocumentColumn(c.name))
            .map(c => [c.name.toLowerCase(), c])
        ),
      },
    ])
  );
}

/**
 * Every difference between the live database and the entities' fields: one record per column, and
 * at most two for one column (its difference from the applied definition, and a pending change).
 *
 * `db` is the adapter's Drizzle instance, as `introspectLiveColumns` reads it.
 */
export async function findColumnDifferences(args: {
  db: unknown;
  dialect: SupportedDialect;
  entities: readonly RepairEntity[];
  /**
   * The run's waits for a table another session is using. Given, each table's rows are read in
   * its tries, and a column whose table's tries run out is reported with the lock rather than
   * classed; on SQLite the definitions are read in the database's tries too. Left out, every
   * read runs once, as a test of the classing alone needs.
   */
  waits?: TableWaits;
}): Promise<ColumnFinding[]> {
  const { db, dialect, entities, waits } = args;

  const namedBy = (
    definition: EntityDefinition | null,
    entity: RepairEntity
  ) =>
    definition === null ? null : columnsNamedBy(entity, definition, dialect);
  const planned = entities.map(
    (entity): PlannedEntity => ({
      entity,
      applied: namedBy(entity.applied, entity),
      configured: namedBy(entity.configured, entity),
    })
  );
  let live: LiveTables;
  let held: ReadonlyMap<string, TableLockFacts>;
  try {
    const read = await readDefinitions(db, dialect, planned, waits);
    if (read.kind === "ran-out") {
      return planned.flatMap(entity =>
        definitionUnreadableFindings(entity, () => read.lock)
      );
    }
    live = read.live;
    held = read.held;
  } catch (error) {
    if (!isDatabaseHeld(error, dialect)) throw error;
    // Another connection holds the whole database, so no table's definition can be read: every
    // column each entity names is reported, and whether it differs is unknown.
    return planned.flatMap(entity => definitionUnreadableFindings(entity));
  }

  // A table's row count is the same for each of its columns, so it is read once per table.
  const countRows = rowCounter(dialect);
  const findings: ColumnFinding[] = [];
  const lockOf = (table: string) => held.get(table.toLowerCase());
  const readable = (columns: NamedColumn[] | null) =>
    columns === null
      ? null
      : columns.filter(c => lockOf(c.location.table) === undefined);
  for (const each of planned) {
    const { entity } = each;
    // A table whose definition its tries could not read: each column its fields name, once.
    const unread = (columns: NamedColumn[] | null) =>
      columns === null
        ? null
        : columns.filter(c => lockOf(c.location.table) !== undefined);
    findings.push(
      ...definitionUnreadableFindings(
        {
          entity,
          applied: unread(each.applied),
          configured: unread(each.configured),
        },
        lockOf
      )
    );
    const applied = readable(each.applied);
    const configured = readable(each.configured);
    if (entity.applied === null || applied === null) {
      findings.push(...awaitingMigrationFindings(entity, configured, live));
      continue;
    }
    findings.push(
      ...(await appliedColumnFindings(
        db,
        entity,
        entity.applied.origin,
        applied,
        live,
        dialect,
        { countRows, waits }
      ))
    );
    if (configured !== null) {
      findings.push(
        ...pendingChanges(applied, configured, live, entity.plugin)
      );
    }
  }
  return findings;
}

/**
 * Whether a read failed because another connection holds the whole database: SQLite's busy or
 * locked answer, which it gives in exclusive locking mode, and which names no table. Read from the
 * driver's code or message on the error or a cause, since Drizzle wraps the driver's error.
 */
function isDatabaseHeld(error: unknown, dialect: SupportedDialect): boolean {
  if (dialect !== "sqlite") return false;
  let link: unknown = error;
  for (
    let depth = 0;
    depth < 5 && typeof link === "object" && link !== null;
    depth++
  ) {
    const { code, message } = link as { code?: unknown; message?: unknown };
    if (code === "SQLITE_BUSY" || code === "SQLITE_LOCKED") return true;
    if (
      typeof message === "string" &&
      /database (?:table )?is locked/i.test(message)
    ) {
      return true;
    }
    link = (link as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * One record for each column an entity names, where the table's definition could not be read: each
 * column its applied definition names, then each one only its configured definition names (a field
 * the configuration adds), once each.
 */
function definitionUnreadableFindings(
  { entity, applied, configured }: PlannedEntity,
  lockOf?: (table: string) => TableLockFacts | undefined
): ColumnFinding[] {
  const named = new Map<string, NamedColumn>();
  for (const column of [...(applied ?? []), ...(configured ?? [])]) {
    const key =
      `${column.location.table}.${column.location.column}`.toLowerCase();
    if (!named.has(key)) named.set(key, column);
  }
  return [...named.values()].map(column => {
    const lock = lockOf?.(column.location.table);
    return {
      kind: "definition-unreadable",
      location: column.location,
      ...ownedBy(entity.plugin),
      expected: column.expected,
      ...(lock === undefined
        ? {}
        : { lock: { ...lock, table: column.location.table } }),
    };
  });
}

/**
 * The columns of an entity awaiting a migration that are not as its configured definition
 * describes them.
 *
 * No record says what was applied, so a column that is not as configured, a missing table
 * included, may be legacy or may be the change the migration will make: the migration decides,
 * and it may still have to be written.
 */
function awaitingMigrationFindings(
  entity: RepairEntity,
  configured: readonly NamedColumn[] | null,
  live: LiveTables
): ColumnFinding[] {
  const findings: ColumnFinding[] = [];
  for (const column of configured ?? []) {
    const found = liveColumnAt(live, column.location);
    if (
      found !== undefined &&
      compareColumn(stateOf(found), column.expected) === null
    ) {
      continue;
    }
    findings.push({
      kind: "pending-migration",
      location: column.location,
      ...ownedBy(entity.plugin),
      applied: null,
      configured: column.expected,
      live: liveStateOf(found),
    });
  }
  return findings;
}

/**
 * Every applied column of one entity that the database lacks or holds differently. `origin` is the
 * applied definition's builder, the one that made the live table.
 *
 * Each differing column is classed from the rows it holds, except one a plugin owns: that column is
 * reported and never changed, so nothing would act on its class.
 */
async function appliedColumnFindings(
  db: unknown,
  entity: RepairEntity,
  origin: RepairColumnOrigin,
  applied: readonly NamedColumn[],
  live: LiveTables,
  dialect: SupportedDialect,
  reads: { countRows: RowCounter; waits: TableWaits | undefined }
): Promise<ColumnFinding[]> {
  const findings: ColumnFinding[] = [];
  for (const column of applied) {
    const finding = judgeAppliedColumn(entity, origin, column, live, dialect);
    if (finding === null) continue;
    if (finding.kind !== "differs" || finding.plugin !== undefined) {
      findings.push(finding);
      continue;
    }
    const difference = {
      kind: entity.kind,
      field: column.field,
      location: finding.location,
      live: finding.live,
      expected: finding.expected,
      ...liveNamesOf(live, finding.location),
    };
    const classed = async (on: unknown) => {
      const judgement = await classifyDifference(on, dialect, difference);
      // What the conversion would run and what the new type cannot keep, read from the same live
      // table, so the report can say both and block what cannot be carried.
      const conversion = await planDifference(
        on,
        dialect,
        difference,
        judgement
      );
      const rowsRewritten = await rowsRewrittenBy(
        table => reads.countRows(on, table),
        difference.liveTable,
        conversion
      );
      return { judgement, conversion, rowsRewritten };
    };
    if (reads.waits === undefined) {
      findings.push({ ...finding, judged: difference, ...(await classed(db)) });
      continue;
    }
    const read = await reads.waits.read(difference.liveTable, classed);
    findings.push(
      read.kind === "done"
        ? { ...finding, judged: difference, ...read.value }
        : // Its rows could not be read: never classed, so never converted.
          { ...finding, judged: difference, lock: read.lock }
    );
  }
  return findings;
}

/**
 * The live columns of every table the entities name, in the database's tries where `waits` is
 * given on SQLite: there what another connection holds is the whole database, which in exclusive
 * locking mode keeps even a table's definition from being read. A server's catalog read waits for
 * no table, so it runs once.
 */
async function readDefinitions(
  db: unknown,
  dialect: SupportedDialect,
  planned: readonly PlannedEntity[],
  waits: TableWaits | undefined
): Promise<
  | {
      kind: "done";
      live: LiveTables;
      /** Each table whose tries ran out before its definition could be read, with the lock. */
      held: ReadonlyMap<string, TableLockFacts>;
    }
  | { kind: "ran-out"; lock: TableLockFacts }
> {
  const names = tableNamesOf(planned);
  const none = new Map<string, TableLockFacts>();
  // MySQL's catalog read waits for no table (measured): it runs once, as with no tries.
  if (waits === undefined || dialect === "mysql") {
    return {
      kind: "done",
      live: await readLiveTables(db, dialect, names),
      held: none,
    };
  }
  if (dialect === "sqlite") {
    const read = await waits.read(names[0] ?? "", on =>
      readLiveTables(on, dialect, names)
    );
    return read.kind === "ran-out"
      ? read
      : { kind: "done", live: read.value, held: none };
  }
  // PostgreSQL: reading a table's definition opens the table, which waits behind another
  // session's change to it, so each table is read in its own tries.
  const live = new Map<string, LiveTable>();
  const held = new Map<string, TableLockFacts>();
  for (const name of names) {
    const read = await waits.read(name, on =>
      readLiveTables(on, dialect, [name])
    );
    if (read.kind === "ran-out") {
      held.set(name.toLowerCase(), read.lock);
      continue;
    }
    for (const [key, table] of read.value) live.set(key, table);
  }
  return { kind: "done", live, held };
}

/**
 * The rows a conversion rewrites: the table's every row where the database rewrites or copies the
 * table to run it, none where it changes the column in place, and null with no conversion. Counted
 * here because the judgement does not always read the rows: a change every value keeps, into a
 * nullable column, reads none.
 */
async function rowsRewrittenBy(
  countRows: (table: string) => Promise<number>,
  table: string,
  conversion: ColumnConversionPlan | null
): Promise<number | null> {
  if (conversion === null) return null;
  if (!conversion.rewritesTable) return 0;
  return countRows(table);
}

/**
 * How many rows a table holds, read at most once per table for one run: each column of a table
 * whose conversion rewrites it rewrites the same rows, and a count can scan the whole table.
 */
function rowCounter(dialect: SupportedDialect): RowCounter {
  const counted = new Map<string, number>();
  return async (db, table) => {
    const known = counted.get(table);
    if (known !== undefined) return known;
    // Kept only once read: a count a try's wait ended is read again by the next try.
    const [row] = await querySqlRows<{ n: unknown }>(
      db,
      dialect,
      sql`SELECT COUNT(*) AS ${sql.identifier("n")} FROM ${sql.identifier(table)}`
    );
    const count = Number(row?.n ?? 0);
    counted.set(table, count);
    return count;
  };
}

/** How many rows a table holds, read through `db`. */
type RowCounter = (db: unknown, table: string) => Promise<number>;

/**
 * How one applied column differs from the live database: missing (with its table, or alone), of
 * another type or nullability, or null where it is as its field describes it. `origin` is the
 * builder that made the table, as the applied definition records it, which is the one whose
 * generator can explain a difference.
 */
function judgeAppliedColumn(
  entity: RepairEntity,
  origin: RepairColumnOrigin,
  column: NamedColumn,
  live: LiveTables,
  dialect: SupportedDialect
): ColumnFinding | null {
  const found = liveColumnAt(live, column.location);
  if (found === undefined) {
    return {
      kind: "not-migrated",
      location: column.location,
      ...ownedBy(entity.plugin),
      missing: live.has(column.location.table.toLowerCase())
        ? "column"
        : "table",
      expected: column.expected,
    };
  }
  const state = stateOf(found);
  const aspects = compareColumn(state, column.expected);
  if (aspects === null) return null;
  return {
    kind: "differs",
    location: column.location,
    ...ownedBy(entity.plugin),
    expected: column.expected,
    live: state,
    aspects,
    judgement: null,
    conversion: null,
    rowsRewritten: null,
    cause: differenceCause({
      field: column.field,
      kind: entity.kind,
      origin,
      dialect,
      translation: column.location.translation,
      live: state,
      expected: column.expected,
    }),
  };
}

/** One column as the applied and the configured definition each name it, where they do. */
interface ColumnPair {
  applied?: NamedColumn;
  configured?: NamedColumn;
}

/** Every column either definition names, paired by table and column, applied ones first. */
function pairColumns(
  applied: readonly NamedColumn[],
  configured: readonly NamedColumn[]
): ColumnPair[] {
  const byKey = new Map<string, ColumnPair>();
  for (const column of applied) {
    byKey.set(key(column.location.table, column.location.column), {
      applied: column,
    });
  }
  for (const column of configured) {
    const at = key(column.location.table, column.location.column);
    byKey.set(at, { ...byKey.get(at), configured: column });
  }
  return [...byKey.values()];
}

/** Whether both definitions name the column and agree on its type and nullability. */
function isUnchanged(pair: ColumnPair): boolean {
  return (
    pair.applied !== undefined &&
    pair.configured !== undefined &&
    compareColumn(pair.applied.expected, pair.configured.expected) === null
  );
}

/**
 * Where a changed column is reported. The configured side names the field where it still declares
 * it; a removed field keeps the applied side's location.
 */
function locationOf(pair: ColumnPair): ColumnLocation | undefined {
  return (pair.configured ?? pair.applied)?.location;
}

/**
 * The columns whose configured definition differs from the applied one: added, removed, or of
 * another type or nullability. Each is one record, holding both definitions and the live column.
 */
function pendingChanges(
  applied: readonly NamedColumn[],
  configured: readonly NamedColumn[],
  live: LiveTables,
  plugin: string | undefined
): ColumnFinding[] {
  const findings: ColumnFinding[] = [];
  for (const pair of pairColumns(applied, configured)) {
    if (isUnchanged(pair)) continue;
    const location = locationOf(pair);
    if (location === undefined) continue;
    findings.push({
      kind: "pending-migration",
      location,
      ...ownedBy(plugin),
      applied: pair.applied?.expected ?? null,
      configured: pair.configured?.expected ?? null,
      live: liveStateOf(liveColumnAt(live, location)),
    });
  }
  return findings;
}
