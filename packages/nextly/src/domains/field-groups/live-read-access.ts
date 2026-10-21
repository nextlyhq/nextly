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
import { anyFieldGroupHasAccessRule } from "../../shared/lib/field-level-registry";
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
  return (row, caller) =>
    applyComponentReadAccess(row, fields, fieldGroupFields, caller);
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
 * Withhold, from each of `entries`, the field-group fields the caller may not
 * read: the one-shot form, for a document judged once rather than before and
 * after hooks, such as a write's response.
 */
export async function withholdFieldGroupFields(
  entries: readonly Record<string, unknown>[],
  fields: readonly FieldConfig[],
  source: FieldGroupFieldsSource | undefined,
  caller: ComponentReadCaller
): Promise<void> {
  const pass = await liveFieldGroupReadPass(fields, source);
  if (!pass) return;
  for (const entry of entries) await pass(entry, caller);
}
