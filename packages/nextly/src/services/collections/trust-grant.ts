/**
 * What a trusted read may reach.
 *
 * `overrideAccess` says the CALLER is trusted. It says nothing about the
 * collections a relationship happens to point at — those were never named by
 * the caller, they were reached through a field — so a trusted read spreads its
 * trust into every target it populates, along with a lifecycle widened to
 * include drafts. The bound is what answers the second question.
 *
 * A leaf module on purpose: both the context that carries a bound and the
 * service that acts on one need this vocabulary, and giving it to either of
 * them would make the other import back. There are already 45 import cycles in
 * this package and no reason to add the 46th for two declarations.
 *
 * @module services/collections/trust-grant
 */

/**
 * The bound a read declares when its bypass reaches every collection.
 *
 * Named rather than left as an absence, which is the whole point. Before this,
 * a read that had thought about its bound and a read whose author never
 * considered the question produced the SAME value — nothing — so the safe path
 * and the easy path differed and the easy one was silent. Now an audit greps
 * one symbol to find every unbounded read, and each hit is a decision someone
 * recorded rather than a field they omitted.
 *
 * A bare `"all"` would be shorter and would read as nothing. That is the
 * property to avoid: this is the path of least resistance for a caller that
 * cannot immediately work out its bound, so it should cost a sentence.
 */
export const TRUSTS_EVERY_COLLECTION = "trusts-every-collection" as const;

/**
 * Which collections a trusted read may reach, judged per expansion TARGET.
 *
 * A predicate rather than a list because the question is asked once per target
 * at several points in a single expansion, and membership is more often derived
 * than enumerated. `TRUSTS_EVERY_COLLECTION` is the other half of the type
 * rather than a predicate that returns `true`, so that "reads everything" stays
 * greppable instead of hiding inside an arrow function.
 *
 * This can only ever NARROW. It is read as `overrideAccess && bound(target)`,
 * so supplying a predicate removes trust the caller already held and can never
 * grant trust it did not — the same shape as passing `overrideAccess: false`.
 */
export type TrustBound =
  | ((collection: string) => boolean)
  | typeof TRUSTS_EVERY_COLLECTION;

/**
 * Whether a bound reaches one target collection.
 *
 * The single place the constant is compared, so a caller that adds a bound
 * cannot forget that the escape hatch is not callable.
 */
export function boundReaches(bound: TrustBound, collection: string): boolean {
  return bound === TRUSTS_EVERY_COLLECTION || bound(collection);
}

/**
 * Whether a bound actually NARROWS the bypass it accompanies.
 *
 * Distinct from "a bound is present", and the distinction is the whole reason
 * this exists. Two values mean *reaches everything* — an absent bound, and
 * {@link TRUSTS_EVERY_COLLECTION} — and only the second is a value. Deriving
 * narrowing from presence therefore makes the constant behave differently from
 * the absence it was introduced to replace, which is the one thing it must
 * never do.
 *
 * The difference is observable rather than theoretical. `expansionStatusScope`
 * withholds a widened lifecycle from a narrowed caller, so a read stating
 * `TRUSTS_EVERY_COLLECTION` would stop inheriting `status: "all"` into its
 * expansions while the identical read omitting the bound kept it — the same
 * caller, the same intent, different rows.
 *
 * Asked here rather than at each site because the answer is needed at eleven of
 * them across four services, and a copy of it drifts silently: two call sites
 * would then disagree about which reads see unpublished rows.
 */
export function narrows(bound: TrustBound | undefined): boolean {
  return bound !== undefined && bound !== TRUSTS_EVERY_COLLECTION;
}

/**
 * The bound to run an expansion under when the caller named none.
 *
 * Absence is a real state at the options layer and cannot be legislated away
 * there: `trusted` is optional on the Direct API, and a caller that omits it
 * has said only that it did not think about relationship targets. The context
 * layer is where that has to become a decision, because that is where the
 * expansion actually happens — and the decision preserved here is the one this
 * package has always taken, that an unbounded trusted read reaches everything.
 *
 * Named, and used at every options-to-context boundary, so the question "which
 * reads are unbounded because nobody chose?" has ONE grep and one answer rather
 * than an `??` repeated at eight call sites with eight comments that can drift.
 * The word is `assumed` on purpose: this is not a bound the caller declared, it
 * is one inferred from silence, and a future change that wants to narrow the
 * default has exactly one place to do it.
 */
export function assumedBound(bound: TrustBound | undefined): TrustBound {
  return bound ?? TRUSTS_EVERY_COLLECTION;
}
