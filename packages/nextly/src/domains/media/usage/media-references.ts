/**
 * The media items a stored value refers to, found by walking it against its
 * fields.
 *
 * Content refers to a media item in four ways, and this is the one place
 * that knows them:
 *
 *   - an upload field holds the item's id, or a list of ids, as a column or a
 *     JSON list (a polymorphic one as `{ relationTo, value }`, read only
 *     where it names media);
 *   - a rich-text value holds the item's address in an image, video or
 *     gallery node's `src`, never its id;
 *   - a block document (the value of a `blocks` field) lists the items it uses
 *     in `assets.mediaIds`, written with it; one that has no list is walked;
 *     any other JSON value is read for the addresses it holds under `src` or
 *     `url`, as a Page Builder font face holds its file;
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
import { isFieldLocalized } from "../../i18n/classify-fields";
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

/**
 * The field-group schemas a walk reads, by the slug a field names, with
 * whether each is translated where the walk asks
 * ({@link collectFieldGroupReferences}).
 */
export type FieldGroupSchemas = ReadonlyMap<
  string,
  Pick<ComponentSchemaInfo, "fields"> &
    Partial<Pick<ComponentSchemaInfo, "localized">>
>;

/**
 * An id is a media item's when it is the shape the media table gives its
 * ids. Only the walk of a block document with no `assets.mediaIds` asks
 * this: its nodes hold every kind of text, and passing each string on as a
 * candidate would make the media lookup as long as the document.
 */
const ID_SHAPE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The media route an address may name an item by instead of the file's own
 * address (`/api/media/<id>/raw`), as a Page Builder font face does: the
 * item's id, read from it.
 */
const MEDIA_ROUTE =
  /\/media\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?=[/?#]|$)/i;

/** What an address refers to: the item its media route names, or itself. */
function addressReference(url: string, fieldPath: string): MediaReference {
  const routed = MEDIA_ROUTE.exec(url);
  return routed ? { fieldPath, mediaId: routed[1] } : { fieldPath, url };
}

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

/** The collection media items are stored in, as an upload field names it. */
const MEDIA_COLLECTION = "media";

/**
 * The collections an upload field may point at, or `null` when it names
 * none and is read as pointing at media.
 */
function uploadTargets(field: FieldConfig): readonly string[] | null {
  const relationTo = (field as { relationTo?: unknown }).relationTo;
  if (typeof relationTo === "string") return [relationTo];
  return Array.isArray(relationTo)
    ? relationTo.filter((slug): slug is string => typeof slug === "string")
    : null;
}

/**
 * The ids an upload field's value holds for media, in any of its stored
 * shapes. `onlyMedia` says the field can point at nothing else, so a value
 * that does not name its collection is media's; a polymorphic value names
 * its own, and only one naming media is read.
 */
function uploadIds(value: unknown, onlyMedia: boolean): string[] {
  const v = parsed(value);
  if (Array.isArray(v)) return v.flatMap(item => uploadIds(item, onlyMedia));
  if (!onlyMedia && !isRecord(v)) return [];
  if (typeof v === "string") return v === "" ? [] : [v];
  if (typeof v === "number") return [String(v)];
  return isRecord(v) ? uploadIdsOfObject(v, onlyMedia) : [];
}

/**
 * `{ relationTo, value }` for a polymorphic upload, `{ id, ... }` for one
 * already expanded: read only when it names media, or names no collection
 * in a field that can point at nothing else.
 */
function uploadIdsOfObject(
  v: Record<string, unknown>,
  onlyMedia: boolean
): string[] {
  if (typeof v.relationTo === "string") {
    if (v.relationTo !== MEDIA_COLLECTION) return [];
    return "value" in v ? uploadIds(v.value, true) : uploadIds(v.id, true);
  }
  if (!onlyMedia) return [];
  if ("value" in v) return uploadIds(v.value, true);
  return "id" in v ? uploadIds(v.id, true) : [];
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
  if (key === "src" || key === "url") return addressReference(value, fieldPath);
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

/**
 * What a JSON value that is not a block document names: each address under a
 * `src` or `url` key, however deep. Nothing else in it is read, so a list of
 * a value's own ids is not taken for items.
 */
function jsonAddressReferences(
  value: unknown,
  fieldPath: string,
  into: MediaReference[]
): void {
  const walk = (node: unknown, key: string | null): void => {
    if (typeof node === "string") {
      if ((key === "src" || key === "url") && node !== "") {
        into.push(addressReference(node, fieldPath));
      }
    } else if (Array.isArray(node)) {
      for (const item of node) walk(item, key);
    } else if (isRecord(node)) {
      for (const [childKey, child] of Object.entries(node)) {
        walk(child, childKey);
      }
    }
  };
  walk(value, null);
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

/**
 * An upload field that can point at media: its ids, each read only where
 * the value is media's (`uploadIds`). One pointing elsewhere uses no item,
 * whatever ids it holds.
 */
const collectUpload: FieldCollector = (field, raw, path, _schemas, into) => {
  const targets = uploadTargets(field);
  if (targets !== null && !targets.includes(MEDIA_COLLECTION)) return;
  const onlyMedia = targets === null || targets.length === 1;
  for (const mediaId of uploadIds(raw, onlyMedia)) {
    into.push({ fieldPath: path, mediaId });
  }
};

const collectRichText: FieldCollector = (_field, raw, path, _schemas, into) => {
  const urls: string[] = [];
  richTextUrls(parsed(raw), urls);
  for (const url of urls) into.push(addressReference(url, path));
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
 * A `blocks` field, a `json` field, or any field a plugin contributes: a
 * block document by its own account, any other JSON value by the addresses
 * it holds. A plain value refers to nothing.
 */
const collectBlockDocument: FieldCollector = (
  _field,
  raw,
  path,
  _schemas,
  into
) => {
  const value = parsed(raw);
  if (isBlockDocument(value)) {
    blockDocumentReferences(value, path, into);
  } else if (isRecord(value) || Array.isArray(value)) {
    jsonAddressReferences(value, path, into);
  }
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

/** A reference a field group's value makes, and whether a translation makes it. */
export interface FieldGroupReference extends MediaReference {
  /**
   * Whether the value is one each language holds its own of: a translatable
   * field (`isFieldLocalized`) of a translated field group. Any other value
   * in it is one every language shares.
   */
  translated: boolean;
}

/**
 * The references one field-group field's value makes, each marked with
 * whether a translated value makes it. A translated field group keeps only
 * its translatable fields per language; its other fields hold one value
 * every language reads, so a reference one of them makes belongs to no
 * language. A field group nested in one is judged by its own schema, and is
 * translated too when the field holding it is.
 */
export function collectFieldGroupReferences(
  field: FieldConfig,
  raw: unknown,
  schemas: FieldGroupSchemas
): FieldGroupReference[] {
  const into: FieldGroupReference[] = [];
  const name = (field as { name?: unknown }).name;
  if (typeof name === "string" && name !== "") {
    fieldGroupReferencesAt(field, raw, name, false, schemas, into);
  }
  return into;
}

/**
 * The schema one field-group instance is read by: the one its stored type
 * names, else the one the field names for every instance.
 */
function instanceSchema(
  field: FieldConfig,
  instance: Record<string, unknown>,
  schemas: FieldGroupSchemas
): ReturnType<FieldGroupSchemas["get"]> {
  const slug =
    readFieldGroupType(instance) ?? extractFieldGroupReferences(field).single;
  return slug === undefined ? undefined : schemas.get(slug);
}

/** Whether a field of a field group holds one value per language. */
function translatedChild(
  child: FieldConfig,
  schemaLocalized: boolean | undefined
): boolean {
  return (
    schemaLocalized === true &&
    isFieldLocalized(child as Parameters<typeof isFieldLocalized>[0], true)
  );
}

function fieldGroupReferencesAt(
  field: FieldConfig,
  raw: unknown,
  path: string,
  heldTranslated: boolean,
  schemas: FieldGroupSchemas,
  into: FieldGroupReference[]
): void {
  if (raw === null || raw === undefined) return;
  const value = parsed(raw);
  const instances = Array.isArray(value) ? value : [value];
  for (const instance of instances.filter(isRecord)) {
    const schema = instanceSchema(field, instance, schemas);
    if (!schema) continue;
    for (const child of schema.fields) {
      const childName = (child as { name?: unknown }).name;
      if (typeof childName !== "string" || childName === "") continue;
      childReferences(
        child,
        instance[childName],
        joinPath(path, childName),
        heldTranslated || translatedChild(child, schema.localized),
        schemas,
        into
      );
    }
  }
}

/**
 * One field of a field-group instance: a nested field group read the same
 * way, by its own schema; any other field by its kind.
 */
function childReferences(
  child: FieldConfig,
  raw: unknown,
  path: string,
  translated: boolean,
  schemas: FieldGroupSchemas,
  into: FieldGroupReference[]
): void {
  if (isFieldGroupFieldType((child as { type?: unknown }).type)) {
    fieldGroupReferencesAt(child, raw, path, translated, schemas, into);
    return;
  }
  const found: MediaReference[] = [];
  collectField(child, raw, path, schemas, found);
  for (const ref of found) into.push({ ...ref, translated });
}
