/**
 * System columns a client must never write.
 *
 * These are not declared fields, so field validation passes them straight through to the row.
 * Stripping them on every write is what keeps the service authoritative: the generated id, the
 * owner stamp, the timestamps and the first-publication marker are decided here, not by whatever
 * a caller put in the body.
 *
 * Owned in one place because the entities that need it are written by different services. The
 * collection writer had this list and the single writer did not, so a marker a caller supplied
 * survived into a single's row — the same request that a collection rejected.
 *
 * The set is NOT "every system column". `title`, `slug` and `status` are system-injected and
 * fully writable: they are content and lifecycle, not provenance. Only the columns the service
 * alone decides belong here.
 *
 * @module lib/immutable-system-fields
 */

/** Which entity is being written. The owner column exists on only one of them. */
export type WritableEntityKind = "collection" | "single";

/**
 * Reserved on every entity, in both spellings: config validation accepts camelCase field names
 * and snake-cases them to the same physical column, so reserving one spelling reserves nothing.
 *
 * `first_published_at` is here for a reason the timestamps are not. It is meant to be written
 * once and never moved, and a value taken from the request would make that guarantee decorative:
 * a draft create could claim a publication that never happened, and any later update could reset
 * a real one.
 */
const ALWAYS_IMMUTABLE: readonly string[] = [
  "id",
  "created_at",
  "createdAt",
  "updated_at",
  "updatedAt",
  "first_published_at",
  "firstPublishedAt",
];

/**
 * Reserved on collections only.
 *
 * A single is one global row, so owner-only access is meaningless and no `created_by` column is
 * injected onto its table — which leaves `created_by` an ordinary, legal field name for a single
 * to declare, and the single validator reserves only the publication marker for exactly that
 * reason. Stripping it there would silently discard a user's own column on every update, so the
 * reservation follows the column rather than the convenience of one shared list.
 */
const COLLECTION_ONLY_IMMUTABLE: readonly string[] = [
  "created_by",
  "createdBy",
];

const COLLECTION_SET: ReadonlySet<string> = new Set([
  ...ALWAYS_IMMUTABLE,
  ...COLLECTION_ONLY_IMMUTABLE,
]);
const SINGLE_SET: ReadonlySet<string> = new Set(ALWAYS_IMMUTABLE);

/** The names a client may not write for the given entity. */
export function immutableSystemFieldsFor(
  entity: WritableEntityKind
): ReadonlySet<string> {
  return entity === "single" ? SINGLE_SET : COLLECTION_SET;
}

/**
 * A copy of `data` without any client-supplied system column for that entity.
 *
 * Returns a new object rather than mutating, so a caller can keep the original for hooks or
 * event payloads that legitimately describe what was requested.
 */
export function stripImmutableSystemFields(
  data: Record<string, unknown>,
  entity: WritableEntityKind
): Record<string, unknown> {
  const reserved = immutableSystemFieldsFor(entity);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (!reserved.has(key)) out[key] = value;
  }
  return out;
}
