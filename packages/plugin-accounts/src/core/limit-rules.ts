import type { AccountsSettings } from "../settings";

import type { LimitRule } from "./ports";

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/** The names of the limit rules the plugin declares. */
export const LIMIT_RULES = {
  /** Wrong verification codes per address, across every code sent to it. */
  codeTries: "verify-code-tries",
  /** Sign-ups per address. */
  signUpAddress: "sign-up-address",
  /** Verification resends per address. */
  resendAddress: "resend-address",
  /** Verification resends per known-browser token a request carries. */
  resendToken: "resend-token",
  /** Reset requests per address. */
  resetAddress: "reset-address",
  /** Reset requests per known-browser token a request carries. */
  resetToken: "reset-token",
  /** Address changes asked for per account. */
  addressChangeAccount: "address-change-account",
  /** Address changes asked for per new address. */
  addressChangeNew: "address-change-new",
  /** Requests that send an email, of every kind together, per client. */
  emailClient: "email-client",
  /** Failed sign-ins per address. */
  signInAddress: "sign-in-address",
  /** Failed or refused sign-ins per client. */
  signInClient: "sign-in-client",
  /** Breached-password lookups for a new password per account, in a reset or a change. */
  newPasswordAccount: "new-password-account",
} as const;

/** The waits after the free attempts: 1, 2, 4, 8, 16 and 32 seconds, then 60 every time. */
const SIGN_IN_WAITS_MS = [1, 2, 4, 8, 16, 32, 60].map(
  seconds => seconds * 1000
);

/**
 * Per address, for each kind of request that sends an email: 3 in 15
 * minutes and 10 a day. Fixed: no setting changes it.
 */
const PER_ADDRESS: LimitRule = {
  type: "window",
  windows: [
    { max: 3, perMs: 15 * MINUTE_MS },
    { max: 10, perMs: DAY_MS },
  ],
};

/**
 * Per client, every request that sends an email counted together: 20 in 15
 * minutes and 100 a day. Fixed.
 */
const PER_CLIENT: LimitRule = {
  type: "window",
  windows: [
    { max: 20, perMs: 15 * MINUTE_MS },
    { max: 100, perMs: DAY_MS },
  ],
};

/**
 * The limit rules the plugin declares, from the site's settings. Code tries
 * are a window over 24 hours on the normalised address, so a resent code,
 * with a fresh budget of its own, gives the address no tries back. The
 * email limits are the plugin's own numbers.
 */
export function accountsLimitRules(
  settings: Pick<AccountsSettings, "verification">
): Record<string, LimitRule> {
  return {
    [LIMIT_RULES.codeTries]: {
      type: "window",
      windows: [{ max: settings.verification.codeTries, perMs: DAY_MS }],
    },
    [LIMIT_RULES.signUpAddress]: PER_ADDRESS,
    [LIMIT_RULES.resendAddress]: PER_ADDRESS,
    // A known browser's own requests stop at the address's numbers, from
    // any number of clients.
    [LIMIT_RULES.resendToken]: PER_ADDRESS,
    [LIMIT_RULES.resetAddress]: PER_ADDRESS,
    [LIMIT_RULES.resetToken]: PER_ADDRESS,
    // Address changes: 3 an hour and 10 a day per account, 3 a day per new
    // address, so nobody can use the site to mail strangers.
    [LIMIT_RULES.addressChangeAccount]: {
      type: "window",
      windows: [
        { max: 3, perMs: 60 * MINUTE_MS },
        { max: 10, perMs: DAY_MS },
      ],
    },
    [LIMIT_RULES.addressChangeNew]: {
      type: "window",
      windows: [{ max: 3, perMs: DAY_MS }],
    },
    [LIMIT_RULES.emailClient]: PER_CLIENT,
    // 5 failures in a row for an address run free, then the waits, until a
    // sign-in succeeds, a reset completes, or 24 hours pass without one.
    [LIMIT_RULES.signInAddress]: {
      type: "backoff",
      free: 5,
      waitsMs: SIGN_IN_WAITS_MS,
      forgetAfterMs: DAY_MS,
    },
    // A client's 20th failed or refused sign-in starts the same waits, until
    // 15 minutes pass without either from it.
    [LIMIT_RULES.signInClient]: {
      type: "backoff",
      free: 20,
      waitsMs: SIGN_IN_WAITS_MS,
      forgetAfterMs: 15 * MINUTE_MS,
    },
    // A new password asked of the breached-password source: 10 in 15
    // minutes and 30 a day per account, so one reset link or one session
    // never makes the site ask the source without limit.
    [LIMIT_RULES.newPasswordAccount]: {
      type: "window",
      windows: [
        { max: 10, perMs: 15 * MINUTE_MS },
        { max: 30, perMs: DAY_MS },
      ],
    },
  };
}
