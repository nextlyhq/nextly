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
 * registries, the DI container, the event bus and the rest. Each is named
 * `__nextly_<something>`, so one prefix finds all of them, including ones added
 * after this file was written.
 */
const SINGLETON = /^__nextly/;

/** The entries a Map, Set or array holds, or 0 for anything else. */
function entriesOf(value: unknown): number {
  if (value instanceof Map || value instanceof Set) return value.size;
  return Array.isArray(value) ? value.length : 0;
}

/** How much a singleton holds: its own entries and those of its fields. */
function held(value: unknown): number {
  if (value === null || typeof value !== "object") return 0;
  return Object.values(value).reduce<number>(
    (sum, field) => sum + entriesOf(field),
    entriesOf(value)
  );
}

function singletons(): Map<string, number> {
  return new Map(
    Object.getOwnPropertyNames(globalThis)
      .filter(name => SINGLETON.test(name))
      .map(name => [name, held((globalThis as Record<string, unknown>)[name])])
  );
}

let atStart = new Map<string, number>();

beforeAll(() => {
  atStart = singletons();
});

// A singleton that holds more at the end of a file than at its start was left
// filled by that file: a registered route, hook or service the next file finds
// already there.
afterAll(() => {
  const grown = [...singletons()]
    .filter(([name, now]) => now > (atStart.get(name) ?? 0))
    .map(([name, now]) => `${name} (${atStart.get(name) ?? 0} -> ${now})`);
  if (grown.length === 0) return;
  expect.fail(
    `This file left global singletons holding more than it found: ${grown.join(", ")}. Reset them after the tests that fill them.`
  );
});
