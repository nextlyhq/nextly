/**
 * Whether a collection could be created under a given name at RUNTIME.
 *
 * 🔴 Not the same question as `collections/config/validate-config`, and the
 * difference is why this exists. That validator judges a CONFIG FILE, and its
 * `RESERVED_SLUGS` list reserves names like `admin` and `dashboard` because a
 * code-first collection is mounted on a route. Nothing on the runtime create
 * path consults it, so a name it refuses may still be creatable through the
 * Schema Builder -- and a predicate built on it withholds work a caller can
 * actually do.
 *
 * Two callers need this answer. The schema endpoint ENFORCES it on the way in.
 * The dashboard's onboarding checklist asks it about a name nobody has created
 * yet, to decide whether an API key's `read-<slug>` grant names a collection
 * that key could go on to create -- which is what makes the "create your first
 * collection" step finishable for it at all.
 *
 * ## Why these rules and not more
 *
 * The runtime create paths do not all refuse the same names. The system-resource
 * reservation is the one that holds on every one of them:
 * `assertGlobalResourceSlugAvailable` applies it on create and on rename, to
 * collections and singles alike, because permission identity is
 * `action-resource` and a collection named `settings` would seed the very rows
 * the settings routes check. The Schema Builder's own
 * `RESERVED_COLLECTION_NAMES` refuses a few more, and the code-first list more
 * again, but neither is applied by every path.
 *
 * So this answers "could this name be created on ANY path", not "on all of
 * them". For the checklist that is the direction that matters: a step is
 * withheld only where NOTHING the caller can reach would create the name, and a
 * name one path allows leaves the step genuinely finishable. Guessing stricter
 * hides work a caller can do, which is the defect this predicate exists to
 * prevent rather than a safe default.
 *
 * Says nothing about whether the name is TAKEN -- that is a question about the
 * live registry rather than about the rules, and `wouldReadOwnNewCollection`
 * explains why its caller does not need to ask.
 *
 * @module domains/collections/creatable-slug
 */

import { isReservedResourceSlug } from "../../schemas/_zod/rbac";

/**
 * The slug shape a runtime create accepts.
 *
 * Underscores but NO hyphens, which is narrower than a code-first slug and is
 * the rule the schema endpoint and the Schema Builder already share.
 */
export const CREATABLE_SLUG_PATTERN = /^[a-z][a-z0-9_]*$/;

/** The longest slug a runtime create accepts. */
export const CREATABLE_SLUG_MAX_LENGTH = 255;

/** Whether a collection could be created under `slug` on some runtime path. */
export function isCreatableCollectionSlug(slug: string): boolean {
  return (
    slug.length >= 1 &&
    slug.length <= CREATABLE_SLUG_MAX_LENGTH &&
    CREATABLE_SLUG_PATTERN.test(slug) &&
    !isReservedResourceSlug(slug)
  );
}
