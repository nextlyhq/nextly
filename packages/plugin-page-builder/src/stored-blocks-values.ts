/**
 * The values a stored document holds at a blocks field's declared path.
 *
 * A declared path names each container by name (`hero.body`,
 * `sections.body`). A named group stores its fields in one object, so the
 * path leads to one value; a repeater stores its rows as a list, each row
 * holding the rest of the path, so the path leads to one value per row. A
 * reader asking whether any stored blocks value uses something must see every
 * row's, or a use inside a row passes for none: the rescan before a shared
 * style is removed would then let a style still applied in a row be deleted.
 *
 * Every step is read through `readStoredJson`, since a group or a repeater may
 * arrive as the text SQLite stored it.
 *
 * @module stored-blocks-values
 */
import { readStoredJson } from "./stored-json";

/** The record a stored value is, or `undefined` when it is none. */
function recordOf(value: unknown): Record<string, unknown> | undefined {
  const read = readStoredJson(value);
  return typeof read === "object" && read !== null && !Array.isArray(read)
    ? (read as Record<string, unknown>)
    : undefined;
}

/**
 * Every value `doc` stores at the declared `path`, one for each repeater row
 * on the way (each row of each row, for a repeater inside a row), parsed.
 * Empty where the path holds nothing.
 */
export function storedValuesAt(doc: unknown, path: string): unknown[] {
  let holders: unknown[] = [doc];
  for (const key of path.split(".")) {
    holders = holders.flatMap(holder => {
      const read = readStoredJson(holder);
      // A repeater's value is its rows, each of which holds the next step.
      const records = Array.isArray(read)
        ? read.map(recordOf)
        : [recordOf(read)];
      return records.flatMap(record =>
        record !== undefined && Object.hasOwn(record, key) ? [record[key]] : []
      );
    });
  }
  return holders.map(readStoredJson);
}
