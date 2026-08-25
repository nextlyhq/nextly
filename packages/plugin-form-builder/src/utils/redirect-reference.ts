/**
 * Reading the document a form's redirect setting points at.
 *
 * Separate from `redirect-target` because this half has no dependencies and
 * the other half imports `nextly/config`: the admin picker needs to read a
 * stored reference to show what is selected, and pulling the config surface
 * into the browser bundle to do it would be a real cost for no gain.
 */

/** A document being turned into a URL. `id` is always present; the rest is the row. */
export interface RedirectTargetDocument {
  id: string;
  [field: string]: unknown;
}

/** A stored relationship value reduced to the collection and id it names. */
export interface RedirectReference {
  collection: string;
  id: string;
}

/**
 * The reference a `redirectPage` value holds, in any shape a read produces.
 *
 * Three arrive in practice and they are not interchangeable: a polymorphic
 * field stores `{ relationTo, value }`; a read at depth replaces `value` with
 * the populated row; and a single-target field stores the bare id. The last
 * names no collection, so it resolves only when exactly one is configured —
 * guessing which of several a bare id belongs to would send visitors to a
 * URL built from the wrong collection's pattern.
 */
export function parseRedirectReference(
  value: unknown,
  collections: readonly string[]
): RedirectReference | null {
  if (value == null) return null;

  if (typeof value === "string") {
    // Emptiness checked here as `referenceId` already does below. Without it a
    // CLEARED `redirectPage` reads as a reference to id "", which validation
    // then accepts as a usable target and the submit path resolves to nothing.
    return value && collections.length === 1
      ? { collection: collections[0], id: value }
      : null;
  }

  if (typeof value !== "object" || Array.isArray(value)) return null;

  const record = value as Record<string, unknown>;
  const relationTo = record.relationTo;
  const inner = record.value;

  if (typeof relationTo === "string") {
    const id = referenceId(inner);
    return id ? { collection: relationTo, id } : null;
  }

  // A populated row with no `relationTo` beside it: same ambiguity as a bare
  // id, and the same answer.
  const id = referenceId(record);
  if (!id) return null;
  return collections.length === 1 ? { collection: collections[0], id } : null;
}

function referenceId(value: unknown): string | null {
  if (typeof value === "string") return value || null;
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const { id } = value as Record<string, unknown>;
    if (typeof id === "string" && id) return id;
  }
  return null;
}
