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

export function releaseErrorMessage(error: unknown, fallback: string): string {
  if (typeof error !== "object" || error === null) return fallback;
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (typeof code !== "string" || !SPEAKS_TO_THE_CALLER.has(code)) {
    return fallback;
  }
  return typeof message === "string" && message.length > 0 ? message : fallback;
}
