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
  /** Requests that send an email, of every kind together, per client. */
  emailClient: "email-client",
} as const;

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
    [LIMIT_RULES.emailClient]: PER_CLIENT,
  };
}
