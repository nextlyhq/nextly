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
  /**
   * @experimental Whether the email was delivered cannot be known: the request
   * may have reached the provider, but no definite answer came back. Absent
   * otherwise, a provider that could not be reached at all included.
   */
  unknown?: true;
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

/** The reason given for a failure nobody classified. */
export const UNCLASSIFIED_REASON = "The email provider failed.";

/** The reason given when the provider could not be reached. */
export const UNREACHABLE_REASON = "The email provider could not be reached.";

/** The reason given when a request was sent and its answer was lost. */
const LOST_ANSWER_REASON = "The email provider's answer was lost.";

/** The reason given when a call has not answered by its deadline. */
const NO_ANSWER_REASON = "The email provider did not answer in time.";

/**
 * Whether `reason` is core's own sentence for this classification.
 *
 * A reason reaches the caller, and through the REST routes whoever called
 * them. Text an adapter wrote can hold anything its configuration holds, an
 * endpoint or an account as much as a credential, and no scrubbing can know
 * what all of that is. So only core's sentences are passed on, and only the
 * one that says what `retryable` and `status` say: a refusal described as
 * unreachable, or a sentence naming another status, would contradict the
 * fields beside it. Any other reason is replaced by the sentence the
 * classification gives, and the adapter's own text stays in the log, where
 * the failure is recorded with it.
 */
function isCoreReason(
  reason: string,
  retryable: boolean,
  status: number | undefined,
  unknown: boolean
): boolean {
  if (reason === describeClass(retryable, status)) return true;
  if (!retryable || status !== undefined) return false;
  return unknown
    ? reason === LOST_ANSWER_REASON || reason === NO_ANSWER_REASON
    : reason === UNCLASSIFIED_REASON || reason === UNREACHABLE_REASON;
}

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
  const { retryable, status, reason, unknown } = candidate as Record<
    string,
    unknown
  >;
  if (typeof retryable !== "boolean") return undefined;
  const usableStatus = isProviderStatus(status) ? status : undefined;
  // Unknown only for a retryable failure with no status: an answer with a
  // status is a definite one.
  const isUnknown = unknown === true && retryable && usableStatus === undefined;
  const usableReason =
    typeof reason === "string" &&
    isCoreReason(reason, retryable, usableStatus, isUnknown)
      ? reason
      : undefined;
  return {
    retryable,
    ...(usableStatus !== undefined ? { status: usableStatus } : {}),
    reason:
      usableReason ??
      (isUnknown ? LOST_ANSWER_REASON : describeClass(retryable, usableStatus)),
    ...(isUnknown ? { unknown: true as const } : {}),
  };
}

/**
 * Whether a value can be a provider's status: a whole number in the range of
 * HTTP statuses and SMTP reply codes, 100 to 599. Anything else is not
 * reported, so a number that is not a status never reaches the caller.
 */
function isProviderStatus(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 100 &&
    value <= 599
  );
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

/** The provider could not be reached: nothing was sent, and a retry may be. */
export function networkFailure(): EmailFailure {
  return { retryable: true, reason: UNREACHABLE_REASON };
}

/**
 * A request that may have reached the provider, whose answer was lost: a
 * connection reset or a timeout after it was sent. Retryable, and unknown.
 */
export function lostAnswerFailure(): EmailFailure {
  return { retryable: true, reason: LOST_ANSWER_REASON, unknown: true };
}

/** A call that had not answered by its deadline: retryable, and unknown. */
export function noAnswerFailure(): EmailFailure {
  return { retryable: true, reason: NO_ANSWER_REASON, unknown: true };
}

/**
 * The codes a failed `fetch` carries, on its cause, when the request may
 * already have been sent: the connection was reset or closed mid-request, or
 * the answer did not arrive in time. A connection that never opened (refused,
 * a name that did not resolve) carries none of these.
 */
const LOST_ANSWER_CODES = new Set([
  "ECONNRESET",
  "EPIPE",
  "UND_ERR_SOCKET",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
]);

/**
 * What a `fetch` that threw before an answer says about the send: unknown
 * when the request may have been sent (its cause's code, or the call's own
 * cancellation at its deadline), else a provider that could not be reached.
 */
export function fetchFailure(error: unknown): EmailFailure {
  return answerLost(error) ? lostAnswerFailure() : networkFailure();
}

/**
 * Whether `error` is a request stopped or cut off after it may have been
 * sent: the call's own cancellation, a timeout, or a connection lost
 * mid-request. Before an answer, or while its body is still arriving.
 */
function answerLost(error: unknown): boolean {
  const name = (error as { name?: unknown } | null)?.name;
  if (name === "AbortError" || name === "TimeoutError") return true;
  const code = (error as { cause?: { code?: unknown } } | null)?.cause?.code;
  return typeof code === "string" && LOST_ANSWER_CODES.has(code);
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

/**
 * The error an HTTP provider adapter rethrows: `prefix` and the original
 * message (`fallback` when what was thrown was not an error), carrying the
 * original's classification, or, when it had none, a network failure if the
 * provider never answered and an unclassified one if it did.
 *
 * A request cancelled or cut off while its answer's body was still arriving
 * is unknown, as one cut off before the answer is: the provider may have
 * accepted it, and a retry through a provider without keys would send it again.
 */
export function providerFailure(
  text: { prefix: string; fallback: string },
  error: unknown,
  answered: boolean
): ClassifiedEmailError {
  const message = error instanceof Error ? error.message : text.fallback;
  const prefix = text.prefix;
  return withEmailFailure(
    new Error(`${prefix}: ${message}`),
    failureOf(error) ??
      (answered && !answerLost(error)
        ? unclassifiedFailure()
        : fetchFailure(error))
  );
}
