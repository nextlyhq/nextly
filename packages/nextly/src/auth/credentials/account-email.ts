/**
 * How an account's email address is spelled for lookup.
 *
 * One function, because two places ask it: the account lookup, and the auth
 * limiter that counts a sign-in against the account it names. Were they to
 * spell an address differently, `Ann@Example.com ` and `ann@example.com`
 * would find one account and still buy two budgets.
 *
 * @module auth/credentials/account-email
 */

/** `email` as the account lookup matches it: trimmed and lower-cased. */
export function normalizeAccountEmail(email: string): string {
  return email.trim().toLowerCase();
}
