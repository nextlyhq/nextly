/**
 * The entries of the lists around a block, by list id: each list records its
 * entry beside it as it draws it (`withListEntry`), and an item binding that
 * names the list it reads (`list`), for a block inside a list inside
 * another, is filled from that list's entry (`enclosingListEntries`).
 *
 * @module blocks/list-entries
 */
import { listItemRef, type EnclosingListEntry } from "@nextlyhq/blocks-engine";

import type { DrawnListEntry, PageContext } from "../context";

/**
 * The context an entry of list `listId` is drawn with, recording that entry
 * among the entries of the lists around what it draws.
 */
export function withListEntry(entry: PageContext, listId: string): PageContext {
  const { item } = entry;
  if (item === undefined) return entry;
  const drawn: DrawnListEntry = {
    item,
    ...(entry.itemSource === undefined ? {} : { itemSource: entry.itemSource }),
    ...(entry.itemQuery === undefined ? {} : { itemQuery: entry.itemQuery }),
  };
  return {
    ...entry,
    listEntries: new Map(entry.listEntries).set(listId, drawn),
  };
}

/**
 * The entries of the lists around a block, as a binding's scope takes them:
 * each entry with the schema it binds against, by the engine's one rule.
 */
export function enclosingListEntries(
  context: Pick<PageContext, "listEntries">
): ReadonlyMap<string, EnclosingListEntry> | undefined {
  const drawn = context.listEntries;
  if (drawn === undefined) return undefined;
  const entries = new Map<string, EnclosingListEntry>();
  for (const [listId, entry] of drawn) {
    const itemRef = listItemRef({
      collection: entry.itemSource,
      query: entry.itemQuery,
    });
    entries.set(listId, {
      item: entry.item,
      ...(itemRef === undefined ? {} : { itemRef }),
    });
  }
  return entries;
}
