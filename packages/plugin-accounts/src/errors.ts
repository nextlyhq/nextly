import { NextlyError } from "@nextlyhq/plugin-sdk";

/**
 * The codes the accounts plugin raises, each in the plugin's own namespace so
 * a caller can branch on them without matching core's codes.
 *
 * @experimental
 */
export type AccountsErrorCode =
  /** A plugin option outside the bounds the plugin keeps it within. */
  | "ACCOUNTS_INVALID_OPTIONS"
  /** The running core does not lend the helpers the plugin is built on. */
  | "ACCOUNTS_CORE_MISSING"
  /**
   * In production, the limiter's counts are kept by one instance alone and
   * the site has not said it runs only one.
   */
  | "ACCOUNTS_LIMITS_NOT_SHARED"
  /** Work the plugin runs (a job) reached it before the plugin started. */
  | "ACCOUNTS_NOT_STARTED";

/**
 * Raise an accounts error.
 *
 * The public message is generic and fixed per code, so nothing a caller passed
 * is echoed back to a client; the detail goes to `logContext`, which only
 * operators see.
 *
 * @experimental
 */
export function accountsError(
  code: AccountsErrorCode,
  logContext?: Record<string, unknown>
): NextlyError {
  return new NextlyError({
    code,
    publicMessage: PUBLIC_MESSAGES[code],
    statusCode: STATUS_CODES[code],
    logContext,
  });
}

const PUBLIC_MESSAGES: Record<AccountsErrorCode, string> = {
  ACCOUNTS_INVALID_OPTIONS: "The accounts plugin is not configured correctly.",
  ACCOUNTS_CORE_MISSING:
    "The accounts plugin cannot start on this version of Nextly.",
  ACCOUNTS_LIMITS_NOT_SHARED:
    "The accounts plugin is not configured correctly.",
  ACCOUNTS_NOT_STARTED: "The accounts plugin has not started.",
};

// A site's own configuration, or the core it runs, is the server's fault,
// never a visitor's: 500.
const STATUS_CODES: Record<AccountsErrorCode, number> = {
  ACCOUNTS_INVALID_OPTIONS: 500,
  ACCOUNTS_CORE_MISSING: 500,
  ACCOUNTS_LIMITS_NOT_SHARED: 500,
  ACCOUNTS_NOT_STARTED: 500,
};
