/**
 * Field read rules inside the field groups a live read returns.
 *
 * A field group's fields are declared on the field group, and their rules are
 * registered under it, so the entity's own pass (`applyFieldReadAccess`) never
 * reaches them. A list, a read by id and a Single read each run this beside
 * that pass, through the same walk history reads use
 * (`applyComponentReadAccess`), so a live read and a version withhold the
 * same fields.
 *
 * @module domains/field-groups/live-read-access
 */

import type { FieldConfig } from "../../collections/fields/types";
import {
  anyFieldGroupHasAccessRule,
  type ReadAccessRedactions,
} from "../../shared/lib/field-level-registry";
import {
  applyComponentReadAccess,
  type ComponentReadCaller,
} from "../versions/component-read-access";
import { resolveComponentFieldMap } from "../versions/tag-component-types";

/** Where a field group's current fields are read from. */
export interface FieldGroupFieldsSource {
  getComponentFields(slug: string): Promise<FieldConfig[] | null>;
}

/** Withholds, from one row, the field-group fields the caller may not read. */
export type LiveFieldGroupReadPass = (
  row: Record<string, unknown>,
  caller: ComponentReadCaller
) => Promise<void>;

/**
 * The field-group read pass for one read over `fields`, or `undefined` when no
 * field group declares a read rule, so a read with nothing to judge pays no
 * schema lookup.
 *
 * The field groups `fields` reach are resolved here, once for the whole read,
 * and every row is judged against that one map. Without a lookup the map is
 * empty: the instances `fields` hold directly are still judged by their own
 * rules, and only the walk into a field group's own containers needs the
 * schemas. A lookup that fails propagates, so the read fails rather than
 * returning what it could not judge.
 */
export async function liveFieldGroupReadPass(
  fields: readonly FieldConfig[],
  source: FieldGroupFieldsSource | undefined
): Promise<LiveFieldGroupReadPass | undefined> {
  if (!anyFieldGroupHasAccessRule("read")) return undefined;
  const fieldGroupFields = source
    ? await resolveComponentFieldMap([...fields], onceEach(source))
    : new Map<string, FieldConfig[]>();
  // A live document: a single field group's value is judged by the field group
  // the field declares, whatever type a hook may have given it.
  return (row, caller) =>
    applyComponentReadAccess(row, fields, fieldGroupFields, {
      ...caller,
      declaredComponentDecides: true,
    });
}

/**
 * A lookup that asks `source` once per field group, however many fields name
 * it: the resolver batches the slugs it finds, and a schema that places one
 * field group in several fields would otherwise ask for it once for each.
 */
function onceEach(
  source: FieldGroupFieldsSource
): (slug: string) => Promise<FieldConfig[] | null> {
  const asked = new Map<string, Promise<FieldConfig[] | null>>();
  return slug => {
    const pending = asked.get(slug) ?? source.getComponentFields(slug);
    asked.set(slug, pending);
    return pending;
  };
}

/**
 * Run `judge` with what the field-group passes removed from `row` put back,
 * then take it out again.
 *
 * The entity's own second pass re-judges the row against the content its
 * first pass saw, restoring its own removals as evidence; it cannot restore a
 * field group's, which its registration does not describe. A rule of the
 * entity's that reads a value inside a field group would then be judged
 * against the instance the first field-group pass cut, and could allow what
 * the stored content denies. So the field groups' removals, kept in a store
 * of their own (`redactions`), are put back for that pass only: the
 * field-group pass after it restores and judges them by its own rules.
 */
export async function withFieldGroupEvidence(
  row: Record<string, unknown>,
  redactions: ReadAccessRedactions,
  judge: () => Promise<void>
): Promise<void> {
  const putBack: PutBack[] = [];
  // Iterative, with a visited set: a document can be wide, and a value shared
  // by several fields is walked once.
  const seen = new WeakSet<object>();
  const pending: unknown[] = [row];
  while (pending.length > 0) {
    const value = pending.pop();
    if (value === null || typeof value !== "object" || seen.has(value)) {
      continue;
    }
    seen.add(value);
    const children = Array.isArray(value)
      ? value
      : restoreRemoved(value as Record<string, unknown>, redactions, putBack);
    for (const child of children) pending.push(child);
  }
  try {
    await judge();
  } finally {
    // Out again, unless the pass replaced the value, which is then its own.
    for (const { at, key, value } of putBack) {
      if (at[key] === value) delete at[key];
    }
  }
}

/** A value put back for one pass, to be taken out again after it. */
interface PutBack {
  at: Record<string, unknown>;
  key: string;
  value: unknown;
}

/**
 * Put back on `record` what a pass removed from it, noting each value, and
 * return the values it now holds, for the walk to go on into.
 */
function restoreRemoved(
  record: Record<string, unknown>,
  redactions: ReadAccessRedactions,
  putBack: PutBack[]
): unknown[] {
  const removed = redactions.get(record);
  for (const [key, kept] of Object.entries(removed ?? {})) {
    if (key in record) continue;
    record[key] = kept;
    putBack.push({ at: record, key, value: kept });
  }
  return Object.values(record);
}

const perTransaction = new WeakMap<object, Map<string, unknown>>();

/**
 * One value per transaction and `key`, made on first ask and shared by every
 * later one inside the same transaction.
 *
 * A bulk write redacts each item's response inside one transaction, and what
 * a redaction resolves (the field groups' schemas, the caller's grants) is
 * the same for every item: made per item, a batch of N rows reads them N
 * times. Keyed by the transaction's executor, so nothing outlives it.
 * Outside a transaction (`executor` absent) each ask makes its own: nothing
 * there marks where one request's reads end.
 */
export function sharedPerTransaction<T>(
  executor: unknown,
  key: string,
  make: () => T
): T {
  if (executor === null || typeof executor !== "object") return make();
  let entries = perTransaction.get(executor);
  if (!entries) {
    entries = new Map();
    perTransaction.set(executor, entries);
  }
  if (!entries.has(key)) entries.set(key, make());
  return entries.get(key) as T;
}
