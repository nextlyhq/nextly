/**
 * What a person setting up an email provider should check, when a check or a
 * test send fails.
 *
 * Kept apart from `EmailFailure` on purpose. A send's result says whether a
 * retry can help, and every existing caller reads exactly that; the setup
 * category is for the person at the provider setup, so only the check and the
 * test send read it. An adapter attaches it to the error it throws, beside its
 * `emailFailure`, and nothing on the ordinary send path passes it on.
 *
 * @module domains/email/setup-category
 */

import { UNREACHABLE_REASON, failureOf } from "./failure";

/**
 * @experimental What to check:
 *
 * - `credentials`: the provider refused the key, token or password.
 * - `sender`: the From address or its domain is not allowed to send.
 * - `recipient`: the provider refused the address the email was sent to.
 * - `rate-limited`: the provider is limiting how much is sent; try later.
 * - `connect`: the provider could not be reached at all.
 * - `other`: anything else.
 */
export type EmailSetupCategory =
  | "credentials"
  | "sender"
  | "recipient"
  | "rate-limited"
  | "connect"
  | "other";

const CATEGORIES: ReadonlySet<string> = new Set<EmailSetupCategory>([
  "credentials",
  "sender",
  "recipient",
  "rate-limited",
  "connect",
  "other",
]);

/** Whether a value is one of the setup categories. */
export function isEmailSetupCategory(
  value: unknown
): value is EmailSetupCategory {
  return typeof value === "string" && CATEGORIES.has(value);
}

/**
 * `error` carrying its setup category, for an adapter to throw.
 *
 * The error itself is returned, as `withEmailFailure` returns it, so its
 * message, stack, cause and classification stay as they were.
 */
export function withSetupCategory<E extends Error>(
  error: E,
  setup: EmailSetupCategory
): E & { emailSetup: EmailSetupCategory } {
  return Object.assign(error, { emailSetup: setup });
}

/**
 * The setup category a status alone says, for a failure whose adapter gave
 * none. Only answers that mean one thing whatever the provider are read: an
 * HTTP 401 or an SMTP authentication refusal is the credentials, and a 429 is
 * a rate limit.
 */
export function setupFromStatus(
  status: number | undefined
): EmailSetupCategory {
  if (status === 401 || status === 530 || status === 534 || status === 535) {
    return "credentials";
  }
  if (status === 429) return "rate-limited";
  return "other";
}

/**
 * The setup category of a thrown value: the one its adapter attached, else
 * what its classification says. A provider that never answered could not be
 * reached; a failure nobody classified is `other`.
 */
export function setupCategoryOf(error: unknown): EmailSetupCategory {
  if (error !== null && typeof error === "object") {
    const attached = (error as { emailSetup?: unknown }).emailSetup;
    if (isEmailSetupCategory(attached)) return attached;
  }
  const failure = failureOf(error);
  if (!failure) return "other";
  if (failure.status === undefined) {
    // `networkFailure` is retryable with no status, and so is an unclassified
    // failure; only the sentence tells them apart.
    return failure.reason === UNREACHABLE_REASON ? "connect" : "other";
  }
  return setupFromStatus(failure.status);
}
