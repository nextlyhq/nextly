/**
 * Whether a collection could be created under a given name, judged by the
 * validator the CREATE the reader is sent to actually runs.
 *
 * 🔴 Three validators in this codebase answer something like this question and
 * they refuse different names. Which one is correct here is not a matter of
 * taste: the dashboard's onboarding checklist links its "create a collection"
 * step to the Schema Builder (`BUILDER_COLLECTIONS_NEW`), whose create posts to
 * `POST /collections` -- the `collectionsHandler` path, which validates the name
 * inside `generateCollection` with `collectionNameSchema`. So that schema's
 * verdict IS whether the step can be finished, and anything else is a guess
 * about a surface the reader will never reach.
 *
 * The two wrong answers, recorded because each was shipped:
 *
 * - `collections/config/validate-config` judges a CONFIG FILE. Its
 *   `RESERVED_SLUGS` reserves `admin` and `dashboard` because a code-first
 *   collection is mounted on a route, and it allows hyphens. Nothing on this
 *   create path consults it, so it withheld the step for `read-admin` -- which
 *   the Builder creates happily -- and offered it for `read-team-updates`, which
 *   no runtime slug may even be spelled as.
 * - The `/collections-schema` endpoint's own rules are a third set (255
 *   characters, no curated list, no SQL-keyword check). It is a different
 *   surface with a different door, and borrowing its limits admitted
 *   `read-select` for a name `collectionNameSchema` refuses as a SQL keyword,
 *   and slugs past the Builder's 50-character cap.
 *
 * So this asks `collectionNameSchema` rather than restating any of it. A rule
 * added there -- another reserved name, a different length -- reaches the
 * checklist with nobody editing this file, which is the only arrangement that
 * cannot drift.
 *
 * Says nothing about whether the name is TAKEN. That is a question about the
 * live registry rather than about the rules, and `wouldReadOwnNewCollection`
 * explains why its caller does not need to ask.
 *
 * @module domains/collections/creatable-slug
 */

import { collectionNameSchema } from "../dynamic-collections/services/dynamic-collection-validation-service";

/** Whether the Schema Builder would let a collection be created under `slug`. */
export function isCreatableCollectionSlug(slug: string): boolean {
  return collectionNameSchema.safeParse(slug).success;
}
