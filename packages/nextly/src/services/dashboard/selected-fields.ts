/**
 * Which of a system source's declared fields a widget query selected, and the
 * columns that head them: ONE reading for every source that publishes a fixed
 * list of fields, so two sources cannot come to answer one `select` two ways.
 *
 * @module services/dashboard/selected-fields
 */

import type { WidgetResultField } from "../../domains/widgets/result";

/** A field a source declares, as its query may select it. */
export type DeclaredField = Required<Pick<WidgetResultField, "name" | "type">> &
  Pick<WidgetResultField, "label">;

/** The selected names the source declares, in the order asked, or all of them. */
export function selectedNames(
  declared: readonly DeclaredField[],
  select: readonly string[] | undefined
): string[] {
  const names = declared.map(field => field.name);
  if (!select || select.length === 0) return names;
  return [...new Set(select)].filter(name => names.includes(name));
}

/**
 * The columns to head the rows with, present only when the query chose them,
 * as the collection path and `system:releases` publish them.
 */
export function describeSelected(
  declared: readonly DeclaredField[],
  select: readonly string[] | undefined
): WidgetResultField[] | undefined {
  if (!select || select.length === 0) return undefined;
  const byName = new Map(declared.map(field => [field.name, field]));
  const described = selectedNames(declared, select).flatMap(name => {
    const field = byName.get(name);
    return field ? [{ name, label: field.label, type: field.type }] : [];
  });
  return described.length > 0 ? described : undefined;
}
