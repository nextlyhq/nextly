/**
 * The stored values of a field held inside a JSON value: a named group's field, kept as a key of the
 * group's object, or a repeater's, kept as a key of each item of the repeater's list, at any depth.
 * Each is read from the container's own column, row by row, and handed over as the old field reads
 * it (`itemOf`), for the same judgement as a field kept on the row (`collectTypeChange`).
 *
 * A row is named once, by the worst of its values: a repeater holding one item the new type cannot
 * read and one it can is one row that loses a value, so the counts stay rows, as a field on the row
 * counts them.
 *
 * @module domains/schema/value-conversion/type-change/nested-values
 */
import type { SupportedDialect } from "../../services/field-column-descriptor";
import { type KeyedBy, readStoredValues } from "../read-values";
import type { RowKey } from "../types";

import { itemOf, parseJson } from "./decode-stored";
import type { FieldTypeOnDialect } from "./field-type";
import { judgeValue, type OldValue, type ValueOutcome } from "./judge";

/** One step from a container's column to the field: a key, of an object or of each list item. */
export interface NestedStep {
  /** The key the next container, or the field, is kept under. */
  name: string;
  /** The container at this step is a repeater: a list whose every item holds the key. */
  repeated: boolean;
}

/** How bad each outcome is, so a row is named by its worst value. */
const SEVERITY: Record<ValueOutcome, number> = {
  kept: 0,
  changed: 1,
  lost: 2,
  blocked: 3,
};

/**
 * Each row's worst value of the field at `path` inside the JSON `column` of `table`, as the old
 * field reads it. A row whose container holds no value for the field, or holds no JSON, gives none:
 * nothing there is read under the new type.
 */
export async function* nestedValues(args: {
  db: unknown;
  dialect: SupportedDialect;
  table: string;
  column: string;
  keyedBy: KeyedBy;
  /** The steps from the container's column to the field: the first is the container itself. */
  path: readonly NestedStep[];
  from: FieldTypeOnDialect;
  to: FieldTypeOnDialect;
}): AsyncGenerator<{
  key: RowKey;
  text: string | null;
  old: OldValue;
}> {
  for await (const stored of readStoredValues(args.db, args.dialect, {
    table: args.table,
    column: args.column,
    keyedBy: args.keyedBy,
    toJson: false,
  })) {
    if (stored.text === null) continue;
    const parsed = parseJson(stored.text);
    if (parsed === null) continue;
    let worst: { text: string | null; old: OldValue; rank: number } | null =
      null;
    for (const value of valuesAt(parsed.value, args.path)) {
      const old = itemOf(args.from, value);
      const rank = SEVERITY[judgeValue(args.from, args.to, old).outcome];
      if (worst === null || rank > worst.rank) {
        worst = { text: textOf(value), old, rank };
      }
    }
    if (worst !== null) {
      yield { key: stored.key, text: worst.text, old: worst.old };
    }
  }
}

/**
 * The values at `path` inside a container's stored JSON. The first step is the container the
 * column holds, so the walk starts inside it: an object for a group, a list of items for a
 * repeater. A key a value lacks is an empty value, as a field's missing key reads.
 */
function valuesAt(value: unknown, path: readonly NestedStep[]): unknown[] {
  const [step, ...rest] = path;
  if (step === undefined) return [value];
  const holders = step.repeated ? (Array.isArray(value) ? value : []) : [value];
  const next = rest[0];
  if (next === undefined) return holders;
  return holders.flatMap(holder =>
    isObject(holder) ? valuesAt(holder[next.name] ?? null, rest) : []
  );
}

/** Whether a JSON value is an object, which holds its fields by key. */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A value's writing, as a stored text of it would be: a text as it is, anything else as JSON. */
function textOf(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return typeof value === "string" ? value : JSON.stringify(value);
}
