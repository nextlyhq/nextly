/**
 * An entry's title as a visitor reads it: what an unbind names when a link
 * keeps going to that entry's page.
 *
 * Its collection's title field, as every entries list names its rows by
 * (`collectionNaming`), read through the public reader, so a title is named
 * only where a visitor may read the entry and the field. Anything else names
 * none, and the caller says "the page visitors saw" instead.
 *
 * @module visitor-entry-title
 */
import { isPlainRecord } from "@nextlyhq/blocks-engine";
import { readableTitleText } from "nextly/config";

import {
  collectionNaming,
  type CollectionConfigs,
} from "./bindings-report/readable";
import { publicSourceReader } from "./entry-reads";
import type { UnbindReads } from "./unbind-kept";

/**
 * The title of entry `id` of `collection` as a visitor reads it, or
 * `undefined` where the collection names no title field, a visitor may not
 * read the entry or its title, or the title is empty. Never throws: a title
 * is a nicety of the note, never a reason to fail the unbind.
 */
async function visitorEntryTitle(
  collections: CollectionConfigs,
  entry: { readonly collection: string; readonly id: string },
  locale: string | undefined
): Promise<string | undefined> {
  try {
    const naming = await collectionNaming(
      { services: { collections } },
      entry.collection
    );
    const field = naming?.titleField;
    if (field === undefined) return undefined;
    const reader = await publicSourceReader(locale);
    const found = await reader.find({
      collection: entry.collection,
      filters: [{ field: "id", op: "equals", value: entry.id }],
      select: [field],
      limit: 1,
    });
    const row = found.items[0];
    return isPlainRecord(row) && Object.hasOwn(row, field)
      ? readableTitleText(row[field])
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * What an unbind reads beyond the visitor's view, over a route's collection
 * configurations: the one place the page actions API and the inspector's
 * unbind plan get it, so both name a link's entry alike.
 */
export function unbindReadsOf(collections: CollectionConfigs): UnbindReads {
  return {
    entryTitle: async (entry, locale) =>
      await visitorEntryTitle(collections, entry, locale),
  };
}
