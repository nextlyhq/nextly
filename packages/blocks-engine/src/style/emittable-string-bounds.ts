/**
 * Every bound on a string this compiler can write into CSS.
 *
 * ## What this is for
 *
 * A caller that digests compiler inputs — a cache key over a page's style
 * inputs, say — must keep enough of each string to tell two inputs apart
 * whenever they compile differently. Keeping strings whole is unbounded, so such
 * a caller truncates, and truncating is sound only while no string the compiler
 * EMITS is longer than what the caller keeps.
 *
 * That is a claim about this package, so this package states it, as data a
 * consumer can assert against rather than as prose a consumer has to trust.
 * Prose describing a set is a second copy of that set: it agrees with the code
 * when written and has nothing to keep it in step afterwards, and the member it
 * falls out of step over is the member a consumer silently stops covering.
 *
 * ## What belongs here
 *
 * A string that reaches emitted CSS and whose length this package bounds. NOT
 * every constant with a cap in its name: `MAX_NAMED_CLASSES` bounds how many
 * entries are read and says nothing about their size, and a count in this array
 * would make a consumer's assertion meaningless.
 *
 * A string the compiler emits with NO bound belongs in the compiler as a bound,
 * not here as an entry. A consumer asserting over this array covers what it
 * lists, so the discipline is to bound the string rather than to record an
 * exception to the invariant.
 *
 * @module style/emittable-string-bounds
 */
import { MAX_BLOCK_TYPE_LENGTH, MAX_BREAKPOINT_ID_LENGTH } from "../document";

import { MAX_TOKEN_NAME_LENGTH } from "./declarations";
import { MAX_NAMED_CLASS_NAME_LENGTH } from "./named-class";

/** One bounded string the compiler can write, named so a failure says which. */
export interface EmittableStringBound {
  /** What the string is, for a message that has to be read by a person. */
  readonly what: string;
  /** The longest the compiler will emit. */
  readonly max: number;
}

/**
 * Every string the compiler emits whose length this package bounds.
 *
 * Ordered by nothing in particular; a consumer reads all of them. Frozen
 * because a caller mutating it would silently narrow what it then verifies.
 */
export const EMITTABLE_STRING_BOUNDS: readonly EmittableStringBound[] =
  Object.freeze([
    { what: "a named class id or slug", max: MAX_NAMED_CLASS_NAME_LENGTH },
    { what: "a breakpoint id", max: MAX_BREAKPOINT_ID_LENGTH },
    { what: "a design token name", max: MAX_TOKEN_NAME_LENGTH },
    { what: "a block type", max: MAX_BLOCK_TYPE_LENGTH },
  ]);
