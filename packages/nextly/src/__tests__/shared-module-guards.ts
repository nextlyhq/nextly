/**
 * What a unit file must take down before the next file in its worker starts.
 *
 * Loaded only by the unit project that shares a worker's modules across files
 * (`vitest.config.ts`). There a module-level value one file leaves set is the
 * next file's starting state: an extension schema left active makes
 * `previewDesiredSchema` plan tables the next file never declared. Isolated
 * files start from fresh modules, so they need no check.
 *
 * Each check runs after the file's own hooks, takes the value down so the
 * files after it start clean, and fails the file that left it, rather than
 * whichever file happens to run next.
 *
 * @module __tests__/shared-module-guards
 */
import { afterAll, beforeAll, expect } from "vitest";

import {
  activeExtensionSchema,
  clearActiveExtensionSchema,
} from "../domains/schema/extension/active-schema";

import { failingSingletons } from "./shared-module-guards-policy";

afterAll(() => {
  if (activeExtensionSchema() === null) return;
  clearActiveExtensionSchema();
  expect.fail(
    "This file left an extension schema active. Clear it after the tests that set it (`clearActiveExtensionSchema`)."
  );
});

/**
 * The process-wide singletons nextly keeps on `globalThis`, so they survive a
 * module being loaded twice under Next.js: the hook, route and filter
 * registries, the DI container, the event bus, flags, factories and the rest.
 * Each is named `__nextly<something>`, so one prefix finds all of them,
 * including ones added after this file was written.
 */
const SINGLETON = /^__nextly/;

/**
 * Singletons the test setup itself changes after every test, so a change in
 * them says nothing about the file: `setup.ts` reads the aborted-transaction
 * sightings after each test, which creates the list on the first read and
 * empties it on every read.
 */
const SETUP_OWNED = new Set(["__nextly_abortedTransactionSightings"]);

function watched(name: string): boolean {
  return SINGLETON.test(name) && !SETUP_OWNED.has(name);
}

type Collection = Map<unknown, unknown> | Set<unknown> | unknown[];

/**
 * One place a singleton keeps state: the global itself, or one of its own
 * fields. Its value is kept by reference, and a collection's entries by a
 * shallow copy, so a reassignment, a primitive, a function and a collection
 * filled or emptied in place all read as a change.
 */
interface Slot {
  owner: Record<PropertyKey, unknown>;
  key: string;
  /** The slot's name in a report: the global, or `global.field`. */
  label: string;
  had: boolean;
  value: unknown;
  entries: unknown[] | null;
}

function isCollection(value: unknown): value is Collection {
  return value instanceof Map || value instanceof Set || Array.isArray(value);
}

function entriesOf(value: unknown): unknown[] | null {
  if (!isCollection(value)) return null;
  return value instanceof Map ? [...value.entries()] : [...value];
}

function slot(
  owner: Record<PropertyKey, unknown>,
  key: string,
  label = key
): Slot {
  const value = owner[key];
  return {
    owner,
    key,
    label,
    had: key in owner,
    value,
    entries: entriesOf(value),
  };
}

/** A singleton's own fields, when it is an object that is not a collection. */
function fieldsOf(value: unknown): string[] {
  const plain = value !== null && typeof value === "object";
  return plain && !isCollection(value) ? Object.keys(value) : [];
}

const GLOBALS = globalThis as unknown as Record<PropertyKey, unknown>;

/** Every singleton and each of its fields, as they stand now. */
function slots(): Slot[] {
  return Object.getOwnPropertyNames(globalThis)
    .filter(watched)
    .flatMap(name => {
      const value = GLOBALS[name];
      const fields = fieldsOf(value).map(field =>
        slot(value as Record<PropertyKey, unknown>, field, `${name}.${field}`)
      );
      return [slot(GLOBALS, name), ...fields];
    });
}

function sameEntries(a: unknown[] | null, b: unknown[] | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.length === b.length && a.every((entry, at) => Object.is(entry, b[at]))
  );
}

function sameEntry(a: unknown, b: unknown): boolean {
  return Array.isArray(a) && Array.isArray(b)
    ? sameEntries(a, b)
    : Object.is(a, b);
}

/** Whether a slot still holds what it held: the same value, the same entries. */
function unchanged(kept: Slot): boolean {
  const now = slot(kept.owner, kept.key, kept.label);
  if (now.had !== kept.had || !Object.is(now.value, kept.value)) return false;
  if (kept.entries === null || now.entries === null)
    return kept.entries === now.entries;
  return (
    kept.entries.length === now.entries.length &&
    kept.entries.every((entry, at) => sameEntry(entry, now.entries?.[at]))
  );
}

/** Put a collection's entries back in place, keeping its identity. */
function refill(collection: Collection, entries: unknown[]): void {
  if (Array.isArray(collection)) {
    collection.splice(0, collection.length, ...entries);
    return;
  }
  collection.clear();
  for (const entry of entries) {
    if (collection instanceof Map)
      collection.set(...(entry as [unknown, unknown]));
    else collection.add(entry);
  }
}

/** Put a slot back as it was: its value, and a collection's entries. */
function restore(kept: Slot): void {
  if (!kept.had) {
    delete kept.owner[kept.key];
    return;
  }
  kept.owner[kept.key] = kept.value;
  if (kept.entries !== null) refill(kept.value as Collection, kept.entries);
}

let atStart: Slot[] = [];
let namesAtStart = new Set<string>();

beforeAll(() => {
  atStart = slots();
  namesAtStart = new Set(
    atStart.filter(kept => kept.owner === GLOBALS).map(kept => kept.key)
  );
});

// Everything goes back as it was at the file's start, so the next file in the
// worker starts as an isolated file would: a singleton the file changed gets
// its value, fields and entries back, and one it created is removed, to be
// created again by whichever file needs it next, as a cache built on first use
// is. Changing a singleton that was already there is the file's state left for
// the next file, so that also fails the file, naming the singleton.
afterAll(() => {
  const changed = atStart.filter(kept => !unchanged(kept));
  const created = Object.getOwnPropertyNames(globalThis).filter(
    name => watched(name) && !namesAtStart.has(name)
  );
  for (const kept of changed) restore(kept);
  for (const name of created) delete GLOBALS[name];
  const names = failingSingletons(changed);
  if (names.length === 0) return;
  expect.fail(
    `This file changed global singletons and did not put them back: ${names.join(", ")}. Restore them after the tests that change them.`
  );
});
