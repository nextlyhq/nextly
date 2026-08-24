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

import { MAX_SCOPE_LENGTH } from "./compile-page";
import { MAX_VALUE_LENGTH } from "./css-value";
import { MAX_TOKEN_NAME_LENGTH, MAX_TOKEN_PREFIX_LENGTH } from "./declarations";
import { MAX_NAMED_CLASS_NAME_LENGTH } from "./named-class";
import {
  MAX_FONT_FORMAT_LENGTH,
  MAX_TOKEN_SELECTOR_LENGTH,
} from "./site-tokens";

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
 * Ordered by nothing in particular; a consumer reads all of them.
 *
 * Each ENTRY is frozen as well as the array. `Object.freeze` is shallow, so
 * freezing the array alone leaves every `max` writable: a consumer in the same
 * process could assign one and silently narrow the contract every later reader
 * observes, while the array itself reported as frozen. `readonly` is a
 * compile-time claim and reaches no JavaScript caller at all.
 */
export const EMITTABLE_STRING_BOUNDS: readonly EmittableStringBound[] =
  Object.freeze([
    // The literal style value, and the largest bound here. A consumer choosing a
    // truncation limit reads the whole set, so omitting the biggest lets it
    // verify every listed bound and still cut below one the compiler emits.
    Object.freeze({ what: "a literal style value", max: MAX_VALUE_LENGTH }),
    Object.freeze({
      what: "a named class id or slug",
      max: MAX_NAMED_CLASS_NAME_LENGTH,
    }),
    Object.freeze({ what: "a breakpoint id", max: MAX_BREAKPOINT_ID_LENGTH }),
    Object.freeze({ what: "a design token name", max: MAX_TOKEN_NAME_LENGTH }),
    Object.freeze({ what: "a block type", max: MAX_BLOCK_TYPE_LENGTH }),
    Object.freeze({
      what: "a custom-property prefix",
      max: MAX_TOKEN_PREFIX_LENGTH,
    }),
    Object.freeze({ what: "a page scope", max: MAX_SCOPE_LENGTH }),
    Object.freeze({ what: "a font format", max: MAX_FONT_FORMAT_LENGTH }),
    Object.freeze({
      what: "a token-block selector",
      max: MAX_TOKEN_SELECTOR_LENGTH,
    }),
  ]);
