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
 * survived into a single's row — the same request that a collection rejected. A shared list makes
 * that divergence impossible rather than merely fixed once.
 *
 * @module lib/immutable-system-fields
 */

/**
 * Both spellings of every column: config validation accepts camelCase field names and
 * snake-cases them to the same physical column, so reserving only one spelling reserves nothing.
 *
 * `first_published_at` is here for a reason the others are not. It is meant to be written once
 * and never moved, and a value taken from the request would make that guarantee decorative: a
 * draft create could claim a publication that never happened, and any later update could reset a
 * real one.
 *
 * `created_by` is not a column on a single's table, but stripping it there is still correct — a
 * caller cannot write an owner to an entity that has none.
 */
export const IMMUTABLE_SYSTEM_FIELDS: ReadonlySet<string> = new Set([
  "id",
  "created_at",
  "createdAt",
  "updated_at",
  "updatedAt",
  "created_by",
  "createdBy",
  "first_published_at",
  "firstPublishedAt",
]);

/**
 * A copy of `data` without any client-supplied system column.
 *
 * Returns a new object rather than mutating, so a caller can keep the original for hooks or
 * event payloads that legitimately describe what was requested.
 */
export function stripImmutableSystemFields(
  data: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (!IMMUTABLE_SYSTEM_FIELDS.has(key)) out[key] = value;
  }
  return out;
}
