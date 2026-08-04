/**
 * System columns a client must never write.
 *
 * These are not declared fields, so field validation passes them straight through to the row.
 * Stripping them on every write is what keeps the service authoritative: the generated id, the
 * owner stamp, the timestamps and the first-publication marker are decided here, not by whatever
 * a caller put in the body.
 *
 * The set is a projection of the system-column declarations rather than a list of its own. The
 * collection writer had a list and the single writer did not, so a marker a caller supplied
 * survived into a single's row on the same request a collection rejected.
 *
 * It is NOT "every system column". `title`, `slug` and `status` are system-injected and fully
 * writable: they are content and lifecycle, not provenance. Only the columns the service alone
 * decides are closed, which is exactly what `writableByClient` records.
 *
 * @module lib/immutable-system-fields
 */

import {
  immutableSystemColumnNames,
  immutableSystemColumnNamesAnyEntity,
  type SystemColumnEntity,
} from "./system-columns";

/** Which entity is being written. The owner column exists on only one of them. */
export type WritableEntityKind = SystemColumnEntity;

/**
 * Built once per entity, because the answer cannot change at runtime and every write asks it.
 *
 * A single is one global row, so owner-only access is meaningless and no `created_by` column is
 * injected onto its table — which leaves `created_by` an ordinary, legal field name for a single
 * to declare. Stripping it there would silently discard the author's own column on every update,
 * so the reservation follows the column, which is what `appliesTo` on the declaration expresses.
 */
const IMMUTABLE_BY_ENTITY: Readonly<
  Record<WritableEntityKind, ReadonlySet<string>>
> = {
  collection: new Set(immutableSystemColumnNames("collection")),
  single: new Set(immutableSystemColumnNames("single")),
};

/**
 * The columns closed to clients on any entity at all.
 *
 * For callers that protect both kinds at once rather than one at a time: a restore refuses to
 * carry the owner column back even for a single, where it is not a system column.
 */
export const IMMUTABLE_SYSTEM_FIELDS_ANY_ENTITY: ReadonlySet<string> = new Set(
  immutableSystemColumnNamesAnyEntity()
);

/** The names a client may not write for the given entity. */
export function immutableSystemFieldsFor(
  entity: WritableEntityKind
): ReadonlySet<string> {
  return IMMUTABLE_BY_ENTITY[entity];
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
