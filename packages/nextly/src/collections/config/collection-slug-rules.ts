/**
 * The rules a COLLECTION slug must satisfy, in one place both askers share.
 *
 * Two callers need them and they must not each carry a copy. `validate-config`
 * enforces them on a config being validated. `auth/new-entity-access-policy`
 * asks the mirror question about a slug nobody has created yet -- could this
 * caller create a collection under the name their permission grant refers to --
 * to decide whether the dashboard's "create your first collection" step is
 * finishable for them at all.
 *
 * Restated in the second, the two drift in the direction that is hardest to
 * see: the checklist would go on offering a step whose creation the validator
 * refuses, and the reader would follow it to a form that will not accept the
 * only name their grant can read.
 *
 * @module collections/config/collection-slug-rules
 */

import {
  NEWLY_RESERVED_SLUG_NOTES,
  SYSTEM_RESOURCES,
} from "../../schemas/_zod/rbac";
import {
  type BaseValidationError,
  DEFAULT_SQL_KEYWORDS_SET,
  type SlugValidationContext,
  validateSlugShared,
} from "../../shared/base-validator";
import { RESERVED_SLUGS } from "../../shared/sql-reserved";

// System-resource names are added on top of the base reserved slugs. A
// collection named after a system resource would seed the same permission rows
// that resource's routes check (a `settings` collection reaches the user-fields
// and component admin surfaces, a `media` collection the media routes), so it is
// rejected here — at config validation, before any migration or table is built.
// The names are NOT in the shared base list, because that list also feeds the
// component validator and a component does not seed a permission under its slug.
const RESERVED_SLUGS_SET: Set<string> = new Set<string>([
  ...RESERVED_SLUGS,
  ...SYSTEM_RESOURCES,
]);

/** The slug rules, as {@link validateSlugShared} reads them. */
export const COLLECTION_SLUG_RULES: SlugValidationContext = {
  entityLabel: "Collection",
  reservedSlugsSet: RESERVED_SLUGS_SET,
  reservedSlugNotes: NEWLY_RESERVED_SLUG_NOTES,
  sqlKeywordsSet: DEFAULT_SQL_KEYWORDS_SET,
};

/**
 * Whether a collection could be created under this name.
 *
 * The same verdict `validateCollectionConfig` reaches about a config's slug,
 * reduced to a yes or a no, because the caller that asks this one is not
 * reporting errors to anybody -- it is deciding whether a name is reachable at
 * all. Running the shared validator rather than testing the reserved set
 * directly keeps every rule in the answer: format, length, the `_locales`
 * suffix and the SQL keywords are reasons a name is unavailable exactly as
 * being reserved is.
 *
 * Says nothing about whether the name is TAKEN. That is a question about the
 * live registry rather than about the rules, and the two callers answer it
 * differently -- the validator is handed the existing slugs, and the checklist
 * does not need to ask, for the reason `wouldReadOwnNewCollection` gives.
 */
export function isCreatableCollectionSlug(slug: string): boolean {
  const errors: BaseValidationError[] = [];
  validateSlugShared(slug, errors, COLLECTION_SLUG_RULES);
  return errors.length === 0;
}
