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
 * blocks field directly in the collection's fields, or inside a container
 * that is presentation only (an unnamed group, tabs, a row), which stores
 * its children on the entry as they are. A blocks field inside a named group
 * or a repeater is stored under that field and is not one.
 *
 * @experimental Settles when collection templates ship.
 * @module templates/entry-content-fields
 */
import { addressableFields, humanizeFieldName } from "@nextlyhq/plugin-sdk";

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
  for (const field of addressableFields(fields)) {
    if (typeof field.name !== "string" || field.name === "") continue;
    if (!isBlocksField(field)) continue;
    found.push({
      name: field.name,
      label: wordsOf(field),
    });
  }
  return found;
}
