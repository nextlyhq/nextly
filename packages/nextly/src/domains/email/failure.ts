/**
 * Whether a failed send is worth trying again.
 *
 * A provider adapter is the only code that knows what its provider's answers
 * mean, so it classifies its own failures; the email service decides what to do
 * with the classification and reports it to the caller. A failure nobody
 * classified counts as retryable: a permanent failure retried costs a few
 * calls, while a temporary one dropped loses the email.
 *
 * @module domains/email/failure
 */

/**
 * @experimental What a caller is told about a failed send, or a refused
 * recipient: whether a retry can help, the provider's status where it gave
 * one, and a short reason that carries no configuration, secret or address.
 */
export interface EmailFailure {
  /** Whether sending again later can succeed. */
  retryable: boolean;
  /** The provider's status: an HTTP status, or an SMTP reply code. */
  status?: number;
  /** A short sentence saying what went wrong, for a log or a person. */
  reason: string;
}

/**
 * @experimental An error a provider adapter throws to classify its failure.
 *
 * Structural, so a provider plugin needs nothing imported to use it: any thrown
 * value with an `emailFailure` of this shape is read as classified.
 */
export interface ClassifiedEmailError extends Error {
  emailFailure: EmailFailure;
}

/** The longest reason kept from an adapter; a longer one is not a sentence. */
const MAX_REASON_LENGTH = 200;

/** The reason given for a failure nobody classified. */
export const UNCLASSIFIED_REASON = "The email provider failed.";

/**
 * `error` carrying `failure`, for an adapter to throw.
 *
 * The error itself is returned, so its message, stack and cause stay as they
 * were and every reader of those keeps reading the same text.
 */
export function withEmailFailure<E extends Error>(
  error: E,
  failure: EmailFailure
): E & ClassifiedEmailError {
  return Object.assign(error, { emailFailure: failure });
}

/**
 * The classification a thrown value carries, if it carries a usable one.
 *
 * Read defensively, because a provider plugin is plain JavaScript at runtime:
 * `retryable` must be a boolean, a status a whole number, and the reason a
 * non-empty string of sentence length. Anything else is unclassified.
 */
export function failureOf(error: unknown): EmailFailure | undefined {
  if (error === null || typeof error !== "object") return undefined;
  const candidate = (error as { emailFailure?: unknown }).emailFailure;
  if (candidate === null || typeof candidate !== "object") return undefined;
  const { retryable, status, reason } = candidate as Record<string, unknown>;
  if (typeof retryable !== "boolean") return undefined;
  const usableReason =
    typeof reason === "string" &&
    reason.trim() !== "" &&
    reason.length <= MAX_REASON_LENGTH
      ? reason.trim()
      : undefined;
  return {
    retryable,
    ...(typeof status === "number" && Number.isInteger(status)
      ? { status }
      : {}),
    reason: usableReason ?? describeClass(retryable, status),
  };
}

/** A sentence for a classified failure that came without a usable reason. */
function describeClass(retryable: boolean, status: unknown): string {
  const suffix =
    typeof status === "number" && Number.isInteger(status)
      ? ` (status ${status})`
      : "";
  return retryable
    ? `The email provider could not take the message right now${suffix}.`
    : `The email provider refused the message${suffix}.`;
}

/** A failure nobody classified: retryable, as a lost email is the worse loss. */
export function unclassifiedFailure(): EmailFailure {
  return { retryable: true, reason: UNCLASSIFIED_REASON };
}

/** The provider could not be reached, or did not answer: worth trying again. */
export function networkFailure(): EmailFailure {
  return {
    retryable: true,
    reason: "The email provider could not be reached.",
  };
}

/**
 * Classify an HTTP provider's answer.
 *
 * A refusal of the message itself, a 4xx other than 408 and 429, is not
 * retryable; a timeout (408), a rate limit (429) or a server error (5xx) is.
 * Where the provider names a reason, the reason decides, through `byName`.
 */
export function httpFailure(
  status: number,
  name?: string,
  byName: Readonly<Record<string, boolean>> = {}
): EmailFailure {
  const named = name !== undefined ? byName[name] : undefined;
  const retryable =
    named ?? (status === 408 || status === 429 || status >= 500);
  return { retryable, status, reason: describeClass(retryable, status) };
}

/**
 * Classify an SMTP reply code: a 4xx reply is temporary and retryable, a 5xx
 * reply is a refusal and is not. Any other code is read as unclassified.
 */
export function smtpFailure(code: number): EmailFailure {
  if (code >= 400 && code < 500) {
    return { retryable: true, status: code, reason: describeClass(true, code) };
  }
  if (code >= 500 && code < 600) {
    return {
      retryable: false,
      status: code,
      reason: describeClass(false, code),
    };
  }
  return unclassifiedFailure();
}
