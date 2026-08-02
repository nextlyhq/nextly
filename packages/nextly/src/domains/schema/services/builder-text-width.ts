import type { DesiredSchema } from "../pipeline/types";

/**
 * A text field with no declared width, on an entity the Schema Builder owns, describes an unbounded
 * column.
 *
 * `getColumnDescriptor` reads an unstated width as the bounded kind, which renders `varchar(255)` on
 * MySQL. The generator the Builder's create path used before it moved onto the shared pipeline read
 * the same silence as unbounded `TEXT`. Both are defensible, but they are 255 and 65 535 characters
 * apart, so leaving the silence to be interpreted means a field created before the move and an
 * identical field created after it hold different amounts of text.
 *
 * Resolving it by changing the descriptor's default instead would be wrong: that default is also
 * what every **code-first** table was built with, so moving it would make all of them read as drift
 * and stop `nextly migrate` from applying anything. The two paths need different answers because
 * they have different histories.
 *
 * Which history a table has is already recorded. `locked` marks an entity as owned by code-first
 * config or a plugin, so an unlocked entity is one the Builder created, and its unstated widths are
 * the Builder's. Reading that flag keeps the decision derivable from stored state rather than
 * carried in a field payload — which matters twice over: the payload schema declares `options` as
 * the select/radio choice **array**, so a marker written there fails validation, and only the
 * entity being saved passes through a handler while the diff compares every entity at once.
 */
export function resolveBuilderTextWidths(desired: DesiredSchema): void {
  for (const group of [
    desired.collections,
    desired.singles,
    desired.components,
  ]) {
    for (const entity of Object.values(group)) {
      // A locked entity is code-first or plugin-owned, and its columns were built by the path whose
      // default is the bounded kind. Rewriting those would make every one of them read as drift.
      if (entity.locked === true) continue;
      entity.fields = widenUnstatedText(entity.fields);
    }
  }
}

/**
 * The width signals a field can carry, named structurally because the desired schema's three entity
 * kinds each declare their own field element type.
 */
interface WidthSignals {
  type?: string;
  length?: number;
  options?: unknown;
  validation?: { maxLength?: number } | null;
}

/** An `options` value a variant can be written onto without destroying what is already there. */
function modifierOptions(
  options: unknown
): Record<string, unknown> | undefined {
  if (options === undefined) return {};
  // `options` is the choice array on a select or radio and an object of modifiers elsewhere. An
  // array cannot carry a variant, and replacing it with one would discard the choices, so a field
  // holding one is left exactly as it is.
  if (options === null || typeof options !== "object") return undefined;
  if (Array.isArray(options)) return undefined;
  return { ...(options as Record<string, unknown>) };
}

function statesWidth(
  field: WidthSignals,
  options: Record<string, unknown>
): boolean {
  if (field.length !== undefined) return true;
  if (typeof field.validation?.maxLength === "number") return true;
  return options.variant !== undefined;
}

function widenUnstatedText<T>(fields: readonly T[]): T[] {
  return fields.map(field => {
    const candidate = field as T & WidthSignals;
    if (candidate.type !== "text") return field;

    const options = modifierOptions(candidate.options);
    if (options === undefined) return field;
    if (statesWidth(candidate, options)) return field;

    return { ...candidate, options: { ...options, variant: "long" } };
  });
}
