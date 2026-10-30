/**
 * The media items a stored value refers to, found by walking it against its
 * fields.
 *
 * Content refers to a media item in four ways, and this is the one place
 * that knows them:
 *
 *   - an upload field holds the item's id, or a list of ids, as a column or a
 *     JSON list (a polymorphic one as `{ relationTo, value }`);
 *   - a rich-text value holds the item's address in an image, video or
 *     gallery node's `src`, never its id;
 *   - a block document (the value of a `blocks` field) lists the items it uses
 *     in `assets.mediaIds`, written with it; one that has no list is walked;
 *   - a group, a repeater or a field group holds any of these inside it.
 *
 * What is found here is a candidate: an id or an address. Which candidates
 * are media items is asked of the media table in one query when the record
 * is written (`media-usage-store`), so a value that only looks like a
 * reference records nothing.
 *
 * Pure: it reads no database and changes nothing it is given.
 *
 * @module domains/media/usage/media-references
 */

import type { FieldConfig } from "../../../collections/fields/types";
import {
  extractFieldGroupReferences,
  isFieldGroupFieldType,
} from "../../field-groups/storage/field-group-field-type";
import { readFieldGroupType } from "../../field-groups/storage/field-group-type-key";
import type { ComponentSchemaInfo } from "../../versions/restore-snapshot";

/** One reference a value makes: to an item's id, or to its address. */
export interface MediaReference {
  /**
   * The field's name, after the names of the groups, repeaters and field
   * groups it sits in, joined by dots: `hero.image`, not `hero.0.image`.
   */
  fieldPath: string;
  /** The item's id, for an upload field or a block document's list. */
  mediaId?: string;
  /** The item's address, for a rich-text node. */
  url?: string;
}

/** The field-group schemas a walk reads, by the slug a field names. */
export type FieldGroupSchemas = ReadonlyMap<
  string,
  Pick<ComponentSchemaInfo, "fields">
>;

/**
 * An id is a media item's when it is the shape the media table gives its
 * ids. Only the walk of a block document with no `assets.mediaIds` asks
 * this: its nodes hold every kind of text, and passing each string on as a
 * candidate would make the media lookup as long as the document.
 */
const ID_SHAPE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A JSON-backed value as the dialect returned it: parsed on PostgreSQL, a
 * string on SQLite and MySQL. A string that does not parse is left as it is,
 * so an upload column holding one plain id still reads as that id.
 */
function parsed(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return value;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return value;
  }
}

/** The ids an upload field's value holds, in any of its stored shapes. */
function uploadIds(value: unknown): string[] {
  const v = parsed(value);
  if (Array.isArray(v)) return v.flatMap(uploadIds);
  if (typeof v === "string") return v === "" ? [] : [v];
  if (typeof v === "number") return [String(v)];
  return isRecord(v) ? uploadIdsOfObject(v) : [];
}

/**
 * `{ relationTo, value }` for a polymorphic upload, `{ id, ... }` for one
 * already expanded.
 */
function uploadIdsOfObject(v: Record<string, unknown>): string[] {
  if ("value" in v) return uploadIds(v.value);
  return "id" in v ? uploadIds(v.id) : [];
}

/** Every `src` address in a rich-text tree: image, video and gallery nodes. */
function richTextUrls(value: unknown, into: string[]): void {
  const v = parsed(value);
  if (Array.isArray(v)) {
    for (const item of v) richTextUrls(item, into);
    return;
  }
  if (!isRecord(v)) return;
  if (typeof v.src === "string" && v.src !== "") into.push(v.src);
  for (const [key, child] of Object.entries(v)) {
    if (key !== "src") richTextUrls(child, into);
  }
}

/** Whether a value is a block document: a list of nodes in an envelope. */
function isBlockDocument(value: unknown): value is Record<string, unknown> {
  return (
    isRecord(value) && Array.isArray(value.nodes) && "formatVersion" in value
  );
}

/**
 * What one string in a block document's nodes refers to: an address under
 * `src` or `url`, or an id-shaped value under any other key but a node's own
 * `id`.
 */
function blockStringReference(
  value: string,
  key: string | null,
  inNode: boolean,
  fieldPath: string
): MediaReference | null {
  if (key === "src" || key === "url") return { fieldPath, url: value };
  if (inNode && key === "id") return null;
  return ID_SHAPE.test(value) ? { fieldPath, mediaId: value } : null;
}

/**
 * The items a block document uses: its `assets.mediaIds` when it has the
 * list, which is derived on write for exactly this; otherwise every id-shaped
 * string and every `src` or `url` address in its nodes. A node's own `id` is
 * a node's, never an item's, and is passed over.
 */
function blockDocumentReferences(
  document: Record<string, unknown>,
  fieldPath: string,
  into: MediaReference[]
): void {
  const assets = document.assets;
  if (isRecord(assets) && Array.isArray(assets.mediaIds)) {
    for (const id of assets.mediaIds) {
      if (typeof id === "string" && id !== "") {
        into.push({ fieldPath, mediaId: id });
      }
    }
    return;
  }
  const walk = (value: unknown, key: string | null, inNode: boolean): void => {
    if (typeof value === "string") {
      const ref = blockStringReference(value, key, inNode, fieldPath);
      if (ref) into.push(ref);
    } else if (Array.isArray(value)) {
      for (const item of value) walk(item, null, false);
    } else if (isRecord(value)) {
      const isNode = typeof value.type === "string" && "props" in value;
      for (const [childKey, child] of Object.entries(value)) {
        walk(child, childKey, isNode);
      }
    }
  };
  walk(document.nodes, null, false);
}

/** The child fields of a group or repeater. */
function childFields(field: FieldConfig): FieldConfig[] {
  const nested = (field as { fields?: unknown }).fields;
  return Array.isArray(nested) ? (nested as FieldConfig[]) : [];
}

/**
 * The fields of one field-group instance: the schema its stored type names,
 * else the one the field names for every instance.
 */
function instanceFields(
  field: FieldConfig,
  instance: unknown,
  schemas: FieldGroupSchemas
): FieldConfig[] | undefined {
  const type = readFieldGroupType(instance);
  const slug = type ?? extractFieldGroupReferences(field).single;
  return slug === undefined ? undefined : schemas.get(slug)?.fields;
}

function joinPath(prefix: string, name: string): string {
  return prefix === "" ? name : `${prefix}.${name}`;
}

/** How one kind of field finds the references in its value. */
type FieldCollector = (
  field: FieldConfig,
  raw: unknown,
  path: string,
  schemas: FieldGroupSchemas,
  into: MediaReference[]
) => void;

const collectUpload: FieldCollector = (_field, raw, path, _schemas, into) => {
  for (const mediaId of uploadIds(raw)) into.push({ fieldPath: path, mediaId });
};

const collectRichText: FieldCollector = (_field, raw, path, _schemas, into) => {
  const urls: string[] = [];
  richTextUrls(parsed(raw), urls);
  for (const url of urls) into.push({ fieldPath: path, url });
};

const collectGroup: FieldCollector = (field, raw, path, schemas, into) => {
  const value = parsed(raw);
  if (isRecord(value)) {
    collectFields(childFields(field), value, path, schemas, into);
  }
};

const collectRepeater: FieldCollector = (field, raw, path, schemas, into) => {
  const value = parsed(raw);
  if (!Array.isArray(value)) return;
  for (const row of value.filter(isRecord)) {
    collectFields(childFields(field), row, path, schemas, into);
  }
};

/** A field group's instance, or its list of instances. */
const collectFieldGroup: FieldCollector = (field, raw, path, schemas, into) => {
  const value = parsed(raw);
  const instances = Array.isArray(value) ? value : [value];
  for (const instance of instances.filter(isRecord)) {
    const fields = instanceFields(field, instance, schemas);
    if (fields) collectFields(fields, instance, path, schemas, into);
  }
};

/**
 * A `blocks` field, or any field a plugin contributes, whose value is a
 * block document. Any other value refers to nothing.
 */
const collectBlockDocument: FieldCollector = (
  _field,
  raw,
  path,
  _schemas,
  into
) => {
  const value = parsed(raw);
  if (isBlockDocument(value)) blockDocumentReferences(value, path, into);
};

const COLLECTORS: Readonly<Record<string, FieldCollector>> = {
  upload: collectUpload,
  richText: collectRichText,
  group: collectGroup,
  repeater: collectRepeater,
};

function collectorFor(type: unknown): FieldCollector {
  const name = typeof type === "string" ? type : "";
  if (Object.prototype.hasOwnProperty.call(COLLECTORS, name)) {
    return COLLECTORS[name];
  }
  return isFieldGroupFieldType(name) ? collectFieldGroup : collectBlockDocument;
}

function collectField(
  field: FieldConfig,
  raw: unknown,
  path: string,
  schemas: FieldGroupSchemas,
  into: MediaReference[]
): void {
  if (raw === null || raw === undefined) return;
  collectorFor((field as { type?: unknown }).type)(
    field,
    raw,
    path,
    schemas,
    into
  );
}

function collectFields(
  fields: readonly FieldConfig[],
  holder: Record<string, unknown>,
  prefix: string,
  schemas: FieldGroupSchemas,
  into: MediaReference[]
): void {
  for (const field of fields) {
    const name = (field as { name?: unknown }).name;
    if (typeof name !== "string" || name === "") continue;
    collectField(field, holder[name], joinPath(prefix, name), schemas, into);
  }
}

/**
 * The references `values` makes through `fields`. `values` is keyed by field
 * name, as a stored row in read shape or a field group's instance is; a field
 * it has no value for refers to nothing.
 */
export function collectMediaReferences(
  fields: readonly FieldConfig[],
  values: Record<string, unknown>,
  schemas: FieldGroupSchemas = new Map()
): MediaReference[] {
  const into: MediaReference[] = [];
  collectFields(fields, values, "", schemas, into);
  return into;
}
