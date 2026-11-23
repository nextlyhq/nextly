/**
 * The stored values of a field held inside a JSON value: a named group's field, kept as a key of the
 * group's object, or a repeater's, kept as a key of each item of the repeater's list, at any depth.
 * Each row's values are read from the container's own column and handed over as JSON values, for
 * the judgement of a field held inside JSON (`collectNestedTypeChange`), which counts a row once by
 * the worst of them, so the counts stay rows, as a field on the row counts them.
 *
 * @module domains/schema/value-conversion/type-change/nested-values
 */
import type { SupportedDialect } from "../../services/field-column-descriptor";
import { type KeyedBy, readStoredValues } from "../read-values";
import type { RowKey } from "../types";

import { parseJson } from "./decode-stored";

/** One step from a container's column to the field: a key, of an object or of each list item. */
export interface NestedStep {
  /** The key the next container, or the field, is kept under. */
  name: string;
  /** The container at this step is a repeater: a list whose every item holds the key. */
  repeated: boolean;
}

/**
 * Each row's values of the field at `path` inside the JSON `column` of `table`, as JSON values: one
 * for a group's field, one per item for a repeater's. A row whose container holds no JSON gives
 * none: nothing there is read under the new type.
 */
export async function* nestedValues(args: {
  db: unknown;
  dialect: SupportedDialect;
  table: string;
  column: string;
  keyedBy: KeyedBy;
  /** The steps from the container's column to the field: the first is the container itself. */
  path: readonly NestedStep[];
}): AsyncGenerator<{ key: RowKey; values: unknown[] }> {
  for await (const stored of readStoredValues(args.db, args.dialect, {
    table: args.table,
    column: args.column,
    keyedBy: args.keyedBy,
    toJson: false,
  })) {
    if (stored.text === null) continue;
    const parsed = parseJson(stored.text);
    if (parsed === null) continue;
    yield { key: stored.key, values: valuesAt(parsed.value, args.path) };
  }
}

/**
 * The values at `path` inside a container's stored JSON. The first step is the container the
 * column holds, so the walk starts inside it: an object for a group, a list of items for a
 * repeater. A key a value does not hold as its own is an empty value, as a field's missing key
 * reads: an object's inherited members (`constructor`) are no field's value.
 */
function valuesAt(value: unknown, path: readonly NestedStep[]): unknown[] {
  const [step, ...rest] = path;
  if (step === undefined) return [value];
  const holders = step.repeated ? (Array.isArray(value) ? value : []) : [value];
  const next = rest[0];
  if (next === undefined) return holders;
  return holders.flatMap(holder =>
    isObject(holder)
      ? valuesAt(
          Object.hasOwn(holder, next.name) ? holder[next.name] : null,
          rest
        )
      : []
  );
}

/** Whether a JSON value is an object, which holds its fields by key. */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
