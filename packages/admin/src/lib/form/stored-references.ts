/**
 * stored-references — keeping the links an editor cannot see.
 *
 * The edit page reads a document at a populating depth, and the server leaves
 * out a related row or a media item the editor may not read, or one that no
 * longer exists: a to-many value has nothing at that position, a to-one value
 * keeps only the id or is empty. The form is saved back whole, so a link it
 * does not hold is a link the save removes.
 *
 * So the edit page also reads the document at depth 0, which gives every link
 * as stored, in order, without judging it. Each stored link the populated read
 * gave a row for takes that row; every other one becomes a placeholder. A
 * placeholder cannot say whether the row is hidden or gone: the depth-0 read
 * names both the same way, and nothing else is consulted.
 *
 * A placeholder is an ordinary reference value with a marker key, so a save
 * sends it as the id it carries (the server reduces a related object to its
 * id), and the inputs can render it as a row that can be removed but not
 * opened.
 *
 * @module lib/form/stored-references
 */

import type { FieldConfig } from "nextly/config";
import {
  isFieldGroupFieldType,
  readFieldGroupType,
} from "nextly/field-group-type";

import { storedValueOf } from "./default-values";

/** The key that marks a reference value as a placeholder. */
export const RESTRICTED_REFERENCE = "__restrictedReference";

type Doc = Record<string, unknown>;

function isRecord(value: unknown): value is Doc {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Whether a form value is a placeholder for a link the editor cannot see. */
export function isRestrictedReference(value: unknown): boolean {
  return isRecord(value) && value[RESTRICTED_REFERENCE] === true;
}

/** An id as stored: a string, or a number from a numeric key. */
function idOf(value: unknown): string | undefined {
  if (typeof value === "string" && value !== "") return value;
  if (typeof value === "number") return String(value);
  return undefined;
}

/** A stored link, as the depth-0 read gives it. */
interface StoredLink {
  /** Matches the populated row for the same link. */
  key: string;
  /** What the form holds when no row was given for it. */
  placeholder: Doc;
}

/**
 * A depth-0 value read as a link: a bare id, or the `{ relationTo, value }`
 * pair a field naming several collections stores.
 */
function storedLinkOf(value: unknown): StoredLink | undefined {
  const id = idOf(value);
  if (id !== undefined) {
    return { key: id, placeholder: { id, [RESTRICTED_REFERENCE]: true } };
  }
  if (isRecord(value) && typeof value.relationTo === "string") {
    const target = idOf(value.value);
    if (target === undefined) return undefined;
    return {
      key: `${value.relationTo}\u0000${target}`,
      placeholder: {
        relationTo: value.relationTo,
        value: target,
        [RESTRICTED_REFERENCE]: true,
      },
    };
  }
  return undefined;
}

/**
 * The link a populated value carries a row for, keyed as {@link storedLinkOf}
 * keys it. A bare id, a pair whose `value` is only an id, or a placeholder
 * carries no row, so it answers `undefined`.
 */
function populatedRowKey(value: unknown): string | undefined {
  if (!isRecord(value) || isRestrictedReference(value)) return undefined;
  if (typeof value.relationTo === "string" && "value" in value) {
    const row = value.value;
    const id = isRecord(row) ? idOf(row.id) : undefined;
    return id === undefined ? undefined : `${value.relationTo}\u0000${id}`;
  }
  return idOf(value.id);
}

/**
 * One relationship or upload value: the stored links in stored order, each
 * as its populated row where the populated read gave one, else a placeholder.
 */
function mergeReference(populated: unknown, stored: unknown): unknown {
  if (Array.isArray(stored)) {
    // Queued per key, so a link stored twice takes a row twice.
    const rows = new Map<string, unknown[]>();
    for (const item of Array.isArray(populated) ? populated : []) {
      const key = populatedRowKey(item);
      if (key === undefined) continue;
      const queue = rows.get(key);
      if (queue) queue.push(item);
      else rows.set(key, [item]);
    }
    return stored.map(item => {
      const link = storedLinkOf(item);
      if (!link) return item;
      return rows.get(link.key)?.shift() ?? link.placeholder;
    });
  }
  const link = storedLinkOf(stored);
  if (!link) return populated;
  return populatedRowKey(populated) === link.key ? populated : link.placeholder;
}

/** The fields nested inside a group or a repeater. */
function nestedFields(field: FieldConfig): FieldConfig[] {
  const fields = (field as { fields?: unknown }).fields;
  return Array.isArray(fields) ? (fields as FieldConfig[]) : [];
}

/**
 * The fields of one field group instance, as the schema API enriches the
 * field: its component's under `componentFields`, or, in a dynamic zone, those
 * of the type the instance names, under `componentSchemas`.
 */
function instanceFields(field: FieldConfig, instance: Doc): FieldConfig[] {
  const enriched = field as {
    componentFields?: unknown;
    componentSchemas?: Record<string, { fields?: unknown } | undefined>;
  };
  const type = readFieldGroupType(instance);
  const fields =
    (type === undefined
      ? undefined
      : enriched.componentSchemas?.[type]?.fields) ?? enriched.componentFields;
  return Array.isArray(fields) ? (fields as FieldConfig[]) : [];
}

/**
 * Applies `each` to a field group's instances: a list of them, or one on its
 * own. Both reads give the same shape for the same field.
 */
function eachInstance(
  value: unknown,
  each: (instance: unknown) => unknown
): unknown {
  return Array.isArray(value) ? value.map(each) : each(value);
}

/**
 * One field group instance, merged with the stored one at its position. Two
 * reads naming different types for one row are of different versions, and the
 * populated row is kept as it is.
 */
function mergeInstance(
  field: FieldConfig,
  populated: unknown,
  stored: unknown
): unknown {
  if (!isRecord(populated) || !isRecord(stored)) return populated;
  if (readFieldGroupType(populated) !== readFieldGroupType(stored)) {
    return populated;
  }
  return mergeFields(instanceFields(field, populated), populated, stored);
}

/** A field group, or a dynamic zone: its instances paired by position. */
function mergeFieldGroup(
  field: FieldConfig,
  populated: unknown,
  stored: unknown
): unknown {
  if (!Array.isArray(populated) || !Array.isArray(stored)) {
    return mergeInstance(field, populated, stored);
  }
  if (populated.length !== stored.length) return populated;
  return populated.map((row: unknown, index) =>
    mergeInstance(field, row, stored[index])
  );
}

/** A group: its own fields, merged the same way. */
function mergeGroup(
  field: FieldConfig,
  populated: unknown,
  stored: unknown
): unknown {
  if (!isRecord(populated) || !isRecord(stored)) return populated;
  return mergeFields(nestedFields(field), populated, stored);
}

/** A repeater: both reads are of the same stored rows, so rows pair by position. */
function mergeRepeater(
  field: FieldConfig,
  populated: unknown,
  stored: unknown
): unknown {
  if (!Array.isArray(populated) || !Array.isArray(stored)) return populated;
  if (populated.length !== stored.length) return populated;
  return populated.map((row: unknown, index) => {
    const storedRow: unknown = stored[index];
    return isRecord(row) && isRecord(storedRow)
      ? mergeFields(nestedFields(field), row, storedRow)
      : row;
  });
}

/** One field's value, by what kind of field it is. */
function mergeField(
  field: FieldConfig,
  populated: unknown,
  stored: unknown
): unknown {
  // Either stored spelling of a field group, asked through the shared
  // predicate rather than compared to one literal.
  if (isFieldGroupFieldType(field.type)) {
    return mergeFieldGroup(field, populated, stored);
  }
  switch (field.type) {
    case "relationship":
    case "upload":
      // A field the read never populates holds the same ids in both reads.
      return (field as { maxDepth?: unknown }).maxDepth === 0
        ? populated
        : mergeReference(populated, stored);
    case "group":
      return mergeGroup(field, populated, stored);
    case "repeater":
      return mergeRepeater(field, populated, stored);
    default:
      return populated;
  }
}

function mergeFields(fields: FieldConfig[], populated: Doc, stored: Doc): Doc {
  const merged: Doc = { ...populated };
  for (const field of fields) {
    const name = (field as { name?: unknown }).name;
    if (typeof name !== "string") continue;
    // Read as the form reads them, under the field's name or its column name,
    // and written under the name, which the form reads first.
    const storedValue = storedValueOf(stored, name);
    if (storedValue === undefined) continue;
    const value = mergeField(
      field,
      storedValueOf(populated, name),
      storedValue
    );
    // Only a field that took a value is written, so one absent from the
    // populated read stays absent rather than appearing as undefined.
    if (value !== undefined) merged[name] = value;
  }
  return merged;
}

/** How many times each link is stored in a reference value. */
function linkCounts(stored: unknown): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of Array.isArray(stored) ? stored : [stored]) {
    const key = storedLinkOf(item)?.key;
    if (key !== undefined) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/** One reference value's rows, all among the links it stores. */
function rowsAmongLinks(populated: unknown, stored: unknown): boolean {
  const left = linkCounts(stored);
  const rows = Array.isArray(populated) ? populated : [populated];
  return rows.every(item => {
    const key = populatedRowKey(item);
    if (key === undefined) return true;
    const count = left.get(key) ?? 0;
    left.set(key, count - 1);
    return count > 0;
  });
}

type AmongCheck = (
  field: FieldConfig,
  populated: unknown,
  stored: unknown
) => boolean;

/** A relationship or upload: its rows among its links, if the read populates it. */
const referenceAmongLinks: AmongCheck = (field, populated, stored) =>
  (field as { maxDepth?: unknown }).maxDepth === 0 ||
  rowsAmongLinks(populated, stored);

/** A group: its own fields, compared the same way. */
const groupAmongStored: AmongCheck = (field, populated, stored) =>
  !isRecord(populated) ||
  !isRecord(stored) ||
  populatedAmongStored(nestedFields(field), populated, stored);

/** A repeater: rows paired by position, and the same number of them. */
const repeaterAmongStored: AmongCheck = (field, populated, stored) => {
  if (!Array.isArray(populated) || !Array.isArray(stored)) return true;
  if (populated.length !== stored.length) return false;
  return populated.every((row: unknown, index) =>
    groupAmongStored(field, row, stored[index])
  );
};

/**
 * A field group instance: present in both reads or in neither, the same
 * instance (its id) of the same type, and its own fields compared the same
 * way. Two reads straddling an edit made in the same second share a timestamp
 * stored to the second, but not an instance that was added, removed or
 * replaced between them.
 */
const instanceAmongStored: AmongCheck = (field, populated, stored) => {
  if (!isRecord(populated) || !isRecord(stored)) {
    return !isRecord(populated) && !isRecord(stored);
  }
  return (
    populated.id === stored.id &&
    readFieldGroupType(populated) === readFieldGroupType(stored) &&
    populatedAmongStored(instanceFields(field, populated), populated, stored)
  );
};

/** A field group, or a dynamic zone: instances paired by position. */
const fieldGroupAmongStored: AmongCheck = (field, populated, stored) => {
  if (!Array.isArray(populated) || !Array.isArray(stored)) {
    return instanceAmongStored(field, populated, stored);
  }
  return (
    populated.length === stored.length &&
    populated.every((row: unknown, index) =>
      instanceAmongStored(field, row, stored[index])
    )
  );
};

/** How each field kind is compared; any other kind cannot tell versions apart. */
const AMONG_STORED: Record<string, AmongCheck> = {
  relationship: referenceAmongLinks,
  upload: referenceAmongLinks,
  group: groupAmongStored,
  repeater: repeaterAmongStored,
};

/**
 * Whether the populated read could be of the same version as the depth-0
 * read: every row it gives for a relationship or an upload is a link the
 * depth-0 read stores. A timestamp alone cannot say so, since two writes in
 * one second keep it on a database storing whole seconds; a row the stored
 * read lacks is a link added or replaced between the two reads.
 */
export function populatedAmongStored(
  fields: FieldConfig[],
  populated: Doc,
  stored: Doc
): boolean {
  return fields.every(field => {
    const name = (field as { name?: unknown }).name;
    if (typeof name !== "string") return true;
    const storedValue = storedValueOf(stored, name);
    if (storedValue === undefined) return true;
    const check = isFieldGroupFieldType(field.type)
      ? fieldGroupAmongStored
      : AMONG_STORED[field.type as string];
    return check
      ? check(field, storedValueOf(populated, name), storedValue)
      : true;
  });
}

/** A placeholder as the reference it stands for: the id, or the pair. */
function referenceOf(value: unknown): unknown {
  if (!isRecord(value) || !isRestrictedReference(value)) return value;
  return typeof value.relationTo === "string"
    ? { relationTo: value.relationTo, value: value.value }
    : value.id;
}

/** One field's value to write, by what kind of field it is. */
function writableField(field: FieldConfig, value: unknown): unknown {
  if (isFieldGroupFieldType(field.type)) {
    return eachInstance(value, instance =>
      isRecord(instance)
        ? withoutPlaceholders(instanceFields(field, instance), instance)
        : instance
    );
  }
  switch (field.type) {
    case "relationship":
    case "upload":
      return Array.isArray(value) ? value.map(referenceOf) : referenceOf(value);
    case "group":
      return isRecord(value)
        ? withoutPlaceholders(nestedFields(field), value)
        : value;
    case "repeater":
      return Array.isArray(value)
        ? value.map((row: unknown) =>
            isRecord(row) ? withoutPlaceholders(nestedFields(field), row) : row
          )
        : value;
    default:
      return value;
  }
}

/**
 * Form values to save, with every placeholder turned back into the reference
 * it stands for: the bare id, or the `{ relationTo, value }` pair.
 *
 * The marker is the admin's own and never reaches the server. Only
 * relationship and upload values are read, at the top level and inside groups,
 * repeaters and field groups (dynamic zones included), which is everywhere
 * {@link withStoredReferences} puts one: a
 * JSON value that happens to carry the marker key is the author's content and
 * is sent as it is. The server reduces a related object to its id at the top
 * level, but not an upload inside a group or a repeater.
 */
export function withoutPlaceholders<T extends Doc>(
  fields: FieldConfig[],
  data: T
): T {
  const writable: Doc = { ...data };
  for (const field of fields) {
    const name = (field as { name?: unknown }).name;
    if (typeof name !== "string" || !(name in data)) continue;
    writable[name] = writableField(field, data[name]);
  }
  return writable as T;
}

/**
 * Whether form values hold a placeholder anywhere {@link withoutPlaceholders}
 * turns one back into a reference: what it makes of them differs from them
 * only there.
 */
export function holdsPlaceholders(fields: FieldConfig[], data: Doc): boolean {
  return (
    JSON.stringify(withoutPlaceholders(fields, data)) !== JSON.stringify(data)
  );
}

/**
 * The populated document with every stored link kept: a link the populated
 * read gave no row for becomes a placeholder, at its stored position.
 *
 * Both documents must be reads of the same version. Relationship and upload
 * fields are merged at the top level and inside groups, repeaters and field
 * groups, a dynamic zone's rows each by the fields of the type they name; any
 * other value is the populated read's.
 */
export function withStoredReferences<T extends Doc>(
  fields: FieldConfig[],
  populated: T,
  stored: Doc
): T {
  return mergeFields(fields, populated, stored) as T;
}
