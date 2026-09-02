/**
 * The one way the storage layer says a read exceeded the caller's cap.
 *
 * `StorageReadOptions.maxBytes` is part of the adapter contract, so what happens
 * when it is exceeded belongs to the contract too. Without this each backend
 * refuses in its own vocabulary — the URL-addressed ones through a fetch error
 * carrying a `reason`, S3 through whatever its own code threw — and a caller
 * wanting to tell "too large" from "could not read" has to know which adapter it
 * is talking to. That is the thing an adapter contract exists to stop.
 *
 * Distinct from a generic internal failure because callers ACT on the
 * difference. The email attachment path answers an over-cap read with
 * `ATTACHMENT_SIZE_EXCEEDED`, which tells an author to attach something smaller;
 * a storage failure tells them nothing they can act on. Collapsing the two turns
 * a fixable refusal into an opaque error, which is the same conflation this
 * contract already draws between a missing key and an unreachable store.
 *
 * @module storage/read-errors
 */
import { NextlyError } from "../errors/nextly-error";

/**
 * A read refused because the object is larger than the caller allowed.
 *
 * Carries the numbers rather than only a message, so a caller can say what the
 * limit was without parsing prose — and so the message itself stays free of the
 * key, which should not travel to whoever asked for the file.
 */
export class StorageReadTooLargeError extends NextlyError {
  constructor(
    /** What was being read, for the log side only. */
    public readonly path: string,
    /** The cap the caller set, in bytes. */
    public readonly maxBytes: number,
    /** What the store reported, where it reported anything. */
    public readonly size?: number
  ) {
    super({
      code: "STORAGE_READ_TOO_LARGE",
      publicMessage: "The stored file is larger than the limit for this read.",
      logContext: {
        path,
        maxBytes,
        ...(size === undefined ? {} : { size }),
      },
    });
  }
}

/**
 * Whether a thrown value is the over-cap refusal.
 *
 * A predicate rather than leaving every caller to write `instanceof`, because
 * this module can be loaded twice — a narrow entry point and a barrel are
 * different module instances, and `instanceof` across them is false for objects
 * that are otherwise identical. Callers that ask here cannot be caught by that.
 */
export function isStorageReadTooLarge(
  error: unknown
): error is StorageReadTooLargeError {
  // `NextlyError.is` already narrows, so no cast: an assertion here would be
  // one the checker cannot use and a reader would take as load-bearing.
  return NextlyError.is(error) && error.code === "STORAGE_READ_TOO_LARGE";
}
