/**
 * DataTable plugin registries.
 *
 * Lets plugins and app code contribute to any admin list without patching core:
 * new field-type cell renderers, extra columns, column transforms, per-row
 * actions, and bulk actions. Contributions are keyed by a `target` string —
 * a list key such as a collection slug, `"users"`, `"media"`, or `"*"` (every
 * list). Mirrors the Map-singleton convention of `component-registry` and
 * `cell-registry` (last write wins, warn-never-throw), and is re-exported through
 * `@nextlyhq/plugin-sdk/admin`.
 *
 * @module components/ui/table/data-table/plugin-registry
 */

import { defineCellRenderer } from "./cell-registry";
import type { BulkAction, NextlyColumn, RowAction } from "./types";

/**
 * A list key a contribution applies to: `"*"` (all lists), a collection slug,
 * or a fixed admin-list key like `"users"` / `"media"` / `"roles"`.
 */
export type DataTableTarget = string;

/** Context passed to column providers and transforms. */
export interface DataTableContext {
  /** The list key the columns are being resolved for. */
  target: DataTableTarget;
}

/** Returns extra columns to append to a list. */
export type ColumnProvider = (ctx: DataTableContext) => NextlyColumn[];
/** Receives the current columns and returns the (possibly reordered) columns. */
export type ColumnTransform = (
  columns: NextlyColumn[],
  ctx: DataTableContext
) => NextlyColumn[];

// ============================================================================
// Registries (module-level singletons)
// ============================================================================

const columnProviders = new Map<DataTableTarget, ColumnProvider[]>();
const columnTransforms = new Map<DataTableTarget, ColumnTransform[]>();
const rowActionRegistry = new Map<DataTableTarget, RowAction[]>();
const bulkActionRegistry = new Map<DataTableTarget, BulkAction[]>();

function push<T>(map: Map<string, T[]>, key: string, value: T): void {
  const existing = map.get(key);
  if (existing) existing.push(value);
  else map.set(key, [value]);
}

function collect<T>(map: Map<string, T[]>, target: DataTableTarget): T[] {
  const wildcard = map.get("*") ?? [];
  const scoped = target === "*" ? [] : (map.get(target) ?? []);
  return [...wildcard, ...scoped];
}

// ============================================================================
// Registration API (plugin-facing)
// ============================================================================

/**
 * Register a cell renderer for one or more field types (re-exported name for
 * `defineCellRenderer`). Later registrations for a type win, so a plugin can
 * override a core renderer.
 */
export { defineCellRenderer as registerCellRenderer };

/** Append extra columns to a list. */
export function registerColumns(
  target: DataTableTarget,
  provider: ColumnProvider
): void {
  if (!target) {
    console.warn("registerColumns: a target is required.");
    return;
  }
  push(columnProviders, target, provider);
}

/** Transform (reorder / filter / edit) a list's columns after they are built. */
export function transformColumns(
  target: DataTableTarget,
  transform: ColumnTransform
): void {
  if (!target) {
    console.warn("transformColumns: a target is required.");
    return;
  }
  push(columnTransforms, target, transform);
}

/** Add a per-row action (rendered in the row's three-dots menu). */
export function registerRowAction<Row extends object = Record<string, unknown>>(
  target: DataTableTarget,
  action: RowAction<Row>
): void {
  if (!target) {
    console.warn("registerRowAction: a target is required.");
    return;
  }
  push(rowActionRegistry, target, action as RowAction);
}

/** Add a bulk action (rendered in the selection bar). */
export function registerBulkAction<
  Row extends object = Record<string, unknown>,
>(target: DataTableTarget, action: BulkAction<Row>): void {
  if (!target) {
    console.warn("registerBulkAction: a target is required.");
    return;
  }
  push(bulkActionRegistry, target, action as BulkAction);
}

// ============================================================================
// Resolution API (consumed by the DataTable)
// ============================================================================

/**
 * Merge plugin columns into a base column set for a target: append the
 * registered providers' columns, then apply the registered transforms in order.
 */
export function resolvePluginColumns<Row extends object>(
  target: DataTableTarget,
  base: NextlyColumn<Row>[]
): NextlyColumn<Row>[] {
  const ctx: DataTableContext = { target };
  let columns = [...(base as NextlyColumn[])];

  for (const provider of collect(columnProviders, target)) {
    try {
      columns = [...columns, ...provider(ctx)];
    } catch (error) {
      console.warn(`registerColumns provider for "${target}" failed:`, error);
    }
  }
  for (const transform of collect(columnTransforms, target)) {
    try {
      // Transform a copy and only commit an array result, so a transform that
      // mutates its input then throws (or returns a non-array) cannot leave the
      // resolved columns corrupted.
      const next = transform([...columns], ctx);
      if (!Array.isArray(next)) {
        console.warn(
          `transformColumns for "${target}" returned a non-array; ignoring.`
        );
        continue;
      }
      columns = next;
    } catch (error) {
      console.warn(`transformColumns for "${target}" failed:`, error);
    }
  }
  return columns as NextlyColumn<Row>[];
}

/** Row actions registered for a target (plus `"*"`). */
export function getPluginRowActions<Row extends object>(
  target: DataTableTarget
): RowAction<Row>[] {
  return collect(rowActionRegistry, target) as RowAction<Row>[];
}

/** Bulk actions registered for a target (plus `"*"`). */
export function getPluginBulkActions<Row extends object>(
  target: DataTableTarget
): BulkAction<Row>[] {
  return collect(bulkActionRegistry, target) as BulkAction<Row>[];
}

// ============================================================================
// Test / introspection helpers
// ============================================================================

/** Clear every DataTable plugin registry (tests only). */
export function clearDataTablePlugins(): void {
  columnProviders.clear();
  columnTransforms.clear();
  rowActionRegistry.clear();
  bulkActionRegistry.clear();
}
