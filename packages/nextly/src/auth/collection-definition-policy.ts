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
 * It is a schema change, so it asks what every schema change asks
 * (`SCHEMA_CHANGE_PERMISSIONS`, in the system write policy): all three of
 * create, update and delete on settings, each asked as one permission is.
 *
 * @module auth/collection-definition-policy
 */

import {
  SCHEMA_CHANGE_PERMISSIONS,
  type SystemPermission,
} from "../domains/auth/system-write-policy";

/** Every permission a collection definition change asks, all of them. */
export const COLLECTION_DEFINITION_PERMISSIONS: readonly SystemPermission[] =
  SCHEMA_CHANGE_PERMISSIONS;
