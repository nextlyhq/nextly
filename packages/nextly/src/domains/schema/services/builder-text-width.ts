import { storageTypeToken } from "../../../shared/lib/plugin-storage";
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
  maxLength?: number;
}

/**
 * Whether a field ends up in a string column, resolving a contributed type to what it actually
 * stores.
 *
 * A plugin type declaring `storage: "text"` reaches the database through the same column as a plain
 * text field — both generators resolve it that way before rendering — so it needs the same answer
 * here. Matching the declared token alone left those fields on the bounded default while the table
 * held an unbounded column, which is the disagreement this module exists to remove.
 */
function storesText(field: WidthSignals): boolean {
  if (field.type === undefined) return false;
  if (field.type === "text") return true;
  return storageTypeToken({ type: field.type }) === "text";
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
 * What counts as stating the width is whatever the entity's own generator acts on, which is not the
 * same key for both — see `statesWidth`. A field that states nothing its generator reads is filled
 * in as unbounded, which is the honest reading: wider than a bounded column, and never narrower
 * than the data the field is asked to hold.
 *
 * A field that DOES state a width keeps it, and the descriptor renders that width rather than a
 * fixed 255, so a field declaring 500 characters gets a column that accepts what its own stored
 * validation accepts. What a declared width still cannot do is survive a later EDIT: the diff
 * strips length modifiers before comparing, so widening an existing column emits no resize.
 *
 * Idempotent: a field this has resolved states a variant, so a second pass leaves it alone. Returns
 * the original array when nothing needed resolving.
 */
function resolveFieldWidths<T>(
  fields: readonly T[],
  signal: "variant" | "maxLength"
): readonly T[] {
  let changed = false;

  const out = fields.map(field => {
    const candidate = field as T & WidthSignals;
    if (!storesText(candidate)) return field;

    const options = modifierOptions(candidate.options);
    if (options === undefined) return field;
    if (statesWidth(candidate, options, signal)) return field;

    changed = true;
    return { ...candidate, options: { ...options, variant: "long" } };
  });

  return changed ? out : fields;
}

/**
 * Return a desired schema whose Builder-owned entities state the width of every text field.
 *
 * An entity that does not state Builder ownership is left exactly as it is. Its columns were built
 * by the path whose default is the bounded kind, and rewriting those would make every code-first
 * table read as drift and stop `nextly migrate` applying anything.
 *
 * Copies rather than mutates: the caller's schema is often the registry's own objects, and a
 * preview must not leave a field changed behind it.
 */
/**
 * Whether a field already states a width its own generator will render.
 *
 * Each kind is given ONLY the signal its own generator acts on, because reading both would be wrong
 * for each in a different direction:
 *
 * - a field group's generator branches on a top-level `maxLength` and nothing else
 *   (`field-group-schema-service.ts`: `field.maxLength ? varchar(maxLength) : text`). It never reads
 *   a variant, so honouring one would leave that column unbounded while the diff expected it bounded.
 * - a collection's generator branches only on `options.variant === "short"`. A `maxLength` alone
 *   leaves that column unbounded, so honouring one would bound a column its generator never bounded.
 *
 * The caller states which generator a list belongs to rather than this guessing from the field.
 */
function statesWidth(
  field: WidthSignals,
  options: Record<string, unknown>,
  signal: "variant" | "maxLength"
): boolean {
  if (signal === "variant") return options.variant !== undefined;
  // Only for the built-in type. `asMappableField` strips `maxLength` from a contributed field
  // before the component creator maps it, so on one of those the key states nothing about the
  // column and honouring it would leave the field bounded against an unbounded table.
  return field.type === "text" && field.maxLength !== undefined;
}

export function withResolvedBuilderTextWidths(
  desired: DesiredSchema
): DesiredSchema {
  const resolveGroup = <
    E extends { fields: readonly unknown[]; builderOwned?: boolean },
  >(
    group: Record<string, E>,
    signal: "variant" | "maxLength"
  ): Record<string, E> => {
    const out: Record<string, E> = {};
    for (const [key, entity] of Object.entries(group)) {
      // Explicit, never inferred. Most snapshot builders omit any ownership flag, so anything other
      // than a stated yes has to mean code-first: the alternative reclassified every code-first
      // entity on the HMR and db:sync paths and would have widened their columns.
      if (entity.builderOwned !== true) {
        out[key] = entity;
        continue;
      }
      const fields = resolveFieldWidths(entity.fields, signal);
      out[key] = fields === entity.fields ? entity : { ...entity, fields };
    }
    return out;
  };

  return {
    collections: resolveGroup(desired.collections, "variant"),
    singles: resolveGroup(desired.singles, "variant"),
    // A field group's generator reads a declared `maxLength`, and never a variant.
    components: resolveGroup(desired.components, "maxLength"),
  };
}
