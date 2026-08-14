/**
 * Operation names the document format reserves.
 *
 * Composition flows — saving a subtree as a pattern, promoting one to a
 * component, detaching an instance back to plain content — are operations and
 * API actions rather than editor gestures, so a script or an agent can perform
 * them without driving a UI. Their behaviour ships with the composition
 * features; the NAMES are claimed now, because a name is only reservable before
 * something else takes it.
 *
 * This exists so the reservation is a value rather than a sentence in a
 * document. A list written in prose cannot be asked a question: an operation
 * layer deciding whether to accept a name has nothing to compare against, and a
 * spec page and an implementation drift the moment either is edited alone.
 *
 * @module operations
 */

/**
 * Reserved names, in the order the format spec lists them.
 *
 * `as const` rather than a plain array: the literal types are what let a
 * consumer narrow an incoming name against this list, and a `string[]` would
 * make every membership test return `boolean` with nothing gained.
 */
export const RESERVED_OPERATION_NAMES = [
  "saveAsPattern",
  "saveAsComponent",
  "convertToComponent",
  "detachComponent",
] as const;

/** One of the names the format reserves for a composition flow. */
export type ReservedOperationName = (typeof RESERVED_OPERATION_NAMES)[number];

/**
 * Whether a name is reserved by the format.
 *
 * An operation layer should refuse a reserved name it does not implement rather
 * than treating it as unknown: "unknown operation" invites a caller to define
 * their own `saveAsPattern`, which is precisely what reserving the name exists
 * to prevent, and the collision would surface only once the real one shipped.
 *
 * Takes `string` rather than a narrowed union on purpose — the input is an
 * operation name off a stored, replayable document, so it is untrusted by
 * definition and a signature demanding the answer as its argument would be
 * unusable at the only call site that matters.
 */
export function isReservedOperationName(
  name: string
): name is ReservedOperationName {
  return (RESERVED_OPERATION_NAMES as readonly string[]).includes(name);
}
