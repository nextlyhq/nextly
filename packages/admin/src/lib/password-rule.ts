/**
 * The account password rule the admin's forms check before they submit, as
 * the server publishes it on `/auth/setup-status`: the minimum length, and the
 * byte limit of the app's password hasher, or `null` where it sets none a
 * browser can check. Until the server has said, core's defaults apply.
 *
 * Its own module, without the common-password list, because setup-status is
 * read on every page and the list is fetched only by forms that set a
 * password.
 *
 * @module lib/password-rule
 */

/** What the server publishes. */
export interface PasswordRule {
  minLength: number;
  maxBytes: number | null;
}

/** Core's defaults: 8 characters, and bcrypt's 72 bytes. */
const DEFAULT_RULE: PasswordRule = { minLength: 8, maxBytes: 72 };

let activeRule: PasswordRule = DEFAULT_RULE;

/** The rule the forms check now. */
export function currentPasswordRule(): PasswordRule {
  return activeRule;
}

/** Take the rule the server published. */
export function setPasswordRule(rule: PasswordRule): void {
  activeRule = rule;
}

/** Back to core's defaults, for tests. */
export function resetPasswordRule(): void {
  activeRule = DEFAULT_RULE;
}

/**
 * The rule in a setup-status answer, or `null` for an answer without a usable
 * one (an older server, or a malformed value), which leaves the rule as it is.
 */
export function parsePasswordRule(value: unknown): PasswordRule | null {
  if (typeof value !== "object" || value === null) return null;
  const { minLength, maxBytes } = value as Record<string, unknown>;
  const positive = (n: unknown): n is number =>
    typeof n === "number" && Number.isSafeInteger(n) && n > 0;
  if (!positive(minLength)) return null;
  if (maxBytes !== null && !positive(maxBytes)) return null;
  return { minLength, maxBytes };
}
