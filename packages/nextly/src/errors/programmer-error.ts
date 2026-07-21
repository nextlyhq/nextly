/**
 * Telling our bugs apart from the caller's mistakes.
 *
 * Service layers commonly wrap their body in one try/catch and map anything
 * thrown onto a single fallback status. That is right for expected failures
 * (invalid input, a missing row) and wrong for a defect in our own code: a
 * `TypeError` from a bad property access surfaces to the caller as
 * "Validation failed", so they inspect a payload that was never the problem
 * while the real defect leaves no trace at the status code.
 *
 * @module errors/programmer-error
 */

/**
 * Whether a thrown value indicates a defect in Nextly rather than bad input.
 *
 * Only `TypeError` and `ReferenceError` qualify. Both are raised by the
 * runtime for operations that are wrong regardless of input: reading a
 * property of `undefined`, calling a non-function, touching an unbound
 * identifier.
 *
 * `SyntaxError` and `RangeError` are deliberately excluded even though they
 * are also natives. `JSON.parse` of a caller-supplied body throws
 * `SyntaxError`, and a caller-supplied count throws `RangeError`; treating
 * either as our defect would turn genuine 4xx cases into 500s, which is the
 * same misreporting in the other direction.
 */
export function isProgrammerError(error: unknown): boolean {
  return error instanceof TypeError || error instanceof ReferenceError;
}
