/**
 * Whether a collection could be created under a given name, judged by the
 * validator the create this answer leads to actually runs.
 *
 * 🔴 Three validators in this codebase answer something like this question and
 * they refuse different names, so WHICH one applies is a property of the route
 * rather than a preference. The dashboard's onboarding checklist links its
 * "create a collection" step to the Schema Builder (`BUILDER_COLLECTIONS_NEW`),
 * whose create posts to `POST /collections` -- the `collectionsHandler` path,
 * which validates the name inside `generateCollection` with
 * `collectionNameSchema`. That schema's verdict is therefore the same thing as
 * whether the step can be finished.
 *
 * The other two govern other doors. `collections/config/validate-config` judges
 * a CONFIG FILE: its `RESERVED_SLUGS` reserves `admin` and `dashboard` because a
 * code-first collection is mounted on a route, and it permits hyphens. The
 * `/collections-schema` endpoint carries its own limits -- 255 characters, no
 * curated list, no SQL-keyword refusal -- for the manifest-shaped create it
 * serves.
 *
 * The three disagree on names a real permission grant carries, which is why the
 * distinction is load-bearing rather than pedantic:
 *
 * | name           | config validator | /collections-schema | Builder create |
 * |----------------|------------------|---------------------|----------------|
 * | `admin`        | refused          | allowed             | allowed        |
 * | `team-updates` | allowed          | refused             | refused        |
 * | `select`       | refused          | allowed             | refused        |
 * | `accounts`     | allowed          | allowed             | refused        |
 * | 51 characters  | allowed          | allowed             | refused        |
 *
 * So this asks `collectionNameSchema` rather than restating any part of it. A
 * reserved name or a length changed there reaches this answer with nobody
 * editing a second file, and the classes that are easiest to forget in a
 * restatement -- SQL keywords, the curated reserved list -- are covered because
 * they were never copied.
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
