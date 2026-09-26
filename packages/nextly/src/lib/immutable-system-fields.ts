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

import { fieldProducesColumn } from "../domains/schema/services/field-column-descriptor";
import { hiddenColumnMatcher } from "../shared/lib/password-fields";

import { toSnakeCase } from "./case-conversion";
import {
  immutableSystemColumnNames,
  immutableSystemColumnNamesAnyEntity,
  systemColumnNames,
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
 * The payload keys that name a declared field with no column on the entity's own row.
 *
 * Asked of `fieldProducesColumn`, the descriptor's answer to which fields become columns, so the
 * write cannot disagree with the table the pipeline generated. A virtual field is the case this
 * exists for: it is declared, validated and hooked like any other, and a document computed on read
 * carries it back on the next write. Component and many-to-many fields are column-less too; every
 * write path moves their values to their own tables before the row is built, so matching them here
 * only ever removes a key that could not have been written.
 *
 * Both spellings, because a payload reaches the strip camelCased on some paths and snake_cased on
 * others — the snake form by the same conversion the write paths use to build column keys. A name that is itself one of the entity's system columns is left alone: a column-less
 * field does not claim the column (the generator still injects it beside the field), so the key
 * addresses that column.
 */
function columnlessFieldKeys(
  fields: Iterable<DeclaredField | null | undefined>,
  entity: WritableEntityKind
): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const field of fields) {
    if (!field || typeof field.name !== "string") continue;
    if (fieldProducesColumn(field)) continue;
    keys.add(field.name);
    keys.add(toSnakeCase(field.name));
  }
  for (const column of SYSTEM_COLUMN_KEYS_BY_ENTITY[entity])
    keys.delete(column);
  return keys;
}

/** Every spelling of every system column each entity's table carries. */
const SYSTEM_COLUMN_KEYS_BY_ENTITY: Readonly<
  Record<WritableEntityKind, readonly string[]>
> = {
  collection: systemColumnNames(column =>
    column.appliesTo.includes("collection")
  ),
  single: systemColumnNames(column => column.appliesTo.includes("single")),
};

/** The loose shape of a declared field this module reads; see `fieldProducesColumn`. */
type DeclaredField = {
  name?: unknown;
  type?: unknown;
  options?: unknown;
  virtual?: unknown;
};

/**
 * A copy of `data` holding only what may be written to that entity's row: without its immutable
 * system columns, the columns schema hooks contributed to it, and any declared field that has no
 * column there.
 *
 * Returns a new object rather than mutating, so a caller can keep the original for hooks or
 * event payloads that legitimately describe what was requested.
 *
 * The contributed set is matched by the same predicate `stripServerOnlyColumns` uses on
 * responses, so the read and the write cannot disagree about which columns are hidden. It is
 * asked per TABLE, as that read is: a contributed name is not namespaced, and a field of the same
 * name on another entity is that entity's own.
 *
 * `fields` is required rather than optional because a caller that forgot it would reach the
 * adapter with a virtual field's value, which names a column the table does not have and fails
 * the whole write.
 */
export function stripImmutableSystemFields(
  data: Record<string, unknown>,
  entity: WritableEntityKind,
  /** The SQL table the payload is written to. */
  tableName: string,
  /** The entity's declared top-level fields. */
  fields: Iterable<DeclaredField | null | undefined>
): Record<string, unknown> {
  const reserved = immutableSystemFieldsFor(entity);
  const isHidden = hiddenColumnMatcher(tableName);
  const columnless = columnlessFieldKeys(fields, entity);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (reserved.has(key) || isHidden(key) || columnless.has(key)) continue;
    out[key] = value;
  }
  return out;
}
