/**
 * Every bound on a string this compiler can write into CSS.
 *
 * ## Why this list exists rather than a comment saying the same thing
 *
 * A caller that digests compiler inputs has to keep enough of each string to
 * tell two inputs apart whenever they compile differently. Keeping strings
 * whole is unbounded, so such a caller truncates — and truncating is sound only
 * while no string the compiler EMITS can be longer than what the caller keeps.
 *
 * That is a claim about this package, and it was made twice as a COMMENT
 * enumerating the strings involved. Both enumerations were short by one: the
 * first missed a token-reference name, and the second, written to fix the
 * first, missed a block type. A list held beside the prose it justifies is a
 * copy, and a copy of a set drifts from the set the moment either moves.
 *
 * So the list is data, it lives with the bounds it names, and the caller reads
 * it. Adding a bounded string to the compiler means adding a line here, and a
 * consumer's assertion over this array then covers it without being edited —
 * which is the difference between a rule and a list of the cases someone
 * remembered.
 *
 * ## What belongs here
 *
 * A string that reaches emitted CSS and whose length is bounded by this
 * package. NOT every constant with a cap in its name: `MAX_NAMED_CLASSES`
 * bounds how many entries are read and says nothing about their size, and a
 * count in this array would make the assertion below meaningless.
 *
 * A string the compiler emits with NO bound belongs here least of all — it
 * belongs in the compiler, as a bound. That is the point of the array: the
 * missing member is the defect, and a consumer asserting over it can only
 * catch what is listed, so the discipline is to add the bound rather than to
 * add an exception.
 *
 * @module style/emittable-string-bounds
 */
import { MAX_BREAKPOINT_ID_LENGTH } from "../document";

import { MAX_BLOCK_TYPE_LENGTH } from "./compile-page";
import { MAX_TOKEN_NAME_LENGTH } from "./declarations";
import { MAX_NAMED_CLASS_NAME_LENGTH } from "./named-class";

// Re-exported so the bound and the list that names it arrive together: a
// consumer asserting over the list usually also wants the constant by name.
export { MAX_BLOCK_TYPE_LENGTH };

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
