/**
 * Where a control's custom behaviour lives, when the generic mapping is not
 * enough.
 *
 * Most controls need nothing here: a leaf's kind decides the control, and the
 * leaf's own fields carry the units, bounds and keywords it draws with. A few
 * will want something the catalog cannot express — a spoken value that reads
 * "24 pixels, medium" rather than "24", a bespoke keyboard step.
 *
 * **That behaviour is referenced by NAME and never embedded in the catalog.**
 * `catalog.ts` says of itself that it is data, not code, and four consumers
 * depend on it: validation, the compiler, the inspector, and the generated
 * reference documentation. A function stored in a catalog entry cannot be
 * serialized for the first, cannot be reasoned about by the second, and cannot
 * be documented at all by the fourth — so the catalog keeps its identity and
 * this holds the behaviour under a key derived from it.
 *
 * The alternative was measured in the field rather than reasoned about: a
 * Visual Page Builder that allows functions inside its input config has to stringify
 * and re-evaluate them, and documents the consequence — such a function may not
 * reference anything outside its own body, which typechecks and fails at
 * runtime.
 *
 * **This registry is EMPTY, deliberately.** The shape is fixed so the contract
 * is settled and a control needing behaviour has somewhere to put it; inventing
 * entries before a control asks for one would be building against a guess.
 *
 * **A plain map rather than a mutable module global.** A registry a module
 * mutates on import is one that differs between a test, a server render and a
 * browser, and cannot be varied per editor instance. Passing the map keeps the
 * lookup pure and makes "no behaviour registered" the default that needs no
 * setup.
 *
 * @module style-control-behaviour
 */

import type { StyleValue } from "@nextlyhq/blocks-engine";

/** Behaviour a control cannot derive from its leaf. */
export interface StyleControlBehaviour {
  /**
   * What a screen reader announces in place of the raw value.
   *
   * A slider's thumb reports its number, and a number is the wrong unit of
   * meaning for some properties. `aria-valuetext` is where a spoken form
   * belongs, and it is read from the THUMB rather than inherited from anything.
   */
  readonly ariaValueText?: (value: StyleValue) => string;
}

/** Behaviour by key, as an editor is configured with it. */
export type StyleControlBehaviours = ReadonlyMap<string, StyleControlBehaviour>;

/**
 * The default: nothing registered.
 *
 * Exported as a value so a caller has something to pass rather than reaching
 * for `new Map()` and creating one per render.
 */
export const NO_STYLE_CONTROL_BEHAVIOUR: StyleControlBehaviours = new Map();

/**
 * The key a control's behaviour is registered under.
 *
 * Derived from the catalog's own identity — the property key and the path
 * inside its value — so nothing has to be added to `catalog.ts` for a control
 * to be addressable. A dot separates the segments because a catalog key is a
 * JavaScript identifier and a path segment is a declared field name, so neither
 * can contain one and the join is unambiguous.
 */
export function styleControlBehaviourKey(
  property: string,
  path: readonly string[]
): string {
  return [property, ...path].join(".");
}

/** The behaviour registered for a control, when there is one. */
export function styleControlBehaviour(
  behaviours: StyleControlBehaviours,
  property: string,
  path: readonly string[]
): StyleControlBehaviour | undefined {
  return behaviours.get(styleControlBehaviourKey(property, path));
}
