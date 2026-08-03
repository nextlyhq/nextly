import type { DesiredSchema } from "../pipeline/types";

/**
 * A text field with no stated width, on an entity the Schema Builder owns, describes an unbounded
 * column.
 *
 * `getColumnDescriptor` reads an unstated width as the bounded kind, which renders `varchar(255)` on
 * MySQL. The generator the Builder's create path used before it moved onto the shared pipeline read
 * the same silence as unbounded `TEXT`. Both are defensible, but they are 255 and 65 535 characters
 * apart, so leaving the silence to be interpreted means a field created before the move and an
 * identical field created after it hold different amounts of text.
 *
 * Changing the descriptor's default instead would be wrong: that default is also what every
 * code-first table was built with, so moving it would make all of them read as drift and stop
 * `nextly migrate` from applying anything. The two paths need different answers because they have
 * different histories, and `locked` already records which history a table has.
 *
 * 🔴 Applied to the whole `DesiredSchema` at the entrance to apply and preview, and nowhere else.
 *
 * That placement is load-bearing, because a desired schema is read TWICE by two different builders:
 * `buildDesiredTableFromFields` produces the snapshot the diff compares, and `generateRuntimeSchema`
 * produces the Drizzle tables drizzle-kit turns into DDL. Resolving inside either one leaves the
 * other reading the raw fields, and the two then disagree permanently: the diff expects `text` while
 * the DDL creates `varchar(255)`, so a table converges and immediately reports a type change again.
 * Normalising the input they share is the only placement that makes them agree by construction.
 *
 * Doing it in a request handler is worse still — the handlers are many, and each preview path that
 * builds its own desired schema would have to remember.
 */

/** The width signals a field can carry, named structurally because callers pass several field types. */
interface WidthSignals {
  type?: string;
  options?: unknown;
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

/**
 * Resolve the width of every unstated text field in a Builder-owned entity's field list.
 *
 * Only an explicit `variant` counts as stating the width. A `maxLength` or a `length` deliberately
 * does NOT, because the descriptor renders neither: treating one as authoritative would leave a
 * field declaring 500 characters in a `varchar(255)` column, rejecting values the stored validation
 * limit accepts. Until a width can survive the diff, the honest reading of an unstated field is
 * unbounded — wider than a bounded column, and never narrower than the data it is asked to hold.
 *
 * Idempotent: a field this has resolved states a variant, so a second pass leaves it alone. Returns
 * the original array when nothing needed resolving.
 */
function resolveFieldWidths<T>(fields: readonly T[]): readonly T[] {
  let changed = false;

  const out = fields.map(field => {
    const candidate = field as T & WidthSignals;
    if (candidate.type !== "text") return field;

    const options = modifierOptions(candidate.options);
    if (options === undefined) return field;
    if (options.variant !== undefined) return field;

    changed = true;
    return { ...candidate, options: { ...options, variant: "long" } };
  });

  return changed ? out : fields;
}

/**
 * Return a desired schema whose Builder-owned entities state the width of every text field.
 *
 * A `locked` entity is owned by code-first config or a plugin, and its columns were built by the
 * path whose default is the bounded kind. Rewriting those would make every code-first table read as
 * drift and stop `nextly migrate` applying anything, so they are left exactly as they are.
 *
 * Copies rather than mutates: the caller's schema is often the registry's own objects, and a
 * preview must not leave a field changed behind it.
 */
export function withResolvedBuilderTextWidths(
  desired: DesiredSchema
): DesiredSchema {
  const resolveGroup = <
    E extends { fields: readonly unknown[]; locked?: boolean },
  >(
    group: Record<string, E>
  ): Record<string, E> => {
    const out: Record<string, E> = {};
    for (const [key, entity] of Object.entries(group)) {
      if (entity.locked === true) {
        out[key] = entity;
        continue;
      }
      const fields = resolveFieldWidths(entity.fields);
      out[key] = fields === entity.fields ? entity : { ...entity, fields };
    }
    return out;
  };

  return {
    collections: resolveGroup(desired.collections),
    singles: resolveGroup(desired.singles),
    components: resolveGroup(desired.components),
  };
}
