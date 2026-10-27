/**
 * Password-field value handling for the entry write/read paths.
 *
 * `password`-type fields hold secrets, so they get the same treatment as
 * user credentials: bcrypt-hashed before storage and never serialized back
 * to clients. Verification against a stored hash goes through
 * `verifyPassword` from `auth/password`.
 *
 * Password fields can live at any depth — directly on a collection, or
 * nested inside a `group` or `repeater` container — so every helper here
 * descends into container values. A nested password must never be stored
 * in plaintext or returned in a response.
 *
 * @module shared/lib/password-fields
 */

import { hashPassword } from "../../auth/password";
import { extractFieldGroupReferences } from "../../domains/field-groups/storage/field-group-field-type";
import { readFieldGroupType } from "../../domains/field-groups/storage/field-group-type-key";
import { hiddenColumnNames } from "../../domains/schema/extension/active-schema";
import { NextlyError } from "../../errors";
import { systemColumnNames } from "../../lib/system-columns";

import { toCamelCase, toSnakeCase } from "./case-conversion";

/** The minimal field shape both FieldConfig and FieldDefinition satisfy. */
interface NamedField {
  name?: string;
  // `string`, not the strict field-type union: these helpers accept both
  // code-first FieldConfig[] and runtime FieldDefinition[], whose `type`
  // unions differ, so `string` is their only common supertype.
  type: string;
  /** Nested fields for `group` / `repeater` container types. */
  fields?: NamedField[];
}

/** A `group` value is one object; a `repeater` value is an array of rows. */
function containerRows(
  value: unknown,
  type: string
): Record<string, unknown>[] {
  if (type === "group") {
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? [value as Record<string, unknown>]
      : [];
  }
  if (type === "repeater") {
    return Array.isArray(value)
      ? value.filter(
          (row): row is Record<string, unknown> =>
            row !== null && typeof row === "object" && !Array.isArray(row)
        )
      : [];
  }
  return [];
}

/**
 * Resolve a container field value to its descendable rows. On SQLite a
 * `group` / `repeater` is stored as a JSON string, so the raw value must be
 * parsed before its nested passwords are reachable. `serialize()` writes the
 * (mutated) container back in the original shape — a string when the input
 * was a string, so the column type is preserved. Returns null when a string
 * value is not valid JSON (nothing to descend into).
 */
function openContainer(
  value: unknown,
  type: string
): { rows: Record<string, unknown>[]; serialize: () => unknown } | null {
  const wasString = typeof value === "string";
  let container: unknown = value;
  if (wasString) {
    try {
      container = JSON.parse(value);
    } catch {
      return null;
    }
  }
  return {
    rows: containerRows(container, type),
    serialize: () => (wasString ? JSON.stringify(container) : container),
  };
}

/**
 * Where the walk below may follow a field-group reference: the fields of the
 * field group a slug names, and whether to follow one placed directly on the
 * entry.
 *
 * A field group held INLINE, inside a group, a repeater or another field
 * group's container, is stored in that container's value, so its passwords
 * sit there too and only this walk reaches them. One placed directly on the
 * entry is stored in its own table, and hashed and withheld by the save and
 * the read that handle that table; an entry-level walk leaves it alone, or a
 * hash would be hashed again. A snapshot holds every instance inline, so it
 * follows both (`direct`).
 */
export interface FieldGroupReach {
  /** The fields of the field group `slug` names, or `undefined` when unknown. */
  fieldsOf(slug: string): readonly NamedField[] | undefined;
  /** Follow a field group placed directly on the entry as well. */
  direct?: boolean;
  /**
   * Whether a field of the entry holds a value per language, keyed by code:
   * a read of every translation returns each translated field that way, so
   * the walk descends into each language's value in turn.
   */
  keyedByLanguage?: (field: NamedField) => boolean;
}

/**
 * The reach of fields that hold no field group inline. A walk given it that
 * meets one anyway treats it as unknown: a write refuses and a read withholds
 * it, so a caller that wrongly passes this fails visibly, never by leaking.
 */
export const NO_FIELD_GROUPS: FieldGroupReach = { fieldsOf: () => undefined };

/**
 * An instance the walk meets but cannot read: one whose field group it has no
 * fields for. Returns whether to withhold that instance from the value.
 */
type OnUnknown = (slug: string | undefined) => boolean;

/** What one walk does at each level, and with an instance it cannot read. */
interface PasswordWalk {
  reach: FieldGroupReach;
  /**
   * The fields declared directly at one level of the value: the entry, a
   * container row, or an inline field-group instance.
   */
  level: (
    level: Record<string, unknown>,
    fields: readonly NamedField[]
  ) => void;
  onUnknown: OnUnknown;
  /**
   * An untyped row of a dynamic zone: judged by every candidate's fields at
   * once, which over-strips rather than leaks, or treated as unknown where
   * guessing its schema would damage it.
   */
  untypedZoneRows: "union" | "unknown";
}

/**
 * Visit every level of `value` that can hold a password, at any depth: the
 * value itself, through layout containers, groups and repeaters (held as
 * JSON text on SQLite, and written back in that shape), and through the field
 * groups they hold inline.
 *
 * The one traversal password handling has: the write's hash, the read's
 * strip and a snapshot's strip are each this walk with a different `level`,
 * so they cannot disagree about where a password can be. Bounded by the data,
 * which is finite, rather than by the schema, which may reference itself.
 */
function walkPasswordLevels(
  value: unknown,
  fields: readonly NamedField[],
  walk: PasswordWalk,
  atEntry = true,
  open: WeakSet<object> = new WeakSet()
): void {
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const row of value) walkPasswordLevels(row, fields, walk, atEntry);
    return;
  }
  const level = value as Record<string, unknown>;
  walk.level(level, fields);
  for (const field of fields) walkLevelField(level, field, walk, atEntry, open);
}

/** {@link walkPasswordLevels} through one field of a level. */
function walkLevelField(
  level: Record<string, unknown>,
  field: NamedField,
  walk: PasswordWalk,
  atEntry: boolean,
  open: WeakSet<object>
): void {
  if (!field.name) {
    // A layout container keeps its fields on this level. `open` holds the
    // ones open on this path, so one that reaches itself terminates.
    if (!field.fields || open.has(field)) return;
    open.add(field);
    walkPasswordLevels(level, field.fields, walk, atEntry, open);
    open.delete(field);
    return;
  }
  if (!(field.name in level)) return;
  if (atEntry && walk.reach.keyedByLanguage?.(field) === true) {
    walkEachLanguage(level, field.name, field, walk);
  } else {
    walkNamedField(level, field.name, field, walk, atEntry);
  }
}

/** {@link walkPasswordLevels} through the value one named field holds. */
function walkNamedField(
  level: Record<string, unknown>,
  name: string,
  field: NamedField,
  walk: PasswordWalk,
  atEntry: boolean
): void {
  // A container first: a reference rewritten into one (`expandComponentFields`)
  // keeps the slug it named, and its fields already say what it holds.
  if (field.fields && (field.type === "group" || field.type === "repeater")) {
    walkContainer(level, name, field.type, field.fields, walk);
    return;
  }
  const { single, many } = extractFieldGroupReferences(field);
  if (single !== undefined || many !== undefined) {
    if (atEntry && walk.reach.direct !== true) return;
    walkFieldGroupValue(level, name, { single, many }, walk);
  }
}

/** {@link walkPasswordLevels} through the rows of one group or repeater. */
function walkContainer(
  level: Record<string, unknown>,
  name: string,
  type: string,
  fields: readonly NamedField[],
  walk: PasswordWalk
): void {
  const opened = openContainer(level[name], type);
  if (!opened) return;
  for (const row of opened.rows) walkPasswordLevels(row, fields, walk, false);
  level[name] = opened.serialize();
}

/**
 * {@link walkNamedField} for a field holding one value per language: each
 * language's value walked as the field's own, and written back, or left out
 * where the walk withheld it.
 */
function walkEachLanguage(
  level: Record<string, unknown>,
  name: string,
  field: NamedField,
  walk: PasswordWalk
): void {
  const byLanguage = level[name];
  if (
    byLanguage === null ||
    typeof byLanguage !== "object" ||
    Array.isArray(byLanguage)
  ) {
    walkNamedField(level, name, field, walk, true);
    return;
  }
  const values = byLanguage as Record<string, unknown>;
  for (const code of Object.keys(values)) {
    const holder: Record<string, unknown> = { [name]: values[code] };
    walkNamedField(holder, name, field, walk, true);
    if (name in holder) values[code] = holder[name];
    else delete values[code];
  }
}

/**
 * {@link walkPasswordLevels} through the instances one field-group field
 * holds: one object, or a list of them. An instance the walk cannot read is
 * withheld where `onUnknown` says so: a list keeps the rest, and a single
 * instance leaves the field.
 */
function walkFieldGroupValue(
  holder: Record<string, unknown>,
  name: string,
  references: { single?: string; many?: string[] },
  walk: PasswordWalk
): void {
  rewriteValue(holder, name, value => {
    const isList = Array.isArray(value);
    const rows = isList ? (value as unknown[]) : [value];
    const kept = rows.filter(row => keepsInstance(row, references, walk));
    if (isList) return kept;
    return kept.length === 0 ? WITHHELD : kept[0];
  });
}

/** What {@link rewriteValue} is told to leave out of the holder. */
const WITHHELD = Symbol("withheld");

/**
 * Rewrite one value of `holder` through `rewrite`, parsing it first where it
 * is held as JSON text and writing it back in that shape; a value that is not
 * valid JSON is left alone.
 */
function rewriteValue(
  holder: Record<string, unknown>,
  name: string,
  rewrite: (value: unknown) => unknown
): void {
  const wasString = typeof holder[name] === "string";
  let value: unknown = holder[name];
  if (wasString) {
    try {
      value = JSON.parse(value as string);
    } catch {
      return;
    }
  }
  const next = rewrite(value);
  if (next === WITHHELD) {
    delete holder[name];
    return;
  }
  holder[name] = wasString ? JSON.stringify(next) : next;
}

/**
 * Walk one instance a field-group field holds, and say whether it stays:
 * anything that is not an instance stays as it is, and one whose fields are
 * not known stays only where `onUnknown` does not withhold it.
 */
function keepsInstance(
  row: unknown,
  references: { single?: string; many?: string[] },
  walk: PasswordWalk
): boolean {
  if (row === null || typeof row !== "object" || Array.isArray(row)) {
    return true;
  }
  const instance = row as Record<string, unknown>;
  const fields = instanceFields(instance, references, walk);
  if (fields === undefined) {
    return !walk.onUnknown(references.single ?? readFieldGroupType(instance));
  }
  walkPasswordLevels(instance, fields, walk, false);
  return true;
}

/**
 * The fields one instance is judged by: its field group's, or for a dynamic
 * zone's row the field group its type names. `undefined` when they are not
 * known.
 */
function instanceFields(
  instance: Record<string, unknown>,
  { single, many }: { single?: string; many?: string[] },
  walk: PasswordWalk
): readonly NamedField[] | undefined {
  const typed = readFieldGroupType(instance);
  // A snapshot (`direct`) is the server's own record of an instance, and
  // tags it with the field group it held when captured, which the field
  // may have been pointed away from since: it is read by that one. A live
  // value's tag is the writer's to set, so there it names only one of the
  // field's own field groups.
  if (walk.reach.direct === true && typed !== undefined) {
    return walk.reach.fieldsOf(typed);
  }
  if (single !== undefined) return walk.reach.fieldsOf(single);
  const candidates = many ?? [];
  if (typed !== undefined) {
    return candidates.includes(typed) ? walk.reach.fieldsOf(typed) : undefined;
  }
  if (walk.untypedZoneRows === "unknown") return undefined;
  const union: NamedField[] = [];
  for (const slug of candidates) {
    const found = walk.reach.fieldsOf(slug);
    if (found === undefined) return undefined;
    union.push(...found);
  }
  return union;
}

/** The password fields declared directly among `fields`, by name. */
function passwordNames(fields: readonly NamedField[]): string[] {
  return fields.flatMap(field =>
    field.type === "password" && field.name ? [field.name] : []
  );
}

/** A write cannot hash what it cannot read, so it refuses rather than store it. */
const refuseUnknown: OnUnknown = slug => {
  throw NextlyError.internal({
    logContext: {
      reason: "password-field-group-unresolved",
      fieldGroup: slug ?? null,
    },
  });
};

/**
 * Hash every provided password-field value in `data` in place, at every depth
 * (see {@link walkPasswordLevels}).
 *
 * Semantics per value:
 * - non-empty string → replaced with its bcrypt hash (always; pre-hashed
 *   detection heuristics are deliberately avoided)
 * - `null` → kept, clearing the stored value
 * - empty or whitespace-only string, or non-string → key removed; on update
 *   that means "keep the stored hash", on create it means "store nothing"
 *   (matches how entry validation treats whitespace-only as empty, so an
 *   optional password of spaces can't silently replace the stored hash)
 *
 * `keep` names values that are already stored hashes, put back where a field
 * rule denied changing them: hashed again, a hash would never verify the
 * password it was made from.
 */
export async function hashPasswordFieldValues(
  data: Record<string, unknown>,
  fields: readonly NamedField[],
  reach: FieldGroupReach,
  keep?: ReadonlySet<string>
): Promise<void> {
  const toHash = (value: unknown): value is string =>
    typeof value === "string" && value.trim() !== "" && !keep?.has(value);
  // Hashing is asynchronous and the walk is not: it writes a JSON-text
  // container back as it leaves it. So the values are read first, from a
  // copy, hashed, and only then put in place by a second walk, while each
  // container it rewrites is still open. Each occurrence gets a hash of its
  // own, with its own salt, so two fields holding one password store
  // different hashes and don't show that they match.
  const plain: string[] = [];
  walkPasswordLevels(detachForReading(data), fields, {
    reach,
    onUnknown: refuseUnknown,
    untypedZoneRows: "unknown",
    level: (level, levelFields) => {
      for (const name of passwordNames(levelFields)) {
        const value = level[name];
        if (toHash(value)) plain.push(value);
      }
    },
  });
  const hashed = new Map<string, string[]>();
  for (const value of plain) {
    const hash = await hashPassword(value);
    const queue = hashed.get(value);
    if (queue) queue.push(hash);
    else hashed.set(value, [hash]);
  }
  walkPasswordLevels(data, fields, {
    reach,
    onUnknown: refuseUnknown,
    untypedZoneRows: "unknown",
    level: (level, levelFields) => {
      for (const name of passwordNames(levelFields)) {
        if (!(name in level)) continue;
        const value = level[name];
        if (value === null) continue;
        if (typeof value !== "string" || value.trim() === "") {
          delete level[name];
        } else if (toHash(value)) {
          level[name] = hashed.get(value)?.shift();
        }
      }
    },
  });
}

/**
 * Remove password-field values from an entry about to be serialized to a
 * client, at every depth (see {@link walkPasswordLevels}). Stored hashes are
 * write-only: exposing them enables offline cracking, and the plaintext must
 * never round-trip through the admin.
 *
 * An inline field-group instance whose fields are not known is withheld: what
 * it holds cannot be told apart from a password.
 */
export function stripPasswordFieldValues(
  entry: Record<string, unknown>,
  fields: readonly NamedField[],
  reach: FieldGroupReach
): void {
  walkPasswordLevels(entry, fields, {
    reach,
    onUnknown: () => true,
    untypedZoneRows: "union",
    level: (level, levelFields) => {
      for (const name of passwordNames(levelFields)) delete level[name];
    },
  });
}

/**
 * Strip password values out of a snapshot, which holds every field-group
 * instance inline, through every reference (see {@link walkPasswordLevels}).
 * `onUnknown` is told the slug of an instance whose fields are not known;
 * absence is missing information, never permission, so the default refuses.
 */
export function stripSnapshotPasswords(
  snapshot: unknown,
  fields: readonly NamedField[],
  fieldsOf: (slug: string) => readonly NamedField[] | undefined,
  onUnknown: (slug: string) => void
): void {
  walkPasswordLevels(snapshot, fields, {
    reach: { fieldsOf, direct: true },
    onUnknown: slug => {
      onUnknown(slug ?? "");
      return false;
    },
    untypedZoneRows: "union",
    level: (level, levelFields) => {
      for (const name of passwordNames(levelFields)) delete level[name];
    },
  });
}

/**
 * The password values `data` holds at every depth, as stored: the hashes a
 * write may put back where a rule denied changing them.
 */
export function storedPasswordValues(
  data: Record<string, unknown>,
  fields: readonly NamedField[],
  reach: FieldGroupReach
): Set<string> {
  const found = new Set<string>();
  walkPasswordLevels(detachForReading(data), fields, {
    reach,
    onUnknown: () => false,
    untypedZoneRows: "union",
    level: (level, levelFields) => {
      for (const name of passwordNames(levelFields)) {
        const value = level[name];
        if (typeof value === "string" && value !== "") found.add(value);
      }
    },
  });
  return found;
}

/**
 * Read a stored value's passwords for {@link storedPlainPasswords} and
 * {@link hashStoredPlainPasswords}: each one `isHashed` doesn't recognise, in
 * the order the walk meets them. A blank value is not a password, as a write
 * reads one. An instance of a field group `reach` has no fields for, or an
 * untyped zone row, is left as it is, since its passwords cannot be told
 * from its other values.
 */
function visitStoredPlainPasswords(
  data: Record<string, unknown>,
  fields: readonly NamedField[],
  reach: FieldGroupReach,
  isHashed: (value: string) => boolean,
  visit: (level: Record<string, unknown>, name: string, value: string) => void
): void {
  walkPasswordLevels(data, fields, {
    reach,
    onUnknown: () => false,
    untypedZoneRows: "unknown",
    level: (level, levelFields) => {
      for (const name of passwordNames(levelFields)) {
        const value = level[name];
        if (typeof value !== "string" || value.trim() === "") continue;
        if (!isHashed(value)) visit(level, name, value);
      }
    },
  });
}

/**
 * The passwords `data` holds as given, at every depth: one entry for each
 * value `isHashed` does not recognise as a hash. What
 * {@link hashStoredPlainPasswords} would hash, without changing anything.
 */
export function storedPlainPasswords(
  data: Record<string, unknown>,
  fields: readonly NamedField[],
  reach: FieldGroupReach,
  isHashed: (value: string) => boolean
): string[] {
  const found: string[] = [];
  visitStoredPlainPasswords(
    detachForReading(data),
    fields,
    reach,
    isHashed,
    (_level, _name, value) => found.push(value)
  );
  return found;
}

/**
 * Hash in place each password {@link storedPlainPasswords} finds in `data`, so
 * it still verifies, and return how many. Each occurrence gets a hash, and a
 * salt, of its own. A container held as JSON text is written back as text.
 */
export async function hashStoredPlainPasswords(
  data: Record<string, unknown>,
  fields: readonly NamedField[],
  reach: FieldGroupReach,
  isHashed: (value: string) => boolean
): Promise<number> {
  // Hashing is asynchronous and the walk is not, so the values are read
  // first and hashed, then put in place by a second walk, as
  // `hashPasswordFieldValues` does.
  const plain = storedPlainPasswords(data, fields, reach, isHashed);
  if (plain.length === 0) return 0;
  const hashes: string[] = [];
  for (const value of plain) hashes.push(await hashPassword(value));
  let next = 0;
  visitStoredPlainPasswords(data, fields, reach, isHashed, (level, name) => {
    level[name] = hashes[next++];
  });
  return plain.length;
}

/** A copy to walk, so reading what a value holds never rewrites it. */
function detachForReading(
  data: Record<string, unknown>
): Record<string, unknown> {
  return structuredClone(data);
}

/**
 * Whether `fields` declare a password at any depth, through the field groups
 * `reach` follows: lets a read skip the strip for the common case with none.
 */
export function reachesPasswordField(
  fields: readonly NamedField[],
  reach: FieldGroupReach
): boolean {
  return reachesFrom(fields, reach, new Set(), true);
}

/**
 * {@link reachesPasswordField} at one level, following field groups where the
 * walk does: one placed directly on the entry is left to its own read, as the
 * walk leaves it, and one held inline that `reach` has no fields for counts,
 * since the strip withholds it and so has to run.
 */
function reachesFrom(
  fields: readonly NamedField[],
  reach: FieldGroupReach,
  seen: ReadonlySet<string>,
  atEntry: boolean
): boolean {
  return fields.some(field => {
    if (field.type === "password") return true;
    // A layout container keeps its fields on this level; a group or
    // repeater holds a level of its own.
    if (
      field.fields &&
      reachesFrom(field.fields, reach, seen, atEntry && !field.name)
    ) {
      return true;
    }
    const { single, many } = extractFieldGroupReferences(field);
    if (atEntry && reach.direct !== true) return false;
    const slugs = [...(single === undefined ? [] : [single]), ...(many ?? [])];
    return slugs.some(slug => {
      if (seen.has(slug)) return false;
      const inner = reach.fieldsOf(slug);
      return (
        inner === undefined ||
        reachesFrom(inner, reach, new Set([...seen, slug]), false)
      );
    });
  });
}

/**
 * Whether any field in the set (at any depth) is a password field — lets
 * read paths skip the per-entry strip loop entirely for the common
 * no-password case without missing a nested password.
 */
export function hasPasswordField(fields: NamedField[]): boolean {
  return fields.some(
    field =>
      field.type === "password" ||
      (Boolean(field.fields) && hasPasswordField(field.fields!))
  );
}

/**
 * Whether a name addresses a password field, in any spelling it may arrive in.
 *
 * A caller naming one is asking for a value this module exists to make sure
 * never leaves the server, so the answer has to hold wherever such a name can
 * reach a column. `stripPasswordFieldValues` protects a ROW; an aggregate
 * returns no rows, so a grouped read that selected the column directly would
 * publish the stored hashes as bucket labels with nothing on that path to
 * clear them.
 *
 * Every spelling is compared because the resolvers that turn a name into a
 * column try more than one, so matching only the incoming string would leave
 * an alias around this check.
 */
export function isPasswordFieldName(
  fields: NamedField[],
  name: string
): boolean {
  // TOP LEVEL only, unlike `hasPasswordField` beside it. A nested name is
  // scoped to its container -- a password called `code` inside a group says
  // nothing about a readable top-level column also called `code` -- and the
  // caller asks this about a name it resolved against the PARENT table, where
  // only top-level fields have columns. Descending would refuse a valid read
  // because an unrelated child shares its name.
  const wanted = new Set([name, toCamelCase(name), toSnakeCase(name)]);
  return fields.some(
    field =>
      field.type === "password" &&
      Boolean(field.name) &&
      wanted.has(field.name!)
  );
}

/**
 * The system columns that never leave the server, in every spelling.
 *
 * A projection of `strippedFromResponses` rather than a list of its own, so a column added with
 * that policy is removed here without an edit.
 */
const RESPONSE_STRIPPED_KEYS: readonly string[] = systemColumnNames(
  column => column.strippedFromResponses
);

/**
 * Remove every column that must not leave the server from a response row, in
 * place: the system owner column, and any column a schema hook contributed to
 * this table.
 *
 * The owner column holds the creator's stable user id. Owner-only access
 * filters on it in SQL, so its value never needs to leave the server; returning
 * it would leak a stable user id to any caller who can read a collection whose
 * rows were created by other users. Callers strip it on the read/mutation
 * response boundary, the same place password values are cleared.
 *
 * Contributed columns are stripped at the same boundary because they arrive
 * the same way: a column `extendTable` added to an entity is a real column on
 * a real table, so `db.select()` returns it in every row. It is on the table
 * deliberately — absent, the next push would propose dropping it — and it is
 * no field of the entity, so it belongs in no response, no version snapshot
 * and no webhook payload.
 *
 * Takes the TABLE, which is why this is not a list of its own: a contributed
 * name is not namespaced, and a global set would strip a legitimate field
 * from a different entity that happened to share the name.
 */
export function stripServerOnlyColumns(
  entry: Record<string, unknown>,
  /** The SQL table this row was read from. */
  tableName: string
): void {
  for (const key of RESPONSE_STRIPPED_KEYS) {
    if (key in entry) delete entry[key];
  }
  const isHidden = hiddenColumnMatcher(tableName);
  for (const key of Object.keys(entry)) {
    if (isHidden(key)) delete entry[key];
  }
}

/**
 * Whether a key names a column a schema hook contributed to `tableName` as
 * hidden, in either spelling.
 *
 * The one answer both directions of the entry API use: responses remove what
 * it matches, and writes drop what it matches before the row is built, so a
 * column cannot be hidden from reads yet writable, or the reverse.
 *
 * Either spelling because a row reaches the response boundary snake_cased from
 * some paths and camelCased from others, and a write payload is snake_cased
 * before the drop on some paths and after it on others. The hidden list holds
 * SQL names, so a key matches when its snake_case form is one.
 */
export function hiddenColumnMatcher(
  /** The SQL table the row is read from or written to. */
  tableName: string
): (key: string) => boolean {
  const hidden = new Set(hiddenColumnNames(tableName));
  if (hidden.size === 0) return () => false;
  return key => hidden.has(key) || hidden.has(toSnakeCase(key));
}
