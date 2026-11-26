/**
 * Every reference a stored value holds, found by walking it against its
 * fields, and the same walk rewriting them by a map.
 *
 * Content refers to other content in these ways, and this walk knows all of
 * them:
 *
 *   - a relationship or upload holds ids as a column, a JSON list, a
 *     polymorphic `{ relationTo, value }`, a list of those, or an expanded
 *     `{ id, ... }`;
 *   - a rich-text tree names media files by the `src` of its image and
 *     gallery nodes;
 *   - a block document (in a `json` field or a plugin's) lists the media it
 *     uses in `assets.mediaIds` and names files by `src` or `url` in its
 *     nodes; any other JSON value names files by `src` or `url`;
 *   - a group, a repeater, a nameless group's fields on the row, and a field
 *     group's instances hold any of these inside them;
 *   - a field type a plugin adds holds what its declared shape says.
 *
 * Which of these a field type uses comes from one table
 * (`field-reference-kinds`). Listing and rewriting are the same walk with a
 * different answer for each reference, so the references a rewrite changes
 * are exactly the ones a listing shows.
 *
 * Pure: it reads no database and changes nothing it is given. A rewrite
 * returns new objects only where something changed, and keeps the stored
 * form of each value: a JSON column a dialect returned as a string comes back
 * as a string.
 *
 * @module domains/data/references/content-references
 */

import type { FieldConfig } from "../../../collections/fields/types";
import { extractFieldGroupReferences } from "../../field-groups/storage/field-group-field-type";
import { readFieldGroupType } from "../../field-groups/storage/field-group-type-key";
import { mediaIdOfRouteAddress } from "../../media/media-route-address";
import {
  isBlockDocument,
  MEDIA_ID_SHAPE,
  parseStoredJson,
  type FieldGroupSchemas,
} from "../../media/usage/media-references";

import { coreFieldReferenceKind } from "./field-reference-kinds";
import type {
  PluginFieldReference,
  PluginReferenceShapes,
} from "./plugin-reference-shapes";
import {
  mappedReference,
  MEDIA_COLLECTION,
  type ContentReference,
  type ReferenceMap,
} from "./reference-map";

/** What a walk reads besides the fields and the value. */
export interface ReferenceWalkContext {
  /**
   * The field-group schemas, by slug, that instances are read by. A field
   * enriched with its `componentFields` or `componentSchemas`, as a version
   * snapshot's are, is read by those when the map lacks the slug.
   */
  fieldGroupSchemas?: FieldGroupSchemas;
  /** The shapes of the field types plugins add. */
  pluginShapes?: PluginReferenceShapes;
}

/** The id or address to store in place of a reference, or `undefined`. */
type Answer = (reference: ContentReference) => string | undefined;

interface Walk {
  schemas: FieldGroupSchemas;
  plugins: PluginReferenceShapes;
  answer: Answer;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nameOf(field: FieldConfig): string {
  const name = (field as { name?: unknown }).name;
  return typeof name === "string" ? name : "";
}

function typeOf(field: FieldConfig): unknown {
  return (field as { type?: unknown }).type;
}

function childFields(field: FieldConfig): FieldConfig[] {
  const nested = (field as { fields?: unknown }).fields;
  return Array.isArray(nested) ? (nested as FieldConfig[]) : [];
}

function joinPath(prefix: string, name: string): string {
  return prefix === "" ? name : `${prefix}.${name}`;
}

/** `items` with each mapped, or `items` itself when none changed. */
function mapItems(
  items: readonly unknown[],
  each: (item: unknown) => unknown
): unknown[] {
  let out: unknown[] | undefined;
  items.forEach((item, index) => {
    const next = each(item);
    if (next !== item) {
      out ??= [...items];
      out[index] = next;
    }
  });
  return out ?? (items as unknown[]);
}

/** `record` with `key` set to `next`, or `record` itself when unchanged. */
function withKey(
  record: Record<string, unknown>,
  key: string,
  next: unknown
): Record<string, unknown> {
  return next === record[key] ? record : { ...record, [key]: next };
}

/**
 * The collections a relationship or upload field points at: `relationTo`, or
 * the Schema Builder's `options.target`. An upload naming none points at
 * media.
 */
function linkTargets(field: FieldConfig): string[] {
  const relationTo = (field as { relationTo?: unknown }).relationTo;
  if (typeof relationTo === "string") return [relationTo];
  if (Array.isArray(relationTo)) {
    return relationTo.filter(
      (slug): slug is string => typeof slug === "string"
    );
  }
  const target = (field as { options?: { target?: unknown } }).options?.target;
  if (typeof target === "string") return [target];
  return typeOf(field) === "upload" ? [MEDIA_COLLECTION] : [];
}

function visitLinkId(
  id: string,
  collection: string | null,
  fieldPath: string,
  walk: Walk
): string {
  if (id === "") return id;
  return walk.answer({ kind: "link", fieldPath, collection, id }) ?? id;
}

/**
 * A relationship's or upload's value in any stored shape. `collection` is
 * the field's single target, or `null` for one that may point at several; a
 * polymorphic value names its own.
 */
function walkLinkValue(
  value: unknown,
  collection: string | null,
  fieldPath: string,
  walk: Walk
): unknown {
  if (typeof value === "string") {
    return visitLinkId(value, collection, fieldPath, walk);
  }
  if (typeof value === "number") {
    const id = String(value);
    const next = visitLinkId(id, collection, fieldPath, walk);
    return next === id ? value : next;
  }
  if (Array.isArray(value)) {
    return mapItems(value, item =>
      walkLinkValue(item, collection, fieldPath, walk)
    );
  }
  if (!isRecord(value)) return value;
  const own =
    typeof value.relationTo === "string" ? value.relationTo : collection;
  if ("value" in value) {
    return withKey(
      value,
      "value",
      walkLinkValue(value.value, own, fieldPath, walk)
    );
  }
  if ("id" in value) {
    return withKey(value, "id", walkLinkValue(value.id, own, fieldPath, walk));
  }
  return value;
}

function visitAddress(url: string, fieldPath: string, walk: Walk): string {
  if (url === "") return url;
  const mediaId = mediaIdOfRouteAddress(url);
  return (
    walk.answer({
      kind: "address",
      fieldPath,
      url,
      ...(mediaId === undefined ? {} : { mediaId }),
    }) ?? url
  );
}

/** Every `src` in a rich-text tree, at any depth: image and gallery nodes. */
function walkRichText(value: unknown, fieldPath: string, walk: Walk): unknown {
  if (Array.isArray(value)) {
    return mapItems(value, item => walkRichText(item, fieldPath, walk));
  }
  if (!isRecord(value)) return value;
  let out = value;
  for (const [key, child] of Object.entries(value)) {
    const next =
      key === "src" && typeof child === "string"
        ? visitAddress(child, fieldPath, walk)
        : walkRichText(child, fieldPath, walk);
    out = withKey(out, key, next);
  }
  return out;
}

/**
 * Each address under a `src` or `url` key, however deep; a list under one of
 * those keys holds addresses too. Nothing else in the value is read, so a
 * list of the value's own ids is not taken for references.
 */
function walkJsonAddresses(
  value: unknown,
  key: string | null,
  fieldPath: string,
  walk: Walk
): unknown {
  if (typeof value === "string") {
    return key === "src" || key === "url"
      ? visitAddress(value, fieldPath, walk)
      : value;
  }
  if (Array.isArray(value)) {
    return mapItems(value, item =>
      walkJsonAddresses(item, key, fieldPath, walk)
    );
  }
  if (!isRecord(value)) return value;
  let out = value;
  for (const [childKey, child] of Object.entries(value)) {
    out = withKey(
      out,
      childKey,
      walkJsonAddresses(child, childKey, fieldPath, walk)
    );
  }
  return out;
}

/**
 * The nodes of a block document that keeps no `assets.mediaIds`: addresses
 * under `src` or `url`, and every other id-shaped string but a node's own
 * `id`, as a likely media item's.
 */
function walkUnlistedBlockNodes(
  value: unknown,
  key: string | null,
  inNode: boolean,
  fieldPath: string,
  walk: Walk
): unknown {
  if (typeof value === "string") {
    if (key === "src" || key === "url") {
      return visitAddress(value, fieldPath, walk);
    }
    if ((inNode && key === "id") || !MEDIA_ID_SHAPE.test(value)) return value;
    return (
      walk.answer({
        kind: "link",
        fieldPath,
        collection: MEDIA_COLLECTION,
        id: value,
        inferred: true,
      }) ?? value
    );
  }
  if (Array.isArray(value)) {
    return mapItems(value, item =>
      walkUnlistedBlockNodes(item, null, false, fieldPath, walk)
    );
  }
  if (!isRecord(value)) return value;
  const isNode = typeof value.type === "string" && "props" in value;
  let out = value;
  for (const [childKey, child] of Object.entries(value)) {
    out = withKey(
      out,
      childKey,
      walkUnlistedBlockNodes(child, childKey, isNode, fieldPath, walk)
    );
  }
  return out;
}

/**
 * A block document: the media its `assets.mediaIds` lists, and the addresses
 * its nodes hold; one with no list has its nodes read for ids as well.
 */
function walkBlockDocument(
  document: Record<string, unknown>,
  fieldPath: string,
  walk: Walk
): Record<string, unknown> {
  const assets = document.assets;
  if (isRecord(assets) && Array.isArray(assets.mediaIds)) {
    const mediaIds = mapItems(assets.mediaIds, id =>
      typeof id === "string"
        ? visitLinkId(id, MEDIA_COLLECTION, fieldPath, walk)
        : id
    );
    const withAssets = withKey(
      document,
      "assets",
      withKey(assets, "mediaIds", mediaIds)
    );
    return withKey(
      withAssets,
      "nodes",
      walkJsonAddresses(document.nodes, null, fieldPath, walk)
    );
  }
  return withKey(
    document,
    "nodes",
    walkUnlistedBlockNodes(document.nodes, null, false, fieldPath, walk)
  );
}

function walkJson(value: unknown, fieldPath: string, walk: Walk): unknown {
  if (isBlockDocument(value)) return walkBlockDocument(value, fieldPath, walk);
  return walkJsonAddresses(value, null, fieldPath, walk);
}

/**
 * The fields one field-group instance is read by: the schema its stored type
 * names, else the one the field names for every instance; from the walk's
 * schemas, else from the field's own enriched schema.
 */
function instanceFields(
  field: FieldConfig,
  instance: Record<string, unknown>,
  schemas: FieldGroupSchemas
): readonly FieldConfig[] | undefined {
  const type = readFieldGroupType(instance);
  const slug = type ?? extractFieldGroupReferences(field).single;
  const known = slug === undefined ? undefined : schemas.get(slug)?.fields;
  if (known) return known;
  const enriched = field as {
    componentFields?: unknown;
    componentSchemas?: Record<string, { fields?: unknown } | undefined>;
  };
  const byType = type ? enriched.componentSchemas?.[type]?.fields : undefined;
  if (Array.isArray(byType)) return byType as FieldConfig[];
  return Array.isArray(enriched.componentFields)
    ? (enriched.componentFields as FieldConfig[])
    : undefined;
}

function walkFieldGroup(
  field: FieldConfig,
  value: unknown,
  fieldPath: string,
  walk: Walk
): unknown {
  const one = (instance: unknown): unknown => {
    if (!isRecord(instance)) return instance;
    const fields = instanceFields(field, instance, walk.schemas);
    return fields ? walkFields(fields, instance, fieldPath, walk) : instance;
  };
  return Array.isArray(value) ? mapItems(value, one) : one(value);
}

function walkPluginValue(
  type: string,
  value: unknown,
  fieldPath: string,
  walk: Walk
): unknown {
  const shape = walk.plugins.get(type);
  if (!shape) return walkJson(value, fieldPath, walk);
  // The plugin's visit is told only what changes, as its declaration says.
  return shape.visit(value, (reference: PluginFieldReference) => {
    const before = "url" in reference ? reference.url : reference.id;
    const after =
      "url" in reference
        ? visitAddress(reference.url, fieldPath, walk)
        : visitLinkId(reference.id, reference.collection, fieldPath, walk);
    return after === before ? undefined : after;
  });
}

/** One field's value, parsed when it is JSON held as a string. */
function walkValue(
  field: FieldConfig,
  value: unknown,
  fieldPath: string,
  walk: Walk
): unknown {
  const type = typeOf(field);
  const kind = coreFieldReferenceKind(type);
  switch (kind) {
    case undefined:
      return walkPluginValue(String(type), value, fieldPath, walk);
    case "none":
      return value;
    case "link": {
      const targets = linkTargets(field);
      const collection = targets.length === 1 ? targets[0] : null;
      return walkLinkValue(value, collection, fieldPath, walk);
    }
    case "richText":
      return walkRichText(value, fieldPath, walk);
    case "json":
      return walkJson(value, fieldPath, walk);
    case "group":
      return isRecord(value)
        ? walkFields(childFields(field), value, fieldPath, walk)
        : value;
    case "repeater":
      return Array.isArray(value)
        ? mapItems(value, row =>
            isRecord(row)
              ? walkFields(childFields(field), row, fieldPath, walk)
              : row
          )
        : value;
    case "fieldGroup":
      return walkFieldGroup(field, value, fieldPath, walk);
  }
}

/**
 * A stored value: JSON a dialect returned as a string is parsed, walked, and
 * written back as a string when anything in it changed.
 */
function walkStored(
  field: FieldConfig,
  raw: unknown,
  fieldPath: string,
  walk: Walk
): unknown {
  const value = parseStoredJson(raw);
  const next = walkValue(field, value, fieldPath, walk);
  if (next === value) return raw;
  return typeof raw === "string" && value !== raw ? JSON.stringify(next) : next;
}

function walkFields(
  fields: readonly FieldConfig[],
  holder: Record<string, unknown>,
  prefix: string,
  walk: Walk
): Record<string, unknown> {
  let out = holder;
  for (const field of fields) {
    const name = nameOf(field);
    if (name === "") {
      // A nameless group keeps its fields on the object that holds it.
      if (typeOf(field) === "group") {
        out = walkFields(childFields(field), out, prefix, walk);
      }
      continue;
    }
    const raw = out[name];
    if (raw === null || raw === undefined) continue;
    out = withKey(
      out,
      name,
      walkStored(field, raw, joinPath(prefix, name), walk)
    );
  }
  return out;
}

function walkOf(context: ReferenceWalkContext, answer: Answer): Walk {
  return {
    schemas: context.fieldGroupSchemas ?? new Map(),
    plugins: context.pluginShapes ?? new Map(),
    answer,
  };
}

/**
 * Every reference `values` holds through `fields`, in field order. `values`
 * is keyed by field name, as a stored row in read shape, a field group's
 * instance or a version snapshot is.
 */
export function listContentReferences(
  fields: readonly FieldConfig[],
  values: Record<string, unknown>,
  context: ReferenceWalkContext = {}
): ContentReference[] {
  const found: ContentReference[] = [];
  walkFields(
    fields,
    values,
    "",
    walkOf(context, reference => {
      found.push(reference);
      return undefined;
    })
  );
  return found;
}

/**
 * `values` with every reference `map` names replaced, and every other one
 * kept as it is. Returns `values` itself when nothing changed, and otherwise
 * a copy that shares every part that did not.
 */
export function rewriteContentReferences(
  fields: readonly FieldConfig[],
  values: Record<string, unknown>,
  map: ReferenceMap,
  context: ReferenceWalkContext = {}
): Record<string, unknown> {
  return walkFields(
    fields,
    values,
    "",
    walkOf(context, reference => mappedReference(map, reference))
  );
}
