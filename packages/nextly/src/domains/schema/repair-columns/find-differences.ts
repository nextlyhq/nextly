// Find every column whose type or nullability differs from its field's descriptor.
//
// Read-only: it introspects the live tables once and changes nothing in the database. Each column
// is judged against its field AS THE DATABASE LAST HAD IT APPLIED, never against a newer
// configuration, because a change the configuration holds and no migration has applied is that
// migration's to make: converting the column towards it here would let a repair stand in for a
// reviewed migration file. Such a change is reported on its own record, so the owner sees both what
// is wrong with the column today and what the next migration will do to it.
//
// @module domains/schema/repair-columns/find-differences

import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import { resolveLocalizedFieldNames } from "../../i18n/classify-fields";
import { introspectLiveColumns } from "../pipeline/diff/introspect-live";
import type { ColumnSpec } from "../pipeline/diff/types";
import {
  getColumnDescriptor,
  getComponentRowColumnDescriptor,
  getUserFieldColumnDescriptor,
  type ColumnDescriptor,
  type SupportedDialect,
} from "../services/field-column-descriptor";

import { compareColumn } from "./column-comparison";
import { differenceCause } from "./difference-cause";
import type {
  ColumnFinding,
  ColumnLocation,
  ColumnState,
  EntityDefinition,
  RepairEntity,
} from "./types";

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
 * The descriptor of one field's column, asked as the builder that made its table answers it.
 *
 * `user_ext` has its own builder and so its own descriptor. A field-group row answers the component
 * question, where a many-to-many keeps its ids on the row; a translation table is built from the
 * plain descriptor whatever the entity, as its own builder does.
 */
function describeColumn(
  entity: RepairEntity,
  field: FieldDefinition,
  translation: boolean,
  dialect: SupportedDialect
): ColumnDescriptor | null {
  if (entity.origin === "userFields") {
    return getUserFieldColumnDescriptor(field, dialect);
  }
  const describe =
    entity.kind === "fieldGroup" && !translation
      ? getComponentRowColumnDescriptor
      : getColumnDescriptor;
  return describe(field, dialect, entity.origin);
}

/**
 * The column one field names, on the entity's own table or in its translation table, or null where
 * the field has no column.
 */
function namedColumn(
  entity: RepairEntity,
  field: FieldDefinition,
  translation: boolean,
  dialect: SupportedDialect
): NamedColumn | null {
  const descriptor = describeColumn(entity, field, translation, dialect);
  if (descriptor === null) return null;
  return {
    location: {
      kind: entity.kind,
      slug: entity.slug,
      field: field.name,
      table: translation ? translationTableOf(entity.table) : entity.table,
      column: descriptor.name,
      translation,
    },
    field,
    expected: {
      type: descriptor.dialectType,
      // The translation table's builder makes every field column nullable, a required field's
      // included: a translatable field's `required` is enforced by the application, not by its
      // column. So nullable is what that table holds, whatever the descriptor says.
      nullable: translation ? true : descriptor.nullable,
    },
  };
}

/**
 * Every column a definition's fields name, in field order: on the entity's own table, or in its
 * translation table for a translatable field of a localized entity.
 *
 * Asked of the descriptor, the one answer to which fields have a column and what it is.
 */
function columnsNamedBy(
  entity: RepairEntity,
  definition: EntityDefinition,
  dialect: SupportedDialect
): NamedColumn[] {
  const translatable = definition.localized
    ? new Set(resolveLocalizedFieldNames([...definition.fields], true))
    : new Set<string>();
  const columns: NamedColumn[] = [];
  for (const field of definition.fields) {
    if (typeof field?.name !== "string" || field.name === "") continue;
    const column = namedColumn(
      entity,
      field,
      translatable.has(field.name),
      dialect
    );
    if (column !== null) columns.push(column);
  }
  return columns;
}

/** The live columns of each live table, by lower-cased table and column name. */
type LiveTables = ReadonlyMap<string, ReadonlyMap<string, ColumnSpec>>;

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
    ?.get(location.column.toLowerCase());
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
  applied: NamedColumn[];
  configured: NamedColumn[] | null;
}

/** The live columns of every table the planned columns are in, read in one introspection. */
async function readLiveTables(
  db: unknown,
  dialect: SupportedDialect,
  planned: readonly PlannedEntity[]
): Promise<LiveTables> {
  const tableNames = [
    ...new Set(
      planned.flatMap(({ applied, configured }) =>
        [...applied, ...(configured ?? [])].map(c => c.location.table)
      )
    ),
  ];
  const snapshot = await introspectLiveColumns(db, dialect, tableNames);
  return new Map(
    snapshot.tables.map(table => [
      table.name.toLowerCase(),
      new Map(table.columns.map(c => [c.name.toLowerCase(), c])),
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
}): Promise<ColumnFinding[]> {
  const { db, dialect, entities } = args;

  const planned = entities.map(
    (entity): PlannedEntity => ({
      entity,
      applied: columnsNamedBy(entity, entity.applied, dialect),
      configured:
        entity.configured === null
          ? null
          : columnsNamedBy(entity, entity.configured, dialect),
    })
  );
  const live = await readLiveTables(db, dialect, planned);

  const findings: ColumnFinding[] = [];
  for (const { entity, applied, configured } of planned) {
    if (entity.awaitingMigration) {
      findings.push(...awaitingMigrationFindings(entity, applied, live));
      continue;
    }
    findings.push(...appliedColumnFindings(entity, applied, live, dialect));
    if (configured !== null) {
      findings.push(
        ...pendingChanges(applied, configured, live, entity.plugin)
      );
    }
  }
  return findings;
}

/**
 * The columns of an entity awaiting a migration that are not as its registry row describes them.
 *
 * The applied definition is unknown, so a column that is not as the registry row describes it may
 * be legacy or may be the change the migration will make: the migration decides.
 */
function awaitingMigrationFindings(
  entity: RepairEntity,
  applied: readonly NamedColumn[],
  live: LiveTables
): ColumnFinding[] {
  const findings: ColumnFinding[] = [];
  for (const column of applied) {
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

/** Every applied column of one entity that the database lacks or holds differently. */
function appliedColumnFindings(
  entity: RepairEntity,
  applied: readonly NamedColumn[],
  live: LiveTables,
  dialect: SupportedDialect
): ColumnFinding[] {
  const findings: ColumnFinding[] = [];
  for (const column of applied) {
    const finding = judgeAppliedColumn(entity, column, live, dialect);
    if (finding !== null) findings.push(finding);
  }
  return findings;
}

/**
 * How one applied column differs from the live database: missing (with its table, or alone), of
 * another type or nullability, or null where it is as its field describes it.
 */
function judgeAppliedColumn(
  entity: RepairEntity,
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
    cause: differenceCause({
      field: column.field,
      kind: entity.kind,
      origin: entity.origin,
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
