import { NextlyError } from "@nextlyhq/plugin-sdk";

/**
 * The codes the accounts plugin raises.
 *
 * Written once, here: {@link CODES} must give each one its status and public
 * message and may hold no other, so a code added or removed on one side alone
 * fails to compile.
 *
 * @experimental
 */
export type AccountsErrorCode =
  | "ACCOUNTS_INVALID_OPTIONS"
  | "ACCOUNTS_CORE_MISSING"
  | "ACCOUNTS_LIMITS_NOT_SHARED"
  | "ACCOUNTS_NOT_STARTED"
  | "ACCOUNTS_CROSS_SITE"
  | "ACCOUNTS_INVALID_INPUT"
  | "ACCOUNTS_WRONG_CREDENTIALS"
  | "ACCOUNTS_WAIT"
  | "ACCOUNTS_TOO_MANY_REQUESTS"
  | "ACCOUNTS_TRY_AGAIN"
  | "ACCOUNTS_DEACTIVATED"
  | "ACCOUNTS_UNVERIFIED"
  | "ACCOUNTS_LINK_REFUSED"
  | "ACCOUNTS_WRONG_CODE"
  | "ACCOUNTS_TOO_MANY_TRIES"
  | "ACCOUNTS_SIGN_IN_NEEDED"
  | "ACCOUNTS_SAME_ADDRESS"
  | "ACCOUNTS_ADDRESS_TAKEN"
  | "ACCOUNTS_NOT_FOUND"
  | "ACCOUNTS_NOT_APPLICABLE";

/**
 * Every code the accounts plugin raises, in its own namespace so a caller
 * branches on them without matching core's, with the status each answers
 * with and its public message. The message is fixed per code, so nothing a
 * caller sent is echoed back; the detail goes to `logContext`, which only
 * operators see.
 */
const CODES: Record<AccountsErrorCode, readonly [number, string]> = {
  // A site's own configuration, or the core it runs, is the server's fault,
  // never a visitor's: 500.
  /** A plugin option outside the bounds the plugin keeps it within. */
  ACCOUNTS_INVALID_OPTIONS: [
    500,
    "The accounts plugin is not configured correctly.",
  ],
  /** The running core does not lend the helpers the plugin is built on. */
  ACCOUNTS_CORE_MISSING: [
    500,
    "The accounts plugin cannot start on this version of Nextly.",
  ],
  /**
   * In production, the limiter's counts are kept by one instance alone and
   * the site has not said it runs only one. Raised only at start, so only
   * an operator reads it, and it names the fix.
   */
  ACCOUNTS_LIMITS_NOT_SHARED: [
    500,
    "The accounts plugin needs limit counts every instance shares: set rateLimit.store to a shared store, or rateLimit.singleInstance to true.",
  ],
  /** Work the plugin runs (a job) reached it before the plugin started. */
  ACCOUNTS_NOT_STARTED: [500, "The accounts plugin has not started."],

  /** A write from another site, or one without the plugin's CSRF token. */
  ACCOUNTS_CROSS_SITE: [403, "This request was refused."],
  /** A field the request needs is missing or not one (`data.reason` names the rule). */
  ACCOUNTS_INVALID_INPUT: [400, "Some of what was sent cannot be used."],
  /** The address or the password is wrong, or a refusal that must look like it. */
  ACCOUNTS_WRONG_CREDENTIALS: [
    401,
    "The email address or the password is wrong.",
  ],
  /** The address or the client is waiting; `data.retryAfterSeconds` says how long. */
  ACCOUNTS_WAIT: [429, "Too many attempts. Wait a little, then try again."],
  /** An email-sending limit is reached; `data.retryAfterSeconds` says until when. */
  ACCOUNTS_TOO_MANY_REQUESTS: [429, "Too many requests. Try again later."],
  /** The limit store did not answer, or the account changed meanwhile: nothing was done. */
  ACCOUNTS_TRY_AGAIN: [503, "Please try again."],
  /** Said only once the password is proven. */
  ACCOUNTS_DEACTIVATED: [403, "This account is closed. Contact us for help."],
  /** Said only once the password is proven, where the site requires a verified address. */
  ACCOUNTS_UNVERIFIED: [
    403,
    "Confirm your email address first. We can send the email again.",
  ],
  /** A link or a code that is not one, has run out, or was used (`data.reason`). */
  ACCOUNTS_LINK_REFUSED: [
    400,
    "This link or code can't be used. Ask for a new one.",
  ],
  /** A wrong code; `data.triesLeft` says how many remain. */
  ACCOUNTS_WRONG_CODE: [400, "That code is wrong."],
  /** Too many wrong codes for the address; `data.retryAfterSeconds` says until when. */
  ACCOUNTS_TOO_MANY_TRIES: [
    429,
    "Too many wrong codes. Use the link in the email, or try again later.",
  ],
  /** The action needs the visitor signed in, here. */
  ACCOUNTS_SIGN_IN_NEEDED: [401, "Sign in to continue."],
  /** A change of address to the address it already has. */
  ACCOUNTS_SAME_ADDRESS: [400, "That is already your email address."],
  /** A change of address to one another account has taken since it was asked for. */
  ACCOUNTS_ADDRESS_TAKEN: [
    409,
    "That email address can't be used. Try another.",
  ],

  // Staff, in the admin.
  /** Staff named an account that is not there. */
  ACCOUNTS_NOT_FOUND: [404, "No such account."],
  /** A staff action that does not apply to the account as it stands (`data.reason` says why). */
  ACCOUNTS_NOT_APPLICABLE: [
    409,
    "That can't be done to this account as it stands.",
  ],
};

/**
 * Raise an accounts error: its fixed status and public message, `publicData`
 * for what a caller may branch on (a reason, a wait in `retryAfterSeconds`,
 * which core also sends as `Retry-After`), and `logContext` for operators.
 *
 * @experimental
 */
export function accountsError(
  code: AccountsErrorCode,
  logContext?: Record<string, unknown>,
  publicData?: Record<string, unknown>
): NextlyError {
  const [statusCode, publicMessage] = CODES[code];

  return new NextlyError({
    code,
    publicMessage,
    statusCode,
    ...(publicData === undefined ? {} : { publicData }),
    logContext,
  });
}
