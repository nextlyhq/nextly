/**
 * One value for the whole process, whichever copy of a module asks for it.
 *
 * Next.js and Turbopack can evaluate a module in more than one server graph,
 * so module state is per copy: a request route and the widgets registered at
 * boot can each hold their own. State two copies must share is held on
 * `globalThis` instead, under a `Symbol.for` key so every copy names the same
 * slot, installed once as a property that is neither enumerable nor writable
 * nor configurable: nothing iterating `globalThis` meets it, and nothing can
 * put another value in its place.
 *
 * @module domains/widgets/process-held
 */

import { NextlyError } from "../../errors/nextly-error";

/**
 * The value held under `key` for this process, installing `make()` the first
 * time any copy asks. `is` checks what is already there, so a slot holding
 * something else fails loudly rather than being read as this value.
 */
export function processHeld<T>(
  key: string,
  make: () => T,
  is: (held: unknown) => held is T
): T {
  const slot = Symbol.for(key);
  if (!Object.prototype.hasOwnProperty.call(globalThis, slot)) {
    // Defaults: not enumerable, not writable, not configurable.
    Object.defineProperty(globalThis, slot, { value: make() });
  }
  const held: unknown = Reflect.get(globalThis, slot);
  if (!is(held)) {
    throw NextlyError.internal({
      logContext: { reason: "process-held-slot-taken", key },
    });
  }
  return held;
}
