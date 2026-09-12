/**
 * Which grant authorizes a collection DEFINITION change, declared once.
 *
 * Creating, renaming or dropping a collection is DDL, and it is authorized
 * differently from writing a row in one: an editor holding `update-posts` may
 * not redefine `posts`, and a caller holding this grant may have no access to
 * any collection's rows.
 *
 * 🔴 Three places need the answer and they must not each carry it. Two are the
 * routes that ENFORCE it -- the standalone schema endpoint and the dispatcher's
 * definition-mutation branch -- and the third is the dashboard's onboarding
 * checklist, which asks whether to OFFER the reader a "create your first
 * collection" step at all. Restated in the third, the checklist would go on
 * asking for a grant the routes had stopped requiring, and the failure is
 * silent in both directions: a step offered whose endpoint refuses it, or a
 * step hidden from someone allowed to take it.
 *
 * Split into its parts as well as the slug because the two consumers spell the
 * same fact differently: `requirePermission`/`requireRoutePermission` take an
 * action and a resource, while a permission-table lookup wants the joined
 * `{action}-{resource}`. Deriving the slug here keeps the join from being a
 * fourth place the policy is written.
 *
 * @module auth/collection-definition-policy
 */

/** The action half, as the route guards spell it. */
export const COLLECTION_DEFINITION_ACTION = "manage";

/** The resource half, as the route guards spell it. */
export const COLLECTION_DEFINITION_RESOURCE = "settings";

/**
 * The same policy as a permission slug, for a caller that looks one up rather
 * than guarding a route with it.
 */
export const COLLECTION_DEFINITION_PERMISSION =
  `${COLLECTION_DEFINITION_ACTION}-${COLLECTION_DEFINITION_RESOURCE}` as const;
