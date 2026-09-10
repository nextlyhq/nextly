/**
 * Whether the post-fetch ownership check applies to a caller.
 *
 * Two write paths ask this question — update and delete — and each used to
 * answer it inline. They agreed until one of them learned that a scoped API key
 * is not covered by the super-admin bypass and the other did not, at which point
 * a key owned by a super-admin could delete a row it does not own while the same
 * key could not update one. Two copies of a rule drift, and the drift is silent
 * because each copy reads correctly on its own.
 *
 * The check is a SAFETY NET rather than the primary guard: the fetch normally
 * carries an owner predicate in its WHERE clause, so a row the caller may not
 * touch never leaves the database. It is load-bearing anyway, because
 * `getOwnerConstraint` answers `null` from a broad catch — a metadata read that
 * fails leaves the predicate off the fetch and this check standing alone.
 *
 * @module domains/collections/services/owner-safety-net
 */

/** What decides whether the owner comparison runs. */
export interface OwnerSafetyNetInput {
  /** The stored rule for this operation is `owner-only`. */
  readonly ruleIsOwnerOnly: boolean;
  /** A caller to compare the row's owner against. */
  readonly hasUser: boolean;
  /** A trusted override, which bypasses stored rules on every transport. */
  readonly overrideAccess: boolean;
  /** The caller's OWNER is a super-admin. */
  readonly isSuperAdmin: boolean;
  /**
   * The caller's scope, as the request carries it.
   *
   * Taken whole rather than as a `isScopedApiKey` boolean the caller derives:
   * two call sites deriving one predicate is how this rule came to differ
   * between update and delete in the first place, and a boolean parameter puts
   * that derivation back at each site. What a scoped key IS gets decided here.
   */
  readonly scope: { readonly actorType?: string } | undefined;
}

/**
 * `true` when the row's owner must match the caller.
 *
 * A super-admin SESSION bypasses the check; a super-admin's scoped API KEY does
 * not, which mirrors both the SQL owner predicate and `checkCollectionAccess`.
 */
export function ownerSafetyNetApplies(input: OwnerSafetyNetInput): boolean {
  if (!input.ruleIsOwnerOnly || !input.hasUser) return false;
  if (input.overrideAccess) return false;
  // A key is judged on its own stamped grants, not its owner's, so it does not
  // inherit the owner's super-admin bypass. Without this, minting a read-only
  // key as a super-admin would hand it every bypass the owner holds.
  const isScopedApiKey = input.scope?.actorType === "apiKey";
  return !(input.isSuperAdmin && !isScopedApiKey);
}
