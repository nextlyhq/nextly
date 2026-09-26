/**
 * What hooks contributed to a table they do not own — an entity table, or an
 * extendable core table — applied to that table's spec.
 *
 * ONE function, called by every consumer that describes such a table: dev
 * push's desired snapshot, the app's migration stream that `migrate:create`
 * writes and `migrate:check` compares, and the core-schema reconcile
 * `nextly migrate` runs. A column, its default, its enum CHECK and an index
 * therefore reach development and every migration route alike; one
 * derivation cannot disagree with itself.
 *
 * @module domains/schema/extension/entity-contributions
 * @since 1.0.0
 */
import type { SupportedDialect } from "../../../database/schema-registry";
import { indexKey } from "../pipeline/diff/index-util";
import type {
  ContributedElements,
  IndexSpec,
  TableSpec,
} from "../pipeline/diff/types";

import type { ExtensionSchema } from "./build-extension-schema";
import { resolveIndexName, toColumnSpec } from "./compile";
import { withContributedEnumChecks } from "./enum-check";

/** The part of a compiled extension schema that holds contributions. */
export type EntityContributionSource = Pick<
  ExtensionSchema,
  "entityColumns" | "entityIndexes"
>;

/**
 * `spec` with the columns, indexes and enum checks contributed to it.
 *
 * - Columns are appended after the table's own, through `toColumnSpec` — the
 *   rendering an extension table's own columns get, default included. A name
 *   the table already has is not appended: the draft refuses such a
 *   contribution at declaration, and a second column of one name is not
 *   something a spec can hold.
 * - Indexes are named by `resolveIndexName`, the rule an extension table's
 *   own indexes are named by, and kept only where every column they name is
 *   on the table — one naming a column this table's desired state does not
 *   have (a field that moved to the localization companion, say) would be
 *   invalid DDL. An index identical in shape to one the table already has is
 *   the same index and is not added twice.
 * - Checks come from `withContributedEnumChecks`, which is also what keeps the
 *   checks of `previous` this pipeline does not own.
 *
 * `previous` is the table as it stands on the other side of the comparison:
 * the live table for dev push, the last snapshot's copy for a migration.
 */
export function withEntityContributions(
  spec: TableSpec,
  source: EntityContributionSource | null | undefined,
  previous: TableSpec | undefined,
  dialect: SupportedDialect
): TableSpec {
  const contributedColumns = source?.entityColumns.get(spec.name) ?? [];
  const contributedIndexes = source?.entityIndexes.get(spec.name) ?? [];

  const columns = [...spec.columns];
  for (const column of contributedColumns) {
    if (columns.some(existing => existing.name === column.name)) continue;
    columns.push(toColumnSpec(column, dialect));
  }

  const present = new Set(columns.map(column => column.name));
  const indexes: IndexSpec[] = [...(spec.indexes ?? [])];
  const keys = new Set(indexes.map(indexKey));
  for (const index of contributedIndexes) {
    if (index.columns.length === 0) continue;
    if (!index.columns.every(column => present.has(column))) continue;
    const built: IndexSpec = {
      name: resolveIndexName(spec.name, index),
      columns: [...index.columns],
      unique: index.unique,
    };
    if (keys.has(indexKey(built))) continue;
    keys.add(indexKey(built));
    indexes.push(built);
  }

  return withContributedEnumChecks(
    {
      ...spec,
      columns,
      ...(spec.indexes !== undefined || indexes.length > 0 ? { indexes } : {}),
    },
    contributedColumns,
    previous,
    dialect
  );
}

/** The elements `after` has that `before` does not, by name. */
export function addedElements(
  before: TableSpec,
  after: TableSpec
): ContributedElements {
  const added = <T extends { name: string }>(
    was: readonly T[] | undefined,
    now: readonly T[] | undefined
  ): string[] =>
    (now ?? [])
      .filter(element => !(was ?? []).some(old => old.name === element.name))
      .map(element => element.name)
      .sort();
  return {
    columns: added(before.columns, after.columns),
    indexes: added(before.indexes, after.indexes),
    foreignKeys: added(before.foreignKeys, after.foreignKeys),
    checks: added(before.checks, after.checks),
  };
}

/** `table` with only the named elements, every dimension tracked. */
export function onlyElements(
  table: TableSpec,
  names: ContributedElements
): TableSpec {
  const keep = <T extends { name: string }>(
    elements: readonly T[] | undefined,
    wanted: readonly string[]
  ): T[] => (elements ?? []).filter(element => wanted.includes(element.name));
  return {
    name: table.name,
    columns: keep(table.columns, names.columns),
    indexes: keep(table.indexes, names.indexes),
    foreignKeys: keep(table.foreignKeys, names.foreignKeys),
    checks: keep(table.checks, names.checks),
  };
}

/**
 * `table` without the named elements; each dimension keeps its tracking.
 *
 * The complement of `onlyElements`: what a table's OWNER describes once the
 * elements others contributed to it are set aside — for a comparison that
 * judges the owner's elements alone.
 */
export function withoutElements(
  table: TableSpec,
  names: ContributedElements
): TableSpec {
  const drop = <T extends { name: string }>(
    elements: readonly T[] | undefined,
    unwanted: readonly string[]
  ): T[] | undefined =>
    elements?.filter(element => !unwanted.includes(element.name));
  const indexes = drop(table.indexes, names.indexes);
  const foreignKeys = drop(table.foreignKeys, names.foreignKeys);
  const checks = drop(table.checks, names.checks);
  return {
    ...table,
    columns: drop(table.columns, names.columns) ?? [],
    ...(indexes !== undefined ? { indexes } : {}),
    ...(foreignKeys !== undefined ? { foreignKeys } : {}),
    ...(checks !== undefined ? { checks } : {}),
  };
}

/**
 * What hooks contributed to each CORE table, as a snapshot of those elements
 * alone, keyed by table name — derived by applying `withEntityContributions`
 * to each bare core table, the derivation the app's migration stream carries
 * the same elements with.
 *
 * Core tables are Nextly's; the elements hooks add to them are not. The core
 * reconcile `nextly migrate` runs sets these aside when it compares a core
 * table with Nextly's declaration, and composes the ones already live into
 * the state its push reaches — so the core declaration and the migration
 * stream carrying the contributions never fight over one table.
 */
export function coreContributions(
  bareCoreTables: readonly TableSpec[],
  source: EntityContributionSource | null | undefined,
  dialect: SupportedDialect
): Map<string, { names: ContributedElements; elements: TableSpec }> {
  const out = new Map<
    string,
    { names: ContributedElements; elements: TableSpec }
  >();
  if (!source) return out;
  for (const bare of bareCoreTables) {
    const columns = source.entityColumns.get(bare.name) ?? [];
    const indexes = source.entityIndexes.get(bare.name) ?? [];
    if (columns.length === 0 && indexes.length === 0) continue;
    const spec = withEntityContributions(bare, source, bare, dialect);
    const names = addedElements(bare, spec);
    out.set(bare.name, { names, elements: onlyElements(spec, names) });
  }
  return out;
}
