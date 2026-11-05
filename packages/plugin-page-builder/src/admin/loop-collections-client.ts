"use client";

/**
 * A collection loop's read: the collections it can repeat over, each with the
 * fields its entries can be sorted by, through the loop collections route.
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
import { readPluginRoute } from "@nextlyhq/plugin-sdk/admin";

import { PAGE_BUILDER_PLUGIN_NAME } from "../library-contract";
// The CONTRACT, not the route: the route reads the server's registry.
import {
  LOOP_COLLECTIONS_ROUTE_PATH,
  type LoopCollectionItem,
  type LoopCollectionsResponse,
  type LoopSortFieldItem,
} from "../loop-collections-contract";

/** Said when the route answered with something that is not a list of collections. */
const UNEXPLAINED = "Collections could not be listed. Try again.";

/**
 * List the collections a loop can repeat over.
 *
 * Resolves with what the route returned, each item kept only when it is the
 * shape the contract promises, and REJECTS when the route refused or failed,
 * so the controls fall back to typing rather than showing an empty menu as
 * though the site had no collections.
 */
export async function listLoopCollections(): Promise<
  readonly LoopCollectionItem[]
> {
  const body = await readPluginRoute<LoopCollectionsResponse>({
    plugin: PAGE_BUILDER_PLUGIN_NAME,
    path: LOOP_COLLECTIONS_ROUTE_PATH,
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

/** One listed collection, or `undefined` for an item of another shape. */
function collectionOf(item: unknown): LoopCollectionItem | undefined {
  if (typeof item !== "object" || item === null) return undefined;
  const { slug, label, sortFields } = item as Record<string, unknown>;
  if (typeof slug !== "string" || typeof label !== "string") return undefined;
  return {
    slug,
    label,
    sortFields: (Array.isArray(sortFields) ? sortFields : []).flatMap(
      (field: unknown) => {
        const each = sortFieldOf(field);
        return each === undefined ? [] : [each];
      }
    ),
  };
}

/** One sortable field, or `undefined` for an entry of another shape. */
function sortFieldOf(field: unknown): LoopSortFieldItem | undefined {
  if (typeof field !== "object" || field === null) return undefined;
  const { name, label, date } = field as Record<string, unknown>;
  return typeof name === "string" &&
    typeof label === "string" &&
    typeof date === "boolean"
    ? { name, label, date }
    : undefined;
}
