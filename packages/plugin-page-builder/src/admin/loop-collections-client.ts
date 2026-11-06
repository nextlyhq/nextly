"use client";

/**
 * A collection list's read: the collections it can repeat over, each with the
 * fields its filters and sort may name and its to-many relations, through the
 * loop collections route.
 *
 * A promise rather than a hook, for the reason `entries-client` gives: it is
 * the shape `@nextlyhq/builder`'s content services lend, and the builder
 * shares one read between the loop's two controls.
 *
 * It decides nothing about access: the route lists only the collections the
 * signed-in author may read.
 *
 * @module admin/loop-collections-client
 */
import {
  isListFieldKind,
  STORAGE_PRIMITIVE_AS_FIELD_TYPE,
  type FieldStoragePrimitive,
} from "@nextlyhq/blocks-engine";
import { readPluginRoute } from "@nextlyhq/plugin-sdk/admin";

import { PAGE_BUILDER_PLUGIN_NAME } from "../library-contract";
// The CONTRACT, not the route: the route reads the server's registry.
import {
  loopCollectionsPath,
  type LoopCollectionItem,
  type LoopCollectionsResponse,
  type LoopFieldOption,
  type LoopListFieldItem,
  type LoopReadableField,
  type LoopRelationItem,
} from "../loop-collections-contract";

/** Said when the route answered with something that is not a list of collections. */
const UNEXPLAINED = "Collections could not be listed. Try again.";

/**
 * List the collections a loop can repeat over.
 *
 * Resolves with what the route returned, each item kept only when it is the
 * shape the contract promises, and REJECTS when the route refused or failed,
 * so the controls fall back to typing rather than showing an empty menu as
 * though the site had no collections. `locale` is the language being edited,
 * absent for the default.
 */
export async function listLoopCollections(
  locale?: string
): Promise<readonly LoopCollectionItem[]> {
  const body = await readPluginRoute<LoopCollectionsResponse>({
    plugin: PAGE_BUILDER_PLUGIN_NAME,
    // In the language being edited, so the fields offered are the ones a
    // save in that language takes.
    path: loopCollectionsPath(locale),
  });
  const items =
    typeof body === "object" && body !== null
      ? (body as Partial<LoopCollectionsResponse>).items
      : undefined;
  if (!Array.isArray(items)) throw new Error(UNEXPLAINED);
  return items.flatMap((item: unknown) => {
    const collection = collectionOf(item);
    return collection === undefined ? [] : [collection];
  });
}

/** The entries of an array, each kept only when `read` accepts it. */
function eachOf<T>(
  value: unknown,
  read: (item: unknown) => T | undefined
): T[] {
  return (Array.isArray(value) ? value : []).flatMap((item: unknown) => {
    const each = read(item);
    return each === undefined ? [] : [each];
  });
}

/** An object's own fields, or `undefined` for anything else. */
function recordOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

/** One listed collection, or `undefined` for an item of another shape. */
function collectionOf(item: unknown): LoopCollectionItem | undefined {
  const record = recordOf(item);
  if (record === undefined) return undefined;
  const { slug, label, singular } = record;
  if (typeof slug !== "string" || typeof label !== "string") return undefined;
  return {
    slug,
    label,
    singular: typeof singular === "string" ? singular : label,
    fields: eachOf(record.fields, fieldOf),
    relations: eachOf(record.relations, relationOf),
    declared: eachOf(record.declared, name =>
      typeof name === "string" ? name : undefined
    ),
    readable: eachOf(record.readable, readableOf),
  };
}

/** One choice, or `undefined` for an entry of another shape. */
function optionOf(value: unknown): LoopFieldOption | undefined {
  const record = recordOf(value);
  return typeof record?.value === "string" && typeof record.label === "string"
    ? { value: record.value, label: record.label }
    : undefined;
}

/** One field a list may name, or `undefined` for an entry of another shape. */
function fieldOf(value: unknown): LoopListFieldItem | undefined {
  const record = recordOf(value);
  if (record === undefined) return undefined;
  const { name, label, kind, relationTo, dateOnly } = record;
  if (
    typeof name !== "string" ||
    typeof label !== "string" ||
    !isListFieldKind(kind)
  ) {
    return undefined;
  }
  return {
    name,
    label,
    kind,
    ...(Array.isArray(record.options)
      ? { options: eachOf(record.options, optionOf) }
      : {}),
    ...(typeof relationTo === "string" ? { relationTo } : {}),
    ...(dateOnly === true ? { dateOnly: true } : {}),
  };
}

/** One field the public may read, or `undefined` for an entry of another shape. */
function readableOf(value: unknown): LoopReadableField | undefined {
  const record = recordOf(value);
  if (typeof record?.name !== "string" || typeof record.type !== "string") {
    return undefined;
  }
  const { relationTo, storage } = record;
  return {
    name: record.name,
    ...(typeof record.label === "string" ? { label: record.label } : {}),
    type: record.type,
    ...(record.hasMany === true ? { hasMany: true as const } : {}),
    ...(typeof relationTo === "string" ||
    (Array.isArray(relationTo) &&
      relationTo.every(each => typeof each === "string"))
      ? { relationTo: relationTo as string | readonly string[] }
      : {}),
    // Both decide a field's kind for a list, as the save reads them.
    ...(record.timeOnly === true ? { timeOnly: true as const } : {}),
    ...(isStoragePrimitive(storage) ? { storage } : {}),
  };
}

/** Whether a value names a storage primitive the engine maps to a field type. */
function isStoragePrimitive(value: unknown): value is FieldStoragePrimitive {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(STORAGE_PRIMITIVE_AS_FIELD_TYPE, value)
  );
}

/** One related source, or `undefined` for an entry of another shape. */
function relationOf(value: unknown): LoopRelationItem | undefined {
  const record = recordOf(value);
  return typeof record?.field === "string" &&
    typeof record.label === "string" &&
    typeof record.collection === "string"
    ? {
        field: record.field,
        label: record.label,
        collection: record.collection,
      }
    : undefined;
}
