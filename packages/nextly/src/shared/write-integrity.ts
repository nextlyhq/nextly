/**
 * Write-integrity failures — errors that must roll a write back, not be softened.
 *
 * The bulk workers turn an ordinary error raised after a row was written into a
 * soft per-item failure and carry on inside the SAME transaction. That is right
 * for a failure that concerns only its own item, and wrong for one that means
 * the row committed without something it promised — a version, an outbox event,
 * an audit entry. Marking says which.
 *
 * Deliberately its own module with no imports. The mark is set by the recording
 * helpers and read by the bulk loops, which live in different domains; holding
 * it in either one makes the other import a service graph it does not otherwise
 * need, and dragging adapter-backed database modules into a webhook unit test is
 * how that shows up.
 *
 * @module shared/write-integrity
 */

/**
 * Marked errors, held weakly so marking never keeps one alive.
 *
 * A WeakSet rather than a flag on the error: the value may be frozen, a proxy,
 * or shared, and an error that cannot be marked propagates unwrapped instead of
 * throwing a second failure while reporting the first.
 */
const writeIntegrityFailures = new WeakSet<object>();

/** Mark `error` as a failure that must roll the enclosing transaction back. */
export function markWriteIntegrityFailure<E>(error: E): E {
  if (typeof error === "object" && error !== null) {
    writeIntegrityFailures.add(error);
  }
  return error;
}

/**
 * Whether `error` was marked a write-integrity failure — a post-write capture or
 * recording failure that must roll the enclosing transaction back rather than be
 * reported as a soft per-item failure. The bulk create/update loops re-throw
 * these to abort the transaction.
 */
export function isWriteIntegrityFailure(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    writeIntegrityFailures.has(error)
  );
}
