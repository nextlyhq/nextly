/**
 * The access an answer read ahead for a dashboard load was read under, as one
 * value two requests can compare: a digest the layout read left for its batch
 * is handed to that batch only when the batch asks under exactly the same
 * access, and read anew otherwise.
 *
 * Derived from the WHOLE caller, not from a list of its fields: every field
 * the caller carries, nested and in a stable order (the person, their roles
 * and every verified claim a rule may read; an API key's scope, its slugs, its
 * rows and its roles), and the caller as the access gate reads it
 * (`readAccessCaller`), which is where an authority held outside the caller
 * object is read, through the gate's own accessor: an API key's super-admin
 * authority, kept beside its scope rather than on it. So a field or an
 * authority added to either later is part of the comparison without this
 * module naming it.
 *
 * Fails closed: a caller holding a value that cannot be compared as written
 * (a function, a class instance, a symbol key, a cycle) or that the gate
 * refuses to read has no fingerprint, and nothing is reused for it.
 *
 * @module services/dashboard/read-ahead-access
 */

import { readAccessCaller } from "../../auth/entity-read-access";

import type { ReadCaller } from "./readable-resources";

/**
 * The access `caller` reads under on `credential`, as text equal for two
 * requests exactly when everything the access decision reads is equal; or
 * `undefined` when it cannot be stated, and then nothing read ahead is kept
 * or taken.
 *
 * Read on each side of the load at its own request, so an authority that
 * lapsed between the layout read and its batch reads differently.
 */
export function readAheadAccess(
  caller: ReadCaller,
  credential: string | undefined
): string | undefined {
  if (credential === undefined) return undefined;
  let gate: unknown;
  try {
    gate = readAccessCaller(caller);
  } catch {
    // A scope the gate refuses to read (its rows and slugs disagree) is no
    // access to compare.
    return undefined;
  }
  return comparable([credential, caller, gate], new Set());
}

/**
 * `value` as text with every object's keys in one order, or `undefined` for
 * anything that would not survive being written out as it is.
 */
function comparable(value: unknown, open: Set<object>): string | undefined {
  if (value === null || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    return Number.isFinite(value) ? JSON.stringify(value) : undefined;
  }
  // `undefined` at the top or in a list, a function, a symbol, a bigint, or
  // an object already being written (a cycle).
  if (typeof value !== "object" || open.has(value)) return undefined;
  open.add(value);
  const text = Array.isArray(value)
    ? listText(value, open)
    : recordText(value, open);
  open.delete(value);
  return text;
}

function listText(
  list: readonly unknown[],
  open: Set<object>
): string | undefined {
  const items: string[] = [];
  for (const item of list) {
    const text = comparable(item, open);
    if (text === undefined) return undefined;
    items.push(text);
  }
  return `[${items.join(",")}]`;
}

/**
 * A plain record's fields in key order. A field holding `undefined` is left
 * out, as an absent one: every access decision reads the two alike. Anything
 * but a plain record, or one with a field `Object.entries` does not list (a
 * symbol key, a hidden field), cannot be written out whole.
 */
function recordText(record: object, open: Set<object>): string | undefined {
  if (!isPlainRecord(record)) return undefined;
  const fields: string[] = [];
  for (const [key, field] of Object.entries(record).sort(byKey)) {
    if (field === undefined) continue;
    const text = comparable(field, open);
    if (text === undefined) return undefined;
    fields.push(`${JSON.stringify(key)}:${text}`);
  }
  return `{${fields.join(",")}}`;
}

/** Whether every field of `record` is one `Object.entries` lists, on a plain record. */
function isPlainRecord(record: object): boolean {
  const prototype: unknown = Object.getPrototypeOf(record);
  return (
    (prototype === Object.prototype || prototype === null) &&
    Reflect.ownKeys(record).length === Object.keys(record).length
  );
}

/** Fields in the order of their keys' code units, the same in every process. */
function byKey([a]: [string, unknown], [b]: [string, unknown]): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}
