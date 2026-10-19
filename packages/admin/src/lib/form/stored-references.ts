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
    if (typeof name !== "string" || !(name in stored)) continue;
    const value = mergeField(field, populated[name], stored[name]);
    // Only a field that took a value is written, so one absent from the
    // populated read stays absent rather than appearing as undefined.
    if (value !== undefined || name in populated) merged[name] = value;
  }
  return merged;
}

/** An object literal's shape: a value the form built, not a Date or a File. */
function isPlainObject(value: unknown): value is Doc {
  if (!isRecord(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * A value to write, with every placeholder turned back into the reference it
 * stands for: the bare id, or the `{ relationTo, value }` pair. The marker is
 * the admin's own and never reaches the server, at any depth: the server
 * reduces a related object to its id at the top level, but not an upload
 * inside a group or a repeater.
 */
export function withoutPlaceholders<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(item => withoutPlaceholders(item)) as T;
  }
  if (!isPlainObject(value)) return value;
  if (isRestrictedReference(value)) {
    return (
      typeof value.relationTo === "string"
        ? { relationTo: value.relationTo, value: value.value }
        : value.id
    ) as T;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, withoutPlaceholders(item)])
  ) as T;
}

/**
 * The populated document with every stored link kept: a link the populated
 * read gave no row for becomes a placeholder, at its stored position.
 *
 * Both documents must be reads of the same version. Relationship and upload
 * fields are merged at the top level and inside groups and repeaters; any
 * other value is the populated read's.
 */
export function withStoredReferences<T extends Doc>(
  fields: FieldConfig[],
  populated: T,
  stored: Doc
): T {
  return mergeFields(fields, populated, stored) as T;
}
