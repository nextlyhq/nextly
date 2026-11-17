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
 * it through `ctx.db.contributed`, which reaches that column and no other. It is dropped rather
 * than refused because that is what happens to every other real column that is not a field here,
 * and a caller round-tripping a document cannot have read it in the first place.
 *
 * @module lib/immutable-system-fields
 */

import { isVirtualField } from "../collections/fields/virtual";
import { WITHOUT_REVIEW_KEY } from "../domains/collections/services/save-door-gate";
import { TRANSLATION_OVERVIEW_KEY } from "../domains/i18n/companion-join";
import { fieldProducesColumn } from "../domains/schema/services/field-column-descriptor";
import { NextlyError } from "../errors";
import { addressableFields } from "../shared/addressable-fields";
import { hiddenColumnMatcher } from "../shared/lib/password-fields";

import { toSnakeCase } from "./case-conversion";
import {
  DOCUMENT_OVERWRITE_KEY,
  DOCUMENT_RESTORED_FROM_KEY,
  DOCUMENT_VERSION_KEY,
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
  // The published version is no column, but a client re-saving what it read sends it, and it is
  // the server's to decide like every column here. The overwrite choice beside it says how the
  // version is judged and is never stored either, so a body naming only the status beside them
  // is still a status-only write ({@link isStatusOnlyWrite}).
  collection: new Set([
    ...immutableSystemColumnNames("collection"),
    DOCUMENT_VERSION_KEY,
    DOCUMENT_OVERWRITE_KEY,
  ]),
  single: new Set([
    ...immutableSystemColumnNames("single"),
    DOCUMENT_VERSION_KEY,
    DOCUMENT_OVERWRITE_KEY,
  ]),
};

/**
 * The columns closed to clients on any entity at all.
 *
 * For callers that protect both kinds at once rather than one at a time: a restore refuses to
 * carry the owner column back even for a single, where it is not a system column.
 */
export const IMMUTABLE_SYSTEM_FIELDS_ANY_ENTITY: ReadonlySet<string> = new Set([
  ...immutableSystemColumnNamesAnyEntity(),
  DOCUMENT_VERSION_KEY,
  DOCUMENT_OVERWRITE_KEY,
]);

/** The names a client may not write for the given entity. */
export function immutableSystemFieldsFor(
  entity: WritableEntityKind
): ReadonlySet<string> {
  return IMMUTABLE_BY_ENTITY[entity];
}

/**
 * The gate a status-only write is judged by: `publish` for `"published"`, the
 * one value that puts an entry live, and `unpublish` for any other, which can
 * only take a published entry down.
 */
export function statusGate(status: unknown): "publish" | "unpublish" {
  return status === "published" ? "publish" : "unpublish";
}

/**
 * The gate a write is judged by: where its body changes only the status of an
 * entry with a lifecycle ({@link isStatusOnlyWrite}), the `publish` or
 * `unpublish` its status names ({@link statusGate}), whether or not the status
 * moves; otherwise `update`. `hasLifecycle` is asked only for a status-only
 * body, so an ordinary edit never reads it.
 */
export async function writeGateFor(
  body: Record<string, unknown>,
  entity: WritableEntityKind,
  hasLifecycle: () => boolean | Promise<boolean>
): Promise<"update" | "publish" | "unpublish"> {
  return isStatusOnlyWrite(body, entity) && (await hasLifecycle())
    ? statusGate(body.status)
    : "update";
}

/**
 * Whether a write's body changes nothing but the entry's status: it names
 * `status`, and every other key it names is a system column the write never
 * stores from a body ({@link immutableSystemFieldsFor}). Such a write is a
 * publish or an unpublish alone, judged by that permission and rule.
 *
 * Judged by the keys the body names, never their values: a body naming any
 * other field, even at its stored value, edits the entry and needs update. A
 * declared field with no column of its own counts as an edit too, since hooks
 * may still read it.
 */
export function isStatusOnlyWrite(
  body: Record<string, unknown>,
  entity: WritableEntityKind
): boolean {
  // Only a key the body owns: a `status` its prototype supplies is no key it
  // names, and the write reads only its own keys.
  if (!Object.prototype.hasOwnProperty.call(body, "status")) return false;
  // A status left `undefined` names none: the write drops it as it drops any
  // undefined status, so it is judged as the write it is.
  if (body.status === undefined) return false;
  const neverStored = immutableSystemFieldsFor(entity);
  return Object.keys(body).every(
    key => key === "status" || neverStored.has(key)
  );
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

/**
 * The keys of `data` an update of that entity stores nowhere: those
 * {@link stripImmutableSystemFields} takes out of its row, except a declared
 * field the update keeps in a table of its own (a field group's, or a
 * many-to-many's junction), which the write paths take out of the payload and
 * write there before the row strip runs. What is left is an immutable system
 * column, a column schema hooks contributed, or a field stored nowhere (a
 * virtual one).
 *
 * Asked of the strip itself and of {@link fieldProducesColumn}'s own causes,
 * so neither can drift from this answer: a field it gives no column, and that
 * is not virtual, keeps its values in its own table.
 */
export function keysNoUpdateStores(
  data: Record<string, unknown>,
  entity: WritableEntityKind,
  /** The SQL table the payload is written to. */
  tableName: string,
  /** The entity's declared top-level fields. */
  fields: Iterable<DeclaredField | null | undefined>
): string[] {
  const declared = [...fields];
  const kept = stripImmutableSystemFields(data, entity, tableName, declared);
  const ownTable = keptInOwnTable(declared);
  return Object.keys(data).filter(
    key => !Object.hasOwn(kept, key) && !ownTable.has(key)
  );
}

/**
 * The name of each declared field whose values live in a table of its own,
 * spelt exactly as declared: the write paths take such a value out of the
 * payload by `field.name` alone, so any other spelling of it reaches the row
 * strip and is stored nowhere.
 */
function keptInOwnTable(
  fields: readonly (DeclaredField | null | undefined)[]
): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const field of fields) {
    if (!field || typeof field.name !== "string") continue;
    if (fieldProducesColumn(field) || isVirtualField(field)) continue;
    keys.add(field.name);
  }
  return keys;
}

/**
 * The keys a read adds to a document of its own (the translation overview, whether the document
 * shown is a pending change, whether the shared part holds one). A client sending back what it
 * read sends them too; a write accepts them and stores none.
 */
const READ_RESPONSE_KEYS: ReadonlySet<string> = new Set([
  TRANSLATION_OVERVIEW_KEY,
  "_isWorkingDraft",
  "_sharedChangesPending",
]);

/**
 * The keys a save names beside its values to say how it is made, read off the body before it is
 * written and never stored: a publish made without review, which the publish gate is told.
 */
const WRITE_OPTION_KEYS: ReadonlySet<string> = new Set([WITHOUT_REVIEW_KEY]);

/** The keys a write accepts and takes off its body before anything reads it as values. */
const NOT_STORED_KEYS: ReadonlySet<string> = new Set([
  ...READ_RESPONSE_KEYS,
  ...WRITE_OPTION_KEYS,
]);

/**
 * The keys of a write's body that name nothing a write of that entity may carry: no declared
 * field under its declared name, no system column of the entity, none of the keys that say how
 * to write (`_rev`, `_overwrite`, `_restoredFrom`) and none a read adds.
 *
 * Such a key has nowhere to go but a column of the same name: on the entity's own row, where a
 * name that is no column fails the statement, or on a language's row, where it would be stored.
 * A field's column name is no second name for it: field rules, validation and hooks look a field
 * up by its declared name, so a value under its column's name would pass them by.
 */
function undeclaredWriteKeys(
  data: Record<string, unknown>,
  entity: WritableEntityKind,
  /** The entity's declared fields, as configured. */
  fields: unknown
): string[] {
  const allowed = new Set<string>([
    ...systemColumnNames(column => column.appliesTo.includes(entity)),
    DOCUMENT_VERSION_KEY,
    DOCUMENT_OVERWRITE_KEY,
    DOCUMENT_RESTORED_FROM_KEY,
    ...NOT_STORED_KEYS,
  ]);
  for (const field of addressableFields(fields)) {
    if (typeof field.name === "string") allowed.add(field.name);
  }
  return Object.keys(data).filter(key => !allowed.has(key));
}

/**
 * A write's body as the write handles it: refused, with one validation issue per key, where it
 * names a key it may not carry ({@link undeclaredWriteKeys}); otherwise without the keys a read
 * adds, which say nothing about what to write. Called once the write's access has been judged and
 * before any hook runs, so nothing of a refused key is ever written.
 */
export function writableBodyOf(
  data: Record<string, unknown>,
  entity: WritableEntityKind,
  fields: unknown
): Record<string, unknown> {
  const keys = undeclaredWriteKeys(data, entity, fields);
  if (keys.length > 0) {
    const kind = entity === "single" ? "Single" : "collection";
    throw NextlyError.validation({
      errors: keys.map(key => ({
        path: key,
        code: "UNKNOWN_FIELD",
        message: `"${key}" is not a field of this ${kind}, so a save cannot set it.`,
      })),
    });
  }
  if (!Object.keys(data).some(key => NOT_STORED_KEYS.has(key))) return data;
  return Object.fromEntries(
    Object.entries(data).filter(([key]) => !NOT_STORED_KEYS.has(key))
  );
}
