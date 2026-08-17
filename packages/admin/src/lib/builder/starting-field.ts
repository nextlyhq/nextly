/**
 * The field a new collection or single starts with.
 *
 * Enabling the page builder used to mean creating an entity, landing on the
 * fields screen, opening the picker and recognising "Blocks" among twenty field
 * types. The capability was discoverable only if you already knew its name — so
 * the question is asked while the entity is being created, which is when the
 * person is actually deciding it.
 *
 * A choice rather than a toggle, because "page builder" is not the only answer
 * and will not stay the only one: any plugin contributing a field type for the
 * entries surface appears here, and nothing about this module names one.
 *
 * The picker keeps every type it already offered. This seeds a starting point;
 * it does not restrict what can be added afterwards, and a collection is free to
 * hold a blocks field alongside anything else.
 *
 * @module lib/builder/starting-field
 */
import type { FieldTypeCatalogEntry } from "nextly/field-catalog";

/** What a starting-field choice looks like to the surface rendering it. */
export interface StartingFieldChoice {
  /** The field type to seed, or `null` for "no starting field". */
  type: string | null;
  label: string;
  hint: string;
}

/**
 * The default, and the only choice that is always present.
 *
 * Listed FIRST and selected when nothing is chosen, so an entity created
 * without engaging with this question behaves exactly as it did before.
 */
export const STANDARD_FIELDS: StartingFieldChoice = {
  type: null,
  label: "Standard fields",
  hint: "Add fields yourself on the next screen.",
};

/**
 * The choices to offer, derived from what the installed plugins contribute.
 *
 * Returns only the default when no plugin offers an entries field type, which
 * is the signal to a caller that the question is not worth asking: a single
 * option is not a choice, and rendering one control with nothing to compare it
 * to is worse than rendering nothing.
 */
export function startingFieldChoices(
  pluginEntries: readonly FieldTypeCatalogEntry<string>[]
): StartingFieldChoice[] {
  return [
    STANDARD_FIELDS,
    ...pluginEntries.map(entry => ({
      type: entry.type,
      label: entry.label,
      hint: entry.hint,
    })),
  ];
}

/** Whether the question has more than one answer and is worth putting to anyone. */
export function hasStartingFieldChoice(
  choices: readonly StartingFieldChoice[]
): boolean {
  return choices.length > 1;
}

/**
 * The fields a newly created entity is given.
 *
 * Empty for the default, which is what the create call already sent — the
 * server injects the system columns either way, so an empty list is a complete
 * answer rather than a missing one.
 *
 * The seeded field's NAME is derived from its type rather than asked for. A
 * name prompt at create time is a second question about something the author
 * has no opinion on yet, and every one of these fields is the entity's body:
 * the author renames it later if they care.
 */
export function startingFields(
  type: string | null
): Array<{ name: string; type: string }> {
  if (type === null) return [];
  return [{ name: startingFieldName(type), type }];
}

/**
 * A field name that is stable, lower-case and free of separators a column name
 * cannot carry.
 *
 * Derived from the type so two entities created with the same choice agree,
 * which is what lets a template or a query written against one work on the
 * other. A plugin type id may carry a namespace (`acme/blocks`), so only the
 * last segment is used and anything outside `a-z0-9_` is dropped.
 */
export function startingFieldName(type: string): string {
  const last = type.split("/").pop() ?? type;
  const cleaned = last.toLowerCase().replace(/[^a-z0-9_]+/g, "_");
  // A type made entirely of separators would reduce to nothing, and a field
  // with an empty name is rejected by the API with an error naming neither the
  // field nor the choice that produced it.
  return cleaned.replace(/^_+|_+$/g, "") || "content";
}
