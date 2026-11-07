/**
 * A collection's top-level blocks fields: what a template's Entry content
 * block may draw.
 *
 * One reading of a collection's registry record, shared by the template
 * preview's list (the editor's Field menu), the save's judgement of a
 * template (a field that is not one is refused) and the page actions route
 * (a placed block names the only one where there is one), so the three
 * never disagree about which fields count.
 *
 * Top-level means stored on the entry itself, addressed by its own name: a
 * blocks field directly in the collection's fields, or inside an unnamed
 * container that is presentation only (a group, a row, tabs, a collapsible),
 * which stores its children on the entry as they are. A blocks field inside a
 * named group is stored under it, and one inside a repeater per row, so
 * neither is one: it is never offered and never accepted. Which containers
 * count is core's own rule (`storedAtThisLevel`).
 *
 * @experimental Settles when collection templates ship.
 * @module templates/entry-content-fields
 */
import {
  addressableFields,
  humanizeFieldName,
  NextlyError,
  storedAtThisLevel,
} from "@nextlyhq/plugin-sdk";

import { labelOf, pluralLabelOf } from "../collection-labels";
import { isBlocksField } from "../fields/blocksHelper";

/** One top-level blocks field: its name, and what the admin calls it. */
export interface EntryBlocksField {
  readonly name: string;
  readonly label: string;
}

/** What an author calls a field: its label, or its name in words. */
function wordsOf(field: {
  readonly name: string;
  readonly label?: unknown;
}): string {
  const label = field.label;
  return typeof label === "string" && label.trim() !== ""
    ? label.trim()
    : humanizeFieldName(field.name);
}

/**
 * The top-level blocks fields a collection's registry record declares, in
 * its order. None for a record that is not one.
 */
export function entryBlocksFieldsOf(record: unknown): EntryBlocksField[] {
  if (typeof record !== "object" || record === null) return [];
  const fields = (record as { fields?: unknown }).fields;
  const found: EntryBlocksField[] = [];
  for (const field of addressableFields(fields, {
    descendInto: storedAtThisLevel,
  })) {
    if (typeof field.name !== "string" || field.name === "") continue;
    if (!isBlocksField(field)) continue;
    found.push({
      name: field.name,
      label: wordsOf(field),
    });
  }
  return found;
}

/** A collection's blocks fields and its name, as the save names it. */
export interface EntryBlocksFieldsRead {
  readonly fields: readonly EntryBlocksField[];
  /** The collection's name, as the editor names it: "Posts". */
  readonly label: string;
}

/**
 * `collection`'s top-level blocks fields and its name, read from its
 * registry record; `undefined` for a collection the site does not have.
 *
 * Any other failure to read it is thrown, never answered as "no fields": the
 * save judging a template's Entry content then refuses rather than letting an
 * unchecked field be stored (fail closed), and an API action placing one is
 * refused rather than placed naming a guess.
 */
export async function readEntryBlocksFields(
  collections: {
    getCollection(
      name: string,
      context: Record<string, never>
    ): Promise<unknown>;
  },
  collection: string
): Promise<EntryBlocksFieldsRead | undefined> {
  let record: unknown;
  try {
    record = await collections.getCollection(collection, {});
  } catch (error) {
    if (NextlyError.isNotFound(error)) return undefined;
    throw error;
  }
  if (typeof record !== "object" || record === null) return undefined;
  const named = record as Record<string, unknown>;
  return {
    fields: entryBlocksFieldsOf(named),
    label: pluralLabelOf(named).pluralLabel ?? labelOf(named, collection),
  };
}
