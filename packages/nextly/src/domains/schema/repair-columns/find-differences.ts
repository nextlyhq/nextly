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
// Every entity takes the same two steps, whichever of its sides are present (the decision table is
// in the model, `./types`): the applied columns, where there are any, are judged against the live
// ones at the table the database holds; then the applied and configured columns are paired by
// column name and every pair the next migration changes is reported pending. A missing side is not
// a reason to say nothing: with no applied side every configured column is an add, and with no
// configured side every applied column a removal.
//
// @module domains/schema/repair-columns/find-differences

import { sql } from "drizzle-orm";

import { isNextlyOwnedDocumentColumn } from "../../../lib/system-columns";
import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import { resolveLocalizedFieldNames } from "../../i18n/classify-fields";
import { storesPerLanguage } from "../../i18n/per-language-storage";
import type { ColumnOverride } from "../extension/draft";
import { resolveColumnOverride } from "../extension/extension-columns";
import { querySqlRows } from "../pipeline/classifier/count-helpers";
import {
  sizeFromDeclaration,
  typesDiffer,
} from "../pipeline/diff/declared-size";
import { introspectLiveColumns } from "../pipeline/diff/introspect-live";
import { normalizeType } from "../pipeline/diff/normalize-type";
import type { ColumnSpec } from "../pipeline/diff/types";
import {
  type ColumnDescriptor,
  getColumnDescriptor,
  getComponentRowColumnDescriptor,
  getSingleRowColumnDescriptor,
  renderDialectType,
  type SupportedDialect,
} from "../services/field-column-descriptor";
import { withColumnOverride } from "../services/runtime-schema-generator";
import {
  readMysqlIdentifierCaseRules,
  type RawSqlExecutor,
} from "../utils/read-identifier-case";
import {
  identifierCaseRules,
  indexCatalog,
  resolveCatalogName,
  type IdentifierCase,
} from "../utils/resolve-catalog-name";
import { keyedByOf, type KeyedBy } from "../value-conversion/read-values";

import { classifyDifference, planDifference } from "./classify";
import { compareColumn, type ColumnAspects } from "./column-comparison";
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
  definition: EntityDefinition,
  field: FieldDefinition,
  translation: boolean,
  dialect: SupportedDialect
): (ColumnState & { name: string }) | null {
  const origin = definition.origin;
  if (origin === "userFields") return userFieldColumn(field, dialect);
  const describe =
    entity.kind === "fieldGroup" && !translation
      ? getComponentRowColumnDescriptor
      : entity.kind === "single" && !translation
        ? getSingleRowColumnDescriptor
        : getColumnDescriptor;
  const described = describe(field, dialect, origin);
  if (described === null) return null;
  // An override the app made of the column's storage is what the column should have: the entity's
  // own table carries it, through the descriptor the runtime table is built with. A translation
  // table is not an entity table an override reaches.
  const descriptor = translation
    ? described
    : withColumnOverride(
        described,
        [
          ...(definition.columnOverrides ?? []),
          ...recordedOverride(described, definition.recordedTypes, dialect),
        ],
        dialect
      );
  return {
    name: descriptor.name,
    type: descriptor.dialectType,
    nullable: descriptor.nullable,
  };
}

/** A builder of the storage a recorded type spells, as an override would declare it. */
function builderOf(
  type: string
): Parameters<typeof resolveColumnOverride>[1] | null {
  const size = sizeFromDeclaration(type);
  switch (normalizeType(type)) {
    case "varchar":
      return size === undefined
        ? null
        : { kind: "varchar", nullable: false, length: Number(size) };
    case "text":
      return { kind: "longText", nullable: false };
    case "int4":
      return { kind: "integer", nullable: false };
    case "int8":
      return { kind: "bigint", nullable: false };
    case "numeric": {
      const [precision, scale] = (size ?? "").split(",").map(Number);
      return precision === undefined || scale === undefined
        ? null
        : { kind: "decimal", nullable: false, precision, scale };
    }
    default:
      return null;
  }
}

/**
 * The override an applied snapshot's recorded type shows for a field column: its storage where it
 * differs from the field's own and is one an override may give the field, or none. Read from the
 * snapshot alone, so a column whose override the configuration has changed or removed since is
 * still judged by what its migration applied.
 */
function recordedOverride(
  described: ColumnDescriptor,
  recordedTypes: Readonly<Record<string, string>> | undefined,
  dialect: SupportedDialect
): ColumnOverride[] {
  const recorded = recordedTypes?.[described.name];
  if (recorded === undefined) return [];
  const own: ColumnSpec = {
    name: described.name,
    type: described.dialectType,
    nullable: true,
  };
  if (!typesDiffer(own, { ...own, type: recorded })) return [];
  const builder = builderOf(recorded);
  if (builder === null) return [];
  try {
    const storage = resolveColumnOverride(
      described,
      builder,
      "",
      described.name
    );
    // Only where the storage renders as recorded: a type an override could not have produced is
    // not read as one.
    const rendered = renderDialectType(storage.kind, dialect, storage);
    return typesDiffer({ ...own, type: rendered }, { ...own, type: recorded })
      ? []
      : [{ column: described.name, ...storage, owner: { kind: "app" } }];
  } catch {
    return [];
  }
}

/**
 * The column one field names, on `table` (the entity's own table as the definition's side names
 * it) or in that table's translation table, or null where the field has no column.
 */
function namedColumn(
  entity: RepairEntity,
  definition: EntityDefinition,
  table: string,
  field: FieldDefinition,
  translation: boolean,
  dialect: SupportedDialect
): NamedColumn | null {
  const column = describeColumn(
    entity,
    definition,
    field,
    translation,
    dialect
  );
  if (column === null) return null;
  return {
    location: {
      kind: entity.kind,
      slug: entity.slug,
      field: field.name,
      table: translation ? translationTableOf(table) : table,
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
 * Every column a definition's fields name, in field order: on `table`, the entity's own table as
 * the definition's side names it, or in its translation table for a translatable field of a
 * localized entity.
 *
 * Asked of the descriptor as the definition's own builder answers it, the one answer to which
 * fields have a column and what it is.
 */
function columnsNamedBy(
  entity: RepairEntity,
  definition: EntityDefinition,
  table: string,
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
      definition,
      table,
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

/**
 * How this run's server compares table names: PostgreSQL keeps the case of a quoted name, SQLite
 * folds `A` to `Z` alone, and MySQL follows its `lower_case_table_names` setting, which is read
 * once here. No default is safe for MySQL: folding merges two tables a case-sensitive server keeps
 * apart, and not folding misses a table a folding server lowercased.
 */
async function tableNameCase(
  db: unknown,
  dialect: SupportedDialect
): Promise<IdentifierCase> {
  const rules =
    dialect === "mysql"
      ? await readMysqlIdentifierCaseRules(db as RawSqlExecutor)
      : identifierCaseRules({ dialect });
  return rules.tables;
}

/**
 * A lookup by table name over `entries`, which are keyed by the names the database reported,
 * resolving a name as the server compares table names. The one lookup every question about a live
 * table goes through, so two tables the server keeps apart are never answered for one another.
 */
function byTableName<T>(
  tableCase: IdentifierCase,
  entries: ReadonlyMap<string, T>
): (table: string) => T | undefined {
  const catalog = indexCatalog([...entries.keys()], tableCase);
  return table => {
    const name = resolveCatalogName(catalog, table);
    return name === undefined ? undefined : entries.get(name);
  };
}

/** The live tables, looked up by name as the server compares table names. */
interface LiveTables {
  get(table: string): LiveTable | undefined;
  has(table: string): boolean;
}

/** The lookup over the live tables one or more reads returned. */
function liveTablesOf(
  tableCase: IdentifierCase,
  tables: readonly LiveTable[]
): LiveTables {
  const get = byTableName(
    tableCase,
    new Map(tables.map(table => [table.name, table]))
  );
  return { get, has: table => get(table) !== undefined };
}

/**
 * A column within its entity: its name and whether it is in the translation table. Not its table,
 * which the two sides name differently while a rename is pending.
 */
const columnKey = (column: NamedColumn) =>
  `${column.location.translation ? "translation" : "own"}\u0000${column.location.column.toLowerCase()}`;

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
  return live.get(location.table)?.columns.get(location.column.toLowerCase());
}

/**
 * The table and column at a location as the database spells them, for a query to name, and how the
 * table's rows are keyed, from its primary key.
 */
function liveNamesOf(
  live: LiveTables,
  location: ColumnLocation
): { liveTable: string; liveColumn: string; keyedBy: KeyedBy } {
  const table = live.get(location.table);
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
): Promise<LiveTable[]> {
  const snapshot = await introspectLiveColumns(db, dialect, [...tableNames]);
  return snapshot.tables.map(table => ({
    name: table.name,
    // The per-document columns are Nextly's own, added by `nextly
    // migrate` rather than by any field, so no comparison sees them.
    columns: new Map(
      table.columns
        .filter(c => !isNextlyOwnedDocumentColumn(c.name))
        .map(c => [c.name.toLowerCase(), c])
    ),
  }));
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
    entity: RepairEntity,
    table: string
  ) =>
    definition === null
      ? null
      : columnsNamedBy(entity, definition, table, dialect);
  const planned = entities.map(
    (entity): PlannedEntity => ({
      entity,
      // The applied columns are where the database holds the entity; the configured ones where
      // the next migration would have it, which is another table while a rename is pending.
      applied: namedBy(entity.applied, entity, entity.table),
      configured: namedBy(
        entity.configured,
        entity,
        entity.renamedTo ?? entity.table
      ),
    })
  );
  let live: LiveTables;
  let lockOf: (table: string) => TableLockFacts | undefined;
  try {
    const tableCase = await tableNameCase(db, dialect);
    const read = await readDefinitions(db, dialect, planned, waits);
    if (read.kind === "ran-out") {
      return planned.flatMap(entity =>
        definitionUnreadableFindings(entity, () => read.lock)
      );
    }
    live = liveTablesOf(tableCase, read.live);
    lockOf = byTableName(tableCase, read.held);
  } catch (error) {
    if (!isDatabaseHeld(error, dialect)) throw error;
    // Another connection holds the whole database, so no table's definition can be read: every
    // column each entity names is reported, and whether it differs is unknown.
    return planned.flatMap(entity => definitionUnreadableFindings(entity));
  }

  // A table's row count is the same for each of its columns, so it is read once per table.
  const countRows = rowCounter(dialect);
  const findings: ColumnFinding[] = [];
  const isRead = (column: NamedColumn) =>
    lockOf(column.location.table) === undefined;
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
    // Each applied column against the live one, where a record says what was applied.
    if (entity.applied !== null && each.applied !== null) {
      findings.push(
        ...(await appliedColumnFindings(
          db,
          entity,
          entity.applied.origin,
          each.applied.filter(isRead),
          live,
          dialect,
          { countRows, waits }
        ))
      );
    }
    // Then every change the next migration makes: a missing side gives the pairing no columns, so
    // every column the other side names is an add or a removal.
    findings.push(
      ...pendingChanges(
        each.applied ?? [],
        each.configured ?? [],
        live,
        entity.plugin
      )
        .filter(
          // A column on a table whose definition could not be read is already reported as that.
          ({ pair }) =>
            (pair.applied === undefined || isRead(pair.applied)) &&
            (pair.configured === undefined || isRead(pair.configured))
        )
        .map(({ finding }) => finding)
    );
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
  // By column, not by table: a column a pending rename moves is one column, named where the
  // database holds it.
  const named = new Map<string, NamedColumn>();
  for (const column of [...(applied ?? []), ...(configured ?? [])]) {
    const key = columnKey(column);
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
      live: LiveTable[];
      /** Each table whose tries ran out before its definition could be read, by its name. */
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
  const live: LiveTable[] = [];
  const held = new Map<string, TableLockFacts>();
  for (const name of names) {
    const read = await waits.read(name, on =>
      readLiveTables(on, dialect, [name])
    );
    if (read.kind === "ran-out") {
      held.set(name, read.lock);
      continue;
    }
    live.push(...read.value);
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
  if (found === undefined) return notMigrated(entity, column, live);
  const state = stateOf(found);
  const difference = judgedDifference(entity, column, state);
  if (difference === null) return null;
  const { expected, aspects } = difference;
  return {
    kind: "differs",
    location: column.location,
    ...ownedBy(entity.plugin),
    expected,
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
      expected,
    }),
  };
}

/** An applied column the database does not hold: its whole table is missing, or the column alone. */
function notMigrated(
  entity: RepairEntity,
  column: NamedColumn,
  live: LiveTables
): ColumnFinding {
  return {
    kind: "not-migrated",
    location: column.location,
    ...ownedBy(entity.plugin),
    missing: live.has(column.location.table) ? "column" : "table",
    expected: column.expected,
  };
}

/**
 * How a live column differs from what its applied definition expects, and the column it is judged
 * against, or null where it does not differ.
 *
 * An override reaches only the entity's own table. Where no record says which were applied, a
 * column there of another type may be as its override made it: judging it against the field's own
 * storage would report, and convert, a column that is as applied. An override keeps the field's
 * nullability, so that is still judged, with the type left as the database holds it.
 */
function judgedDifference(
  entity: RepairEntity,
  column: NamedColumn,
  state: ColumnState
): { expected: ColumnState; aspects: ColumnAspects } | null {
  const aspects = compareColumn(state, column.expected);
  if (aspects === null) return null;
  const typeUnknown =
    aspects.type &&
    entity.applied?.storageUnknown === true &&
    !column.location.translation;
  if (!typeUnknown) return { expected: column.expected, aspects };
  if (!aspects.nullability) return null;
  return {
    expected: { ...state, nullable: column.expected.nullable },
    aspects: { type: false, nullability: true },
  };
}

/** One column as the applied and the configured definition each name it, where they do. */
interface ColumnPair {
  applied?: NamedColumn;
  configured?: NamedColumn;
}

/** Every column either definition names, paired by column, applied ones first. */
function pairColumns(
  applied: readonly NamedColumn[],
  configured: readonly NamedColumn[]
): ColumnPair[] {
  const byKey = new Map<string, ColumnPair>();
  for (const column of applied) {
    byKey.set(columnKey(column), { applied: column });
  }
  for (const column of configured) {
    const at = columnKey(column);
    byKey.set(at, { ...byKey.get(at), configured: column });
  }
  return [...byKey.values()];
}

/**
 * The table the configured side moves a paired column from, where it names another. Names are
 * compared as written, as the schema diff compares them: a name that differs only by case is
 * another table to it, and its migration renames the table.
 */
function movedFrom(pair: ColumnPair): string | undefined {
  if (pair.applied === undefined || pair.configured === undefined) {
    return undefined;
  }
  const from = pair.applied.location.table;
  return from === pair.configured.location.table ? undefined : from;
}

/**
 * Whether both definitions name the column, at one table, and agree on its type and nullability:
 * the next migration leaves such a column as it is.
 */
function isUnchanged(pair: ColumnPair): boolean {
  return (
    pair.applied !== undefined &&
    pair.configured !== undefined &&
    movedFrom(pair) === undefined &&
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
 * The columns the next migration changes: added, removed, moved to another table, or of another
 * type or nullability. Each is one record, holding both definitions and the live column, with the
 * pair it was made from. An empty side makes every column of the other an add or a removal.
 *
 * The live column is read where the database holds it: at the applied side's location where that
 * side names the column, else where the configured side puts it.
 */
function pendingChanges(
  applied: readonly NamedColumn[],
  configured: readonly NamedColumn[],
  live: LiveTables,
  plugin: string | undefined
): { pair: ColumnPair; finding: ColumnFinding }[] {
  const changes: { pair: ColumnPair; finding: ColumnFinding }[] = [];
  for (const pair of pairColumns(applied, configured)) {
    if (isUnchanged(pair)) continue;
    const finding = pendingFinding(pair, live, plugin);
    if (finding !== null) changes.push({ pair, finding });
  }
  return changes;
}

/** The pending record of one changed pair, or null for a pair neither side names. */
function pendingFinding(
  pair: ColumnPair,
  live: LiveTables,
  plugin: string | undefined
): ColumnFinding | null {
  const location = locationOf(pair);
  if (location === undefined) return null;
  const renamedFrom = movedFrom(pair);
  return {
    kind: "pending-migration",
    location,
    ...ownedBy(plugin),
    ...(renamedFrom !== undefined ? { renamedFrom } : {}),
    applied: expectedOf(pair.applied),
    configured: expectedOf(pair.configured),
    live: liveStateOf(liveColumnAt(live, pair.applied?.location ?? location)),
  };
}

/** The column a side expects, or null where that side does not name it. */
function expectedOf(column: NamedColumn | undefined): ColumnState | null {
  return column === undefined ? null : column.expected;
}
