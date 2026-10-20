/**
 * The indexes a password-reset and an email-verification token table carry,
 * on every dialect.
 *
 * Built from the dialect's own `index` and `uniqueIndex`, which the dialect's
 * schema passes in, so the three dialects declare the same indexes under the
 * same names from one definition.
 *
 * @module schemas/auth-tokens/account-token-indexes
 */

/** What a dialect's `index(name)` and `uniqueIndex(name)` hand back. */
interface IndexOn<C, I> {
  on(...columns: [C, ...C[]]): I;
}

/** Build the shared indexes, named with the table's prefix. */
export function accountTokenIndexes<C, I>(
  builders: {
    index: (name: string) => IndexOn<C, I>;
    uniqueIndex: (name: string) => IndexOn<C, I>;
  },
  prefix: "prt" | "evt",
  t: Record<"identifier" | "tokenHash" | "userId" | "expires", C>
): I[] {
  return [
    builders
      .uniqueIndex(`${prefix}_identifier_token_hash_unique`)
      .on(t.identifier, t.tokenHash),
    // Revoking an account's tokens, and the cascade from `users`, find them
    // by account.
    builders.index(`${prefix}_user_id_idx`).on(t.userId),
    builders.index(`${prefix}_expires_idx`).on(t.expires),
    // Tokens are looked up by their hash alone. The unique index above leads
    // with the identifier, so it cannot serve that lookup.
    builders.index(`${prefix}_token_hash_idx`).on(t.tokenHash),
  ];
}
