import type { AccountsSettings } from "../settings";

import type { LimitRule } from "./ports";

const DAY_MS = 24 * 60 * 60 * 1000;

/** The names of the limit rules the plugin declares. */
export const LIMIT_RULES = {
  /** Wrong verification codes per address, across every code sent to it. */
  codeTries: "verify-code-tries",
} as const;

/**
 * The limit rules the plugin declares, from the site's settings. Code tries
 * are a window over 24 hours on the normalised address, so a resent code,
 * with a fresh budget of its own, gives the address no tries back.
 */
export function accountsLimitRules(
  settings: Pick<AccountsSettings, "verification">
): Record<string, LimitRule> {
  return {
    [LIMIT_RULES.codeTries]: {
      type: "window",
      windows: [{ max: settings.verification.codeTries, perMs: DAY_MS }],
    },
  };
}
