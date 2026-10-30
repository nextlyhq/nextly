/**
 * Whether a collection could be created under a given name, judged by the
 * validator the create this answer leads to actually runs.
 *
 * The dashboard's onboarding checklist links its "create a collection" step to
 * the Schema Builder, whose create validates the name with
 * `collectionNameSchema`. That schema is the one address rule every road shares
 * (`shared/address-rule`): configuration in code, the schema endpoints and the
 * migrate commands judge a new collection address the same way, so this answer
 * holds whichever door the caller goes on to use.
 *
 * So this asks `collectionNameSchema` rather than restating any part of it. A
 * reserved name or a length changed in the rule reaches this answer with nobody
 * editing a second file.
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
