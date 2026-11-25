/**
 * What to tell an editor when a release write is refused.
 *
 * The server's own sentence, where that sentence is about their INPUT, and our
 * words otherwise. The distinction is deliberate and it is not cosmetic:
 * `NextlyError.forbidden` ships one fixed message precisely so a response
 * cannot leak the shape of the authority model, so relaying it verbatim would
 * tell an editor nothing while relaying an internal error's message could tell
 * them something about the database. A validation refusal is the opposite case
 * — it names the field and the limit, it is the only place that number lives,
 * and restating it in the client would be a second implementation of the same
 * boundary that drifts the moment the storage contract changes.
 *
 * @module components/features/releases/release-error
 */

/**
 * Codes whose message is ABOUT the caller's input, and therefore safe and
 * useful to show.
 *
 * An allowlist rather than a denylist: a code this file has not met yet falls
 * through to the caller's own wording, which is the failure direction that
 * cannot leak anything. A denylist would show the message for every code added
 * later, including ones that carry internal detail.
 */
const SPEAKS_TO_THE_CALLER = new Set([
  "VALIDATION_ERROR",
  "INVALID_INPUT",
  "DUPLICATE",
  "CONFLICT",
]);

/**
 * Refusals that pass in a moment, in our words: the server's sentence for them is about the
 * collection's state, not the caller's input, and the one thing an editor needs is to try again.
 * A release write meets this while a Builder save is changing a collection one of its documents
 * is in.
 */
const PASSES_IN_A_MOMENT: Readonly<Record<string, string>> = {
  COLLECTION_BEING_CHANGED:
    "A collection in this release is being changed in the Builder. Try again in a moment.",
};

export function releaseErrorMessage(error: unknown, fallback: string): string {
  if (typeof error !== "object" || error === null) return fallback;
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (
    typeof code === "string" &&
    Object.prototype.hasOwnProperty.call(PASSES_IN_A_MOMENT, code)
  ) {
    return PASSES_IN_A_MOMENT[code] ?? fallback;
  }
  if (typeof code !== "string" || !SPEAKS_TO_THE_CALLER.has(code)) {
    return fallback;
  }
  return typeof message === "string" && message.length > 0 ? message : fallback;
}

/**
 * Whether a failed request was a definite refusal: the server answered, with
 * a client-error status and its error envelope, so nothing it was asked to do
 * happened.
 *
 * Anything else, such as no answer at all, a server error, or a body that
 * was not the envelope, leaves the outcome unknown: the server may have done
 * the work and lost only the reply.
 */
export function isDefiniteRefusal(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { status, code } = error as { status?: unknown; code?: unknown };
  return (
    typeof status === "number" &&
    status >= 400 &&
    status < 500 &&
    typeof code === "string" &&
    code !== "UNKNOWN"
  );
}
