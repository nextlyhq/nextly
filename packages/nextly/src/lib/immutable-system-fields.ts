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
 * A column a schema hook contributed to the entity's table is closed for the same reason: it is a
 * real column that is no field, so nothing before the write removes it, and its contributor writes
 * it through `ctx.db`. It is dropped rather than refused because that is what happens to every
 * other real column that is not a field here, and a caller round-tripping a document cannot have
 * read it in the first place.
 *
 * @module lib/immutable-system-fields
 */

import { hiddenColumnMatcher } from "../shared/lib/password-fields";

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
 * A single is one global row with no per-user owner, so no `created_by` column is
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
 * A copy of `data` without any column a client may not write on that entity's table: its
 * immutable system columns, and the columns schema hooks contributed to it.
 *
 * Returns a new object rather than mutating, so a caller can keep the original for hooks or
 * event payloads that legitimately describe what was requested.
 *
 * The contributed set is matched by the same predicate `stripServerOnlyColumns` uses on
 * responses, so the read and the write cannot disagree about which columns are hidden. It is
 * asked per TABLE, as that read is: a contributed name is not namespaced, and a field of the same
 * name on another entity is that entity's own.
 */
export function stripImmutableSystemFields(
  data: Record<string, unknown>,
  entity: WritableEntityKind,
  /** The SQL table the payload is written to. */
  tableName: string
): Record<string, unknown> {
  const reserved = immutableSystemFieldsFor(entity);
  const isHidden = hiddenColumnMatcher(tableName);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (reserved.has(key) || isHidden(key)) continue;
    out[key] = value;
  }
  return out;
}
