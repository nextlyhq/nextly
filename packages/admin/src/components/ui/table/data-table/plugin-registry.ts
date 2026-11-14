/**
 * DataTable plugin registries.
 *
 * Lets plugins and app code contribute to any admin list without patching core:
 * new field-type cell renderers, extra columns, column transforms, per-row
 * actions, and bulk actions. Contributions are keyed by a `target` string —
 * a list key such as a collection slug, `"users"`, `"media"`, or `"*"` (every
 * list). Mirrors the Map-singleton convention of `component-registry` and
 * `cell-registry` (last write wins, warn-never-throw), and is re-exported through
 * `@nextlyhq/plugin-sdk/admin`. A registration made while a list is on screen
 * reaches it: the lists subscribe to the registrations. Each registration
 * returns its own removal, for a plugin whose contribution follows something
 * that can change while the admin is open (whether a collection has what a
 * column shows, say); the removal reaches an open list the same way.
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
  /**
   * Answers, from a column provider, that its columns for this list rest on
   * something still on its way (a read of the plugin's own, say): no columns
   * now, and `until` settling is when they are known. A list that has its
   * rows holds them back for a moment while a provider is still deciding, so
   * a column registered once the read answers is drawn with the rows rather
   * than pushing them apart after; once `until` settles, every list asks its
   * providers again. Hand the same promise for as long as one decision is
   * out. Absent on a transform's context.
   */
  deciding?: (until: Promise<unknown>) => NextlyColumn[];
}

/** Returns extra columns to append to a list. */
export type ColumnProvider = (ctx: DataTableContext) => NextlyColumn[];
/** Receives the current columns and returns the (possibly reordered) columns. */
export type ColumnTransform = (
  columns: NextlyColumn[],
  ctx: DataTableContext
) => NextlyColumn[];

// ============================================================================
// Registries (module-level, replaced whole on every change)
// ============================================================================

/**
 * Every registration, as one value replaced whole on each change rather than
 * mutated, so a list on screen can subscribe to it: a column or action a
 * plugin registers once the list is drawn (after a read of its own, say)
 * joins that list instead of waiting for the next time it is opened.
 */
export interface DataTablePluginRegistrations {
  readonly columnProviders: ReadonlyMap<DataTableTarget, ColumnProvider[]>;
  readonly columnTransforms: ReadonlyMap<DataTableTarget, ColumnTransform[]>;
  readonly rowActions: ReadonlyMap<DataTableTarget, RowAction[]>;
  readonly bulkActions: ReadonlyMap<DataTableTarget, BulkAction[]>;
}

const EMPTY: DataTablePluginRegistrations = {
  columnProviders: new Map(),
  columnTransforms: new Map(),
  rowActions: new Map(),
  bulkActions: new Map(),
};

let registrations: DataTablePluginRegistrations = EMPTY;
const listeners = new Set<() => void>();

/** Replace the registrations, and tell every list drawn from them. */
function replace(next: DataTablePluginRegistrations): void {
  registrations = next;
  for (const listener of listeners) listener();
}

/** `map` with `value` removed from under `key` once, as a new map. */
function without<T>(
  map: ReadonlyMap<string, T[]>,
  key: string,
  value: T
): Map<string, T[]> {
  const next = new Map(map);
  const listed = [...(map.get(key) ?? [])];
  const at = listed.indexOf(value);
  if (at !== -1) listed.splice(at, 1);
  if (listed.length === 0) next.delete(key);
  else next.set(key, listed);
  return next;
}

/**
 * A registration's removal: `take`, run at most once however often the
 * removal is called, so a second call cannot take back a later registration
 * of the same contribution.
 */
function once(take: () => void): () => void {
  let done = false;
  return () => {
    if (done) return;
    done = true;
    take();
  };
}

/** For a registration refused for want of a target: nothing to take back. */
function nothingToRemove(): void {}

/** `map` with `value` appended under `key`, as a new map. */
function appended<T>(
  map: ReadonlyMap<string, T[]>,
  key: string,
  value: T
): Map<string, T[]> {
  const next = new Map(map);
  next.set(key, [...(map.get(key) ?? []), value]);
  return next;
}

function collect<T>(
  map: ReadonlyMap<string, T[]>,
  target: DataTableTarget
): T[] {
  const wildcard = map.get("*") ?? [];
  const scoped = target === "*" ? [] : (map.get(target) ?? []);
  return [...wildcard, ...scoped];
}

/**
 * The decisions a provider said its columns wait on (`ctx.deciding`), each
 * watched once: when one settles, the registrations are replaced by an equal
 * copy, so every list on screen asks its providers again and stops holding
 * its rows for it, whether or not the answer added a column.
 */
const watchedDecisions = new WeakSet<Promise<unknown>>();

/** Ask the lists to resolve their columns again once `until` settles. */
function watchDecision(until: Promise<unknown>): void {
  if (watchedDecisions.has(until)) return;
  watchedDecisions.add(until);
  const askAgain = () => replace({ ...registrations });
  until.then(askAgain, askAgain);
}

/**
 * A provider's context for `target`: `deciding` reports to `onDeciding`,
 * watches the decision and answers no columns. A provider is asked during a
 * render, and watching changes nothing then: the registrations are replaced
 * only once the decision settles, which is always a later task.
 */
function providerContext(
  target: DataTableTarget,
  onDeciding: () => void
): DataTableContext {
  return {
    target,
    deciding: until => {
      onDeciding();
      watchDecision(until);
      return [];
    },
  };
}

/** What the providers registered for one list gave it, from one pass. */
interface ProvidedColumns {
  /** Their columns, in registration order, before any transform. */
  readonly columns: readonly NextlyColumn[];
  /** Whether any of them is still deciding (`ctx.deciding`). */
  readonly deciding: boolean;
}

/**
 * One drawn list's ask of its providers: any object the list keeps for as
 * long as it is on screen. Every reader of that list (the columns it draws,
 * whether it holds its rows for one on its way) passes the same one, and
 * derives its view from one answer: a provider may start a read when asked,
 * and two asks could see it in two states.
 */
export type PluginColumnsPass = object;

/**
 * Each pass's answer, for the registrations snapshot it was asked in, by
 * list. Asked again when the snapshot is replaced (any change, a decision
 * settling included), and by a list drawn anew, which brings a pass of its
 * own: a provider's answer can follow time as well as registrations (a "no
 * column" that stands only a while), so a list opened later asks afresh.
 */
const passes = new WeakMap<
  PluginColumnsPass,
  {
    from: DataTablePluginRegistrations;
    byTarget: Map<DataTableTarget, ProvidedColumns>;
  }
>();

/**
 * The providers' answer for `target` in `from`: once per `pass`, or afresh
 * on each call without one.
 */
function providedColumns(
  target: DataTableTarget,
  from: DataTablePluginRegistrations,
  pass: PluginColumnsPass | undefined
): ProvidedColumns {
  let kept = pass === undefined ? undefined : passes.get(pass);
  if (pass !== undefined && kept?.from !== from) {
    kept = { from, byTarget: new Map() };
    passes.set(pass, kept);
  }
  const known = kept?.byTarget.get(target);
  if (known !== undefined) return known;
  let deciding = false;
  const ctx = providerContext(target, () => {
    deciding = true;
  });
  const columns: NextlyColumn[] = [];
  for (const provider of collect(from.columnProviders, target)) {
    try {
      columns.push(...provider(ctx));
    } catch (error) {
      console.warn(`registerColumns provider for "${target}" failed:`, error);
    }
  }
  const answer = { columns, deciding };
  kept?.byTarget.set(target, answer);
  return answer;
}

/**
 * Whether any provider registered for `target` (or every list) says its
 * columns there are still being decided (`ctx.deciding`), so a list can hold
 * its rows for a column on its way. From the same pass as the list's columns
 * (`resolvePluginColumns`). A provider that throws is not deciding.
 */
export function pluginColumnsDeciding(
  target: DataTableTarget,
  from: DataTablePluginRegistrations = registrations,
  pass?: PluginColumnsPass
): boolean {
  return providedColumns(target, from, pass).deciding;
}

/** The registrations as they stand, for `useSyncExternalStore`. */
export function dataTablePluginRegistrations(): DataTablePluginRegistrations {
  return registrations;
}

/** Be told when a registration changes; returns the unsubscribe. */
export function subscribeToDataTablePlugins(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
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

/** Append extra columns to a list. Returns the registration's removal. */
export function registerColumns(
  target: DataTableTarget,
  provider: ColumnProvider
): () => void {
  if (!target) {
    console.warn("registerColumns: a target is required.");
    return nothingToRemove;
  }
  replace({
    ...registrations,
    columnProviders: appended(registrations.columnProviders, target, provider),
  });
  return once(() =>
    replace({
      ...registrations,
      columnProviders: without(registrations.columnProviders, target, provider),
    })
  );
}

/**
 * Transform (reorder / filter / edit) a list's columns after they are built.
 * Returns the registration's removal.
 */
export function transformColumns(
  target: DataTableTarget,
  transform: ColumnTransform
): () => void {
  if (!target) {
    console.warn("transformColumns: a target is required.");
    return nothingToRemove;
  }
  replace({
    ...registrations,
    columnTransforms: appended(
      registrations.columnTransforms,
      target,
      transform
    ),
  });
  return once(() =>
    replace({
      ...registrations,
      columnTransforms: without(
        registrations.columnTransforms,
        target,
        transform
      ),
    })
  );
}

/**
 * Add a per-row action (rendered in the row's three-dots menu). Returns the
 * registration's removal.
 */
export function registerRowAction<Row extends object = Record<string, unknown>>(
  target: DataTableTarget,
  action: RowAction<Row>
): () => void {
  if (!target) {
    console.warn("registerRowAction: a target is required.");
    return nothingToRemove;
  }
  const registered = action as RowAction;
  replace({
    ...registrations,
    rowActions: appended(registrations.rowActions, target, registered),
  });
  return once(() =>
    replace({
      ...registrations,
      rowActions: without(registrations.rowActions, target, registered),
    })
  );
}

/**
 * Add a bulk action (rendered in the selection bar). Returns the
 * registration's removal.
 */
export function registerBulkAction<
  Row extends object = Record<string, unknown>,
>(target: DataTableTarget, action: BulkAction<Row>): () => void {
  if (!target) {
    console.warn("registerBulkAction: a target is required.");
    return nothingToRemove;
  }
  const registered = action as BulkAction;
  replace({
    ...registrations,
    bulkActions: appended(registrations.bulkActions, target, registered),
  });
  return once(() =>
    replace({
      ...registrations,
      bulkActions: without(registrations.bulkActions, target, registered),
    })
  );
}

// ============================================================================
// Resolution API (consumed by the DataTable)
// ============================================================================

/**
 * Merge plugin columns into a base column set for a target: append the
 * registered providers' columns, then apply the registered transforms in order.
 * With a `pass`, the providers' answer is the one that pass already has.
 */
export function resolvePluginColumns<Row extends object>(
  target: DataTableTarget,
  base: NextlyColumn<Row>[],
  from: DataTablePluginRegistrations = registrations,
  pass?: PluginColumnsPass
): NextlyColumn<Row>[] {
  let columns = [
    ...(base as NextlyColumn[]),
    ...providedColumns(target, from, pass).columns,
  ];
  const ctx: DataTableContext = { target };
  for (const transform of collect(from.columnTransforms, target)) {
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
  target: DataTableTarget,
  from: DataTablePluginRegistrations = registrations
): RowAction<Row>[] {
  return collect(from.rowActions, target) as RowAction<Row>[];
}

/** Bulk actions registered for a target (plus `"*"`). */
export function getPluginBulkActions<Row extends object>(
  target: DataTableTarget,
  from: DataTablePluginRegistrations = registrations
): BulkAction<Row>[] {
  return collect(from.bulkActions, target) as BulkAction<Row>[];
}

// ============================================================================
// Test / introspection helpers
// ============================================================================

/** Clear every DataTable plugin registry (tests only). */
export function clearDataTablePlugins(): void {
  replace(EMPTY);
}
